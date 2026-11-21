"""
MegaFab fulfilment worker  (runs on EC2 instances in the "fulfilment" Auto Scaling group)

Three cooperating loops in one process:
  1. SQS poller   - reads new orders from the queue and STARTS an SWF workflow per order
  2. SWF decider  - reads workflow history and decides which activity runs next
  3. SWF activity - executes the business steps (validate, reserve stock, invoice, ship, notify)

Because each step is an SWF activity, any worker instance can pick up any step; if an
instance dies mid-order, SWF times the task out and another instance continues it.
"""
import json
import random
import string
import threading
import time
import traceback
from datetime import date, timedelta

import megafab_core as core

DOMAIN = core.SWF_DOMAIN
WF_TYPE = {"name": "OrderFulfilment", "version": "1.0"}
DECISION_TL = "megafab-decisions"
ACTIVITY_TL = "megafab-activities"
STEPS = ["ValidateOrder", "ReserveStock", "GenerateInvoice", "ArrangeShipment", "NotifyCustomer"]
INSTANCE_ID, AZ = core.instance_identity()
ME = f"worker {INSTANCE_ID}"
STEP_DELAY = 2.0  # small pause so the live timeline is visible during the demo
processed = 0


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ------------------------------------------------------------------ 1. SQS -> SWF
MAX_OPEN_PER_WORKER = 4  # back-pressure: keep the backlog in SQS so the ASG can scale on queue depth


def _saturated():
    try:
        since = time.time() - 86400
        open_wf = core.swf.count_open_workflow_executions(domain=DOMAIN, startTimeFilter={"oldestDate": since})["count"]
        live = core.query("SELECT COUNT(*) n FROM workers WHERE last_seen > NOW() - INTERVAL 90 SECOND", one=True)["n"] or 1
        return open_wf >= MAX_OPEN_PER_WORKER * live
    except Exception:
        return False


def sqs_poller():
    global processed
    while True:
        try:
            if _saturated():
                time.sleep(3)
                continue
            r = core.sqs.receive_message(QueueUrl=core.ORDERS_QUEUE_URL, MaxNumberOfMessages=2, WaitTimeSeconds=20,
                                         VisibilityTimeout=60, MessageAttributeNames=["All"])
            for m in r.get("Messages", []):
                body = json.loads(m["Body"])
                oid = int(body["order_id"])
                try:
                    run = core.swf.start_workflow_execution(
                        domain=DOMAIN, workflowId=f"order-{oid}", workflowType=WF_TYPE, taskList={"name": DECISION_TL},
                        input=json.dumps(body), executionStartToCloseTimeout="3600", taskStartToCloseTimeout="60",
                        childPolicy="TERMINATE", tagList=[body.get("priority", "STANDARD")])
                    core.execute("UPDATE orders SET workflow_run_id=%s WHERE id=%s", (run["runId"], oid))
                    core.add_event(oid, "WORKFLOW_STARTED", f"SWF workflow OrderFulfilment started (runId {run['runId'][:18]}…)", ME)
                except core.swf.exceptions.WorkflowExecutionAlreadyStartedFault:
                    log("duplicate message for order", oid)  # SQS is at-least-once; SWF workflowId makes it idempotent
                core.sqs.delete_message(QueueUrl=core.ORDERS_QUEUE_URL, ReceiptHandle=m["ReceiptHandle"])
                processed += 1
                log("started workflow for order", oid)
        except Exception:
            traceback.print_exc()
            time.sleep(5)


# ------------------------------------------------------------------ 2. SWF decider
def _full_history(task):
    events = list(task.get("events", []))
    token = task.get("nextPageToken")
    while token:
        more = core.swf.poll_for_decision_task(domain=DOMAIN, taskList={"name": DECISION_TL}, identity=ME, nextPageToken=token)
        events += more.get("events", [])
        token = more.get("nextPageToken")
    return events


def decider():
    while True:
        try:
            task = core.swf.poll_for_decision_task(domain=DOMAIN, taskList={"name": DECISION_TL}, identity=ME, reverseOrder=False)
            if not task.get("taskToken"):
                continue
            events = _full_history(task)
            wf_input = next((e["workflowExecutionStartedEventAttributes"].get("input") for e in events
                             if e["eventType"] == "WorkflowExecutionStarted"), None)
            if wf_input is None:  # defensive: read the full history directly
                h = core.swf.get_workflow_execution_history(domain=DOMAIN, execution=task["workflowExecution"], maximumPageSize=1)
                wf_input = h["events"][0]["workflowExecutionStartedEventAttributes"].get("input") or "{}"
            act = [e for e in events if e["eventType"] in
                   ("ActivityTaskScheduled", "ActivityTaskCompleted", "ActivityTaskFailed", "ActivityTaskTimedOut",
                    "ScheduleActivityTaskFailed")]
            completed = sum(1 for e in act if e["eventType"] == "ActivityTaskCompleted")
            n_sched = sum(1 for e in act if e["eventType"] == "ActivityTaskScheduled")
            timeouts = sum(1 for e in act if e["eventType"] == "ActivityTaskTimedOut")
            last = act[-1]["eventType"] if act else None
            decisions = []
            if last in ("ActivityTaskFailed", "ScheduleActivityTaskFailed"):
                attrs = act[-1].get("activityTaskFailedEventAttributes") or act[-1].get("scheduleActivityTaskFailedEventAttributes") or {}
                decisions.append({"decisionType": "FailWorkflowExecution",
                                  "failWorkflowExecutionDecisionAttributes": {"reason": str(attrs.get("reason") or attrs.get("cause") or "failed")[:256]}})
            elif last == "ActivityTaskTimedOut":
                if timeouts <= 3:  # a worker died mid-step: SWF hands the same step to any healthy worker
                    decisions.append(_schedule(STEPS[completed], wf_input, n_sched))
                else:
                    decisions.append({"decisionType": "FailWorkflowExecution",
                                      "failWorkflowExecutionDecisionAttributes": {"reason": "activity timed out repeatedly"}})
            elif completed >= len(STEPS):
                decisions.append({"decisionType": "CompleteWorkflowExecution",
                                  "completeWorkflowExecutionDecisionAttributes": {"result": "fulfilled"}})
            elif last != "ActivityTaskScheduled":  # nothing in flight -> schedule next step
                decisions.append(_schedule(STEPS[completed], wf_input, n_sched))
            core.swf.respond_decision_task_completed(taskToken=task["taskToken"], decisions=decisions)
        except Exception:
            traceback.print_exc()
            time.sleep(3)


def _schedule(step, wf_input, n):
    return {"decisionType": "ScheduleActivityTask", "scheduleActivityTaskDecisionAttributes": {
        "activityType": {"name": step, "version": "1.0"}, "activityId": f"{step}-{n}", "input": wf_input,
        "taskList": {"name": ACTIVITY_TL}, "scheduleToCloseTimeout": "300", "scheduleToStartTimeout": "240",
        "startToCloseTimeout": "60", "heartbeatTimeout": "NONE"}}


# ------------------------------------------------------------------ 3. SWF activities
class Reject(Exception):
    pass


def a_validate(oid, inp):
    lines = core.query("SELECT l.*, p.name FROM order_lines l LEFT JOIN products p ON p.sku=l.sku WHERE order_id=%s", (oid,))
    if not lines or any(l["name"] is None or l["qty"] <= 0 for l in lines):
        raise Reject("Order has no valid lines")
    o = core.query("SELECT total FROM orders WHERE id=%s", (oid,), one=True)
    credit_limit = 5_000_000
    if o["total"] > credit_limit:
        raise Reject(f"Order exceeds B2B credit limit (Rs {credit_limit:,})")
    core.add_event(oid, "VALIDATED", f"{len(lines)} line(s) checked; within credit limit", ME)


def a_reserve(oid, inp):
    conn = core.connect()
    try:
        with conn.cursor() as cur:
            conn.begin()
            cur.execute("SELECT l.sku,l.qty,p.stock FROM order_lines l JOIN products p ON p.sku=l.sku WHERE l.order_id=%s FOR UPDATE", (oid,))
            rows = cur.fetchall()
            short = [r["sku"] for r in rows if r["stock"] < r["qty"]]
            if short:
                conn.rollback()
                raise Reject("Insufficient stock for " + ", ".join(short))
            for r in rows:
                cur.execute("UPDATE products SET stock=stock-%s WHERE sku=%s", (r["qty"], r["sku"]))
            conn.commit()
    finally:
        conn.close()
    core.add_event(oid, "STOCK_RESERVED", f"Stock decremented in one RDS transaction ({len(rows)} SKU)", ME)


def a_invoice(oid, inp):
    o = core.query("SELECT o.*,c.company,c.email FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=%s", (oid,), one=True)
    lines = core.query("SELECT l.*,p.name FROM order_lines l JOIN products p ON p.sku=l.sku WHERE order_id=%s", (oid,))
    rows = "".join(f"<tr><td>{l['sku']}</td><td>{l['name']}</td><td>{l['qty']}</td><td>{l['unit_price']:,.0f}</td><td>{l['qty']*l['unit_price']:,.0f}</td></tr>" for l in lines)
    tax = o["total"] * 18 / 100
    html = f"""<html><body style="font-family:Arial;max-width:760px;margin:30px auto">
<h1 style="border-bottom:6px solid #f5b700">MegaFab Industrial Supply Co.</h1><h2>Tax Invoice INV-{oid:06d}</h2>
<p><b>Bill to:</b> {o['company']} &lt;{o['email']}&gt;<br><b>Date:</b> {date.today()}<br><b>Priority:</b> {o['priority']}</p>
<table border=1 cellpadding=6 cellspacing=0 width=100%><tr><th>SKU</th><th>Item</th><th>Qty</th><th>Unit (Rs)</th><th>Amount (Rs)</th></tr>{rows}
<tr><td colspan=4 align=right>Subtotal</td><td>{o['total']:,.0f}</td></tr><tr><td colspan=4 align=right>Sales tax 18%</td><td>{tax:,.0f}</td></tr>
<tr><td colspan=4 align=right><b>Total</b></td><td><b>{o['total']+tax:,.0f}</b></td></tr></table>
<p style="color:#666;font-size:12px">Generated by fulfilment worker {INSTANCE_ID} ({AZ}). Stored in Amazon S3 with SSE-KMS.</p></body></html>"""
    key = f"invoices/{date.today():%Y/%m}/INV-{oid:06d}.html"
    kw = {"ServerSideEncryption": "aws:kms", "SSEKMSKeyId": core.KMS_KEY_ARN} if core.KMS_KEY_ARN else {}
    core.s3.put_object(Bucket=core.DOCS_BUCKET, Key=key, Body=html.encode(), ContentType="text/html", **kw)
    core.execute("UPDATE orders SET invoice_key=%s WHERE id=%s", (key, oid))
    core.add_event(oid, "INVOICED", f"Invoice INV-{oid:06d} written to s3://…/{key} (SSE-KMS)", ME)


def a_ship(oid, inp):
    express = inp.get("priority") == "EXPRESS"
    carrier = random.choice(["TCS Logistics", "Leopards Courier", "M&P Cargo"]) if not express else "TCS Express"
    trk = "MF" + "".join(random.choices(string.digits, k=10))
    eta = date.today() + timedelta(days=1 if express else 4)
    core.execute("UPDATE orders SET carrier=%s, tracking_no=%s, eta=%s WHERE id=%s", (carrier, trk, eta, oid))
    core.add_event(oid, "SHIPPED", f"Booked with {carrier}, tracking {trk}, ETA {eta}", ME)


def a_notify(oid, inp):
    o = core.query("SELECT o.*,c.email,c.company FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=%s", (oid,), one=True)
    msg = (f"Dear {o['company']},\n\nYour MegaFab order #{oid} (Rs {o['total']:,.0f}) has shipped.\n"
           f"Carrier: {o['carrier']}\nTracking: {o['tracking_no']}\nExpected delivery: {o['eta']}\n\nThank you for ordering with MegaFab.")
    core.sns.publish(TopicArn=core.TOPIC_ARN, Subject=f"MegaFab order #{oid} shipped", Message=msg,
                     MessageAttributes={"audience": {"DataType": "String", "StringValue": "customer"},
                                        "customer_email": {"DataType": "String", "StringValue": o["email"]}})
    core.sns.publish(TopicArn=core.TOPIC_ARN, Subject=f"[Staff] Order #{oid} dispatched", Message=f"Order #{oid} for {o['company']} dispatched via {o['carrier']} ({o['tracking_no']}).",
                     MessageAttributes={"audience": {"DataType": "String", "StringValue": "staff"}})
    core.add_event(oid, "COMPLETED", "SNS notifications published to customer and staff", ME)


ACTIVITIES = {"ValidateOrder": a_validate, "ReserveStock": a_reserve, "GenerateInvoice": a_invoice,
              "ArrangeShipment": a_ship, "NotifyCustomer": a_notify}


def activity_worker():
    while True:
        try:
            t = core.swf.poll_for_activity_task(domain=DOMAIN, taskList={"name": ACTIVITY_TL}, identity=ME)
            if not t.get("taskToken"):
                continue
            inp = json.loads(t.get("input") or "{}")
            oid = int(inp["order_id"])
            name = t["activityType"]["name"]
            time.sleep(STEP_DELAY)
            try:
                ACTIVITIES[name](oid, inp)
                core.swf.respond_activity_task_completed(taskToken=t["taskToken"], result="ok")
            except Reject as r:
                core.add_event(oid, "REJECTED", f"{name}: {r}", ME)
                core.sns.publish(TopicArn=core.TOPIC_ARN, Subject=f"[Staff] Order #{oid} rejected", Message=f"{name}: {r}",
                                 MessageAttributes={"audience": {"DataType": "String", "StringValue": "staff"}})
                core.swf.respond_activity_task_failed(taskToken=t["taskToken"], reason=str(r)[:256])
            log("activity", name, "order", oid, "done")
        except Exception:
            traceback.print_exc()
            time.sleep(3)


def heartbeat():
    while True:
        try:
            core.execute("""INSERT INTO workers(instance_id,az,role,processed,last_seen) VALUES(%s,%s,'fulfilment',%s,NOW())
                            ON DUPLICATE KEY UPDATE processed=VALUES(processed), last_seen=NOW()""", (INSTANCE_ID, AZ, processed))
        except Exception as e:
            log("heartbeat failed", e)
        time.sleep(30)


if __name__ == "__main__":
    for i in range(60):  # wait for the web tier to create the schema
        try:
            core.query("SELECT 1 FROM workers LIMIT 1")
            break
        except Exception as e:
            log("waiting for schema:", e)
            time.sleep(10)
    log("MegaFab worker online", INSTANCE_ID, AZ)
    threads = [threading.Thread(target=f, daemon=True) for f in (sqs_poller, decider, activity_worker, activity_worker, heartbeat)]
    for t in threads:
        t.start()
    while True:
        time.sleep(60)
