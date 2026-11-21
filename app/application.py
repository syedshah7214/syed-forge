"""
MegaFab NEXUS - Industrial Intelligence & Cloud Operations Platform
(web tier - runs on Elastic Beanstalk / EC2 Auto Scaling)

Customer portal:  /  (catalogue + bulk order)  ·  /orders/<id>  (live tracking)  ·  /track
Operations:       /ops (Mission Control) and /ops/<page>
APIs (unchanged): POST /orders · /api/orders/<id> · /api/telemetry · /api/whoami · /api/burn · /health
APIs (new, read-only): /api/ops/*

Order flow is unchanged: order -> RDS -> SQS -> SWF workflow on the fulfilment workers -> S3 invoice -> SNS.
"""
import json
import math
import os
import re
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, url_for

import megafab_core as core
import ops_data as ops

application = app = Flask(__name__)
INSTANCE_ID, AZ = core.instance_identity()
REGION = core.REGION
ENV_NAME = ops.EB_ENV_NAME
_ready = {"ok": False, "err": None}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CATEGORY_ORDER = ["Bearings", "Fasteners", "Hydraulics", "Lubricants", "Power Transmission", "Safety"]


def _bootstrap():
    for attempt in range(30):
        try:
            core.init_schema()
            _ready["ok"] = True
            _ready["err"] = None
            break
        except Exception as e:  # RDS may still be coming up
            _ready["err"] = str(e)
            time.sleep(10)
    try:
        core.ensure_v2_art()
    except Exception as e:
        print("art", e)


threading.Thread(target=_bootstrap, daemon=True).start()


def presign(key, bucket=None, ttl=900):
    if not key:
        return None
    try:
        return core.s3.generate_presigned_url("get_object", Params={"Bucket": bucket or core.ASSETS_BUCKET, "Key": key}, ExpiresIn=ttl)
    except Exception:
        return None


def jsonable(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, datetime):
        return o.isoformat()
    return str(o)


def ok_json(payload):
    return app.response_class(json.dumps(payload, default=jsonable), mimetype="application/json")


@app.context_processor
def inject():
    return {"instance_id": INSTANCE_ID, "az": AZ, "region": REGION, "env_name": ENV_NAME,
            "pkr": lambda v: f"Rs {Decimal(v):,.0f}", "db_ready": _ready["ok"]}


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return resp


@app.route("/health")
def health():
    # ALB health check: healthy as long as the process is up; reports DB state for visibility
    return jsonify(status="ok", db_ready=_ready["ok"], instance=INSTANCE_ID, az=AZ)


# =================================================================== CUSTOMER PORTAL
@app.route("/")
def catalogue():
    if not _ready["ok"]:
        return render_template("starting.html", err=_ready["err"]), 503
    products = core.query("SELECT * FROM products ORDER BY category, name")
    for p in products:
        p["image_url"] = presign(f"catalogue/v2/{p['sku']}.svg") or presign(p["image_key"])
        p["state"] = "low" if p["stock"] <= p["reorder_level"] else ("watch" if p["stock"] <= 2 * p["reorder_level"] else "ok")
    cats = sorted({p["category"] for p in products}, key=lambda c: CATEGORY_ORDER.index(c) if c in CATEGORY_ORDER else 99)
    stats = core.query("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM orders", one=True)
    return render_template("catalogue.html", products=products, cats=cats, stats=stats, active=request.args.get("category"))


@app.route("/orders", methods=["POST"])
def place_order():
    email = request.form.get("email", "").strip().lower()
    company = request.form.get("company", "").strip()[:150]
    priority = "EXPRESS" if request.form.get("priority") == "EXPRESS" else "STANDARD"
    if not EMAIL_RE.match(email) or not company:
        return render_template("message.html", title="Missing details", msg="Please enter your company name and a valid email."), 400
    lines = []
    for k, v in request.form.items():
        if k.startswith("qty_") and v.strip():
            try:
                q = int(v)
            except ValueError:
                continue
            if 0 < q <= 10000:
                lines.append((k[4:], q))
    if not lines:
        return render_template("message.html", title="Empty order", msg="Enter a quantity for at least one product."), 400

    conn = core.connect()
    try:
        with conn.cursor() as cur:
            conn.begin()
            cur.execute("INSERT INTO customers(email,company) VALUES(%s,%s) ON DUPLICATE KEY UPDATE company=VALUES(company)", (email, company))
            cur.execute("SELECT id FROM customers WHERE email=%s", (email,))
            cid = cur.fetchone()["id"]
            cur.execute("INSERT INTO orders(customer_id,status,priority,served_by) VALUES(%s,'RECEIVED',%s,%s)", (cid, priority, f"{INSTANCE_ID} ({AZ})"))
            oid = cur.lastrowid
            total = Decimal(0)
            for sku, q in lines:
                cur.execute("SELECT price FROM products WHERE sku=%s", (sku,))
                row = cur.fetchone()
                if not row:
                    continue
                total += row["price"] * q
                cur.execute("INSERT INTO order_lines(order_id,sku,qty,unit_price) VALUES(%s,%s,%s,%s)", (oid, sku, q, row["price"]))
            cur.execute("UPDATE orders SET total=%s WHERE id=%s", (total, oid))
            cur.execute("INSERT INTO order_events(order_id,status,detail,actor) VALUES(%s,'RECEIVED',%s,%s)",
                        (oid, f"Order saved to RDS by web tier — {len(lines)} line(s), total Rs {total:,.0f}", f"web {INSTANCE_ID}"))
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # Decoupling: the web tier only enqueues. Fulfilment happens asynchronously.
    core.sqs.send_message(
        QueueUrl=core.ORDERS_QUEUE_URL,
        MessageBody=json.dumps({"order_id": oid, "email": email, "priority": priority}),
        MessageAttributes={"priority": {"DataType": "String", "StringValue": priority}},
    )
    core.add_event(oid, "QUEUED", "Message placed on SQS queue megafab-orders", f"web {INSTANCE_ID}")
    _ensure_customer_subscription(email)
    return redirect(url_for("track", order_id=oid, email=email))


def _ensure_customer_subscription(email):
    """Subscribe the customer to SNS with a filter policy so they only receive their own messages."""
    try:
        subs = core.sns.list_subscriptions_by_topic(TopicArn=core.TOPIC_ARN).get("Subscriptions", [])
        if any(s.get("Endpoint", "").lower() == email for s in subs):
            return
        core.sns.subscribe(TopicArn=core.TOPIC_ARN, Protocol="email", Endpoint=email,
                           Attributes={"FilterPolicy": json.dumps({"audience": ["customer"], "customer_email": [email]})})
    except Exception as e:
        print("subscribe failed", e)


@app.route("/track", methods=["GET", "POST"])
def track_lookup():
    if request.method == "POST":
        return redirect(url_for("track", order_id=request.form.get("order_id", "0"), email=request.form.get("email", "")))
    return render_template("track_lookup.html")


def _load_order(order_id, email):
    o = core.query("""SELECT o.*, c.email, c.company FROM orders o JOIN customers c ON c.id=o.customer_id
                      WHERE o.id=%s""", (order_id,), one=True)
    if not o or (email and o["email"] != email.lower()):
        return None
    return o


@app.route("/orders/<int:order_id>")
def track(order_id):
    o = _load_order(order_id, request.args.get("email", ""))
    if not o:
        abort(404)
    lines = core.query("""SELECT l.*, p.name, p.unit, p.category FROM order_lines l JOIN products p ON p.sku=l.sku WHERE order_id=%s""", (order_id,))
    return render_template("track.html", o=o, lines=lines, email=request.args.get("email", ""))


@app.route("/catalogue-art/<sku>.svg")
def catalogue_art(sku):
    """Fallback product artwork rendered by the app (same art the S3 copy holds) for when S3 is unreachable."""
    for row in core.CATALOGUE:
        if row[0] == sku:
            return Response(core.product_svg_v2(row[0], row[1], row[2], row[8]), mimetype="image/svg+xml",
                            headers={"Cache-Control": "public, max-age=86400"})
    abort(404)


@app.route("/api/orders/<int:order_id>")
def api_order(order_id):
    o = _load_order(order_id, request.args.get("email", ""))
    if not o:
        abort(404)
    events = core.query("SELECT status, detail, actor, DATE_FORMAT(ts,'%%H:%%i:%%s.%%f') t FROM order_events WHERE order_id=%s ORDER BY id", (order_id,))
    for e in events:
        e["t"] = e["t"][:12]
    return jsonify(status=o["status"], workflow_run_id=o["workflow_run_id"], tracking_no=o["tracking_no"], carrier=o["carrier"],
                   eta=str(o["eta"]) if o["eta"] else None, invoice_url=presign(o["invoice_key"], core.DOCS_BUCKET, 600),
                   events=events)


@app.route("/api/telemetry", methods=["POST"])
def telemetry():
    """Factory-floor machines post readings here. Faults raise a staff maintenance alert via SNS."""
    d = request.get_json(force=True, silent=True) or {}
    mid = str(d.get("machine_id", ""))[:30]
    if not mid:
        return jsonify(error="machine_id required"), 400
    fault = (d.get("fault_code") or None)
    core.execute("INSERT INTO telemetry(machine_id,temperature,run_hours,fault_code) VALUES(%s,%s,%s,%s)",
                 (mid, d.get("temperature"), d.get("run_hours"), fault))
    if fault or float(d.get("temperature") or 0) > 90:
        core.sns.publish(TopicArn=core.TOPIC_ARN, Subject=f"[MegaFab] Maintenance alert: {mid}",
                         Message=f"Machine {mid} reported fault={fault} temperature={d.get('temperature')}C run_hours={d.get('run_hours')}. Please schedule maintenance.",
                         MessageAttributes={"audience": {"DataType": "String", "StringValue": "staff"}})
    return jsonify(ok=True)


# =================================================================== OPERATIONS CONSOLE
CONSOLE_PAGES = [
    ("mission", "Command Center", "/ops"),
    ("architecture", "Architecture Explorer", "/ops/architecture"),
    ("fulfilment", "Fulfilment Workflow", "/ops/fulfilment"),
    ("compute", "EC2 & Auto Scaling", "/ops/compute"),
    ("factory", "Factory Intelligence", "/ops/factory"),
    ("inventory", "Inventory Analytics", "/ops/inventory"),
    ("security", "Security & Audit", "/ops/security"),
    ("health", "Infrastructure Health", "/ops/health"),
]


def console(page):
    title = dict((k, t) for k, t, _ in CONSOLE_PAGES)[page]
    return render_template(f"ops/{page}.html", page=page, title=title, pages=CONSOLE_PAGES)


@app.route("/ops")
def ops_mission():
    return console("mission")


@app.route("/ops/<page>")
def ops_page(page):
    if page not in dict((k, t) for k, t, _ in CONSOLE_PAGES) or page == "mission":
        abort(404)
    return console(page)


@app.route("/api/ops/summary")
def api_ops_summary():
    db = ops.db_summary()
    comp = ops.compute()
    wk = ops.workers()
    hl = ops.health()
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "region": REGION, "environment": ENV_NAME,
           "served_by": {"instance": INSTANCE_ID, "az": AZ}, "db": db, "queues": ops.queues(), "workflows": ops.workflows(),
           "workers": wk, "health": {"state": hl["state"], "score": hl.get("score"), "probes": hl.get("probes", [])}}
    if comp["state"] == "ok":
        def _g(g):
            if not g:
                return None
            d = {k: g[k] for k in ("min", "max", "desired", "in_service", "azs")}
            d["by_az"] = {}
            for i in g.get("instances", []):
                if i.get("lifecycle") == "InService":
                    d["by_az"][i["az"]] = d["by_az"].get(i["az"], 0) + 1
            return d
        out["compute"] = {"state": "ok", "web": _g(comp["web"]), "workers": _g(comp["workers"])}
    else:
        out["compute"] = comp
    return ok_json(out)


@app.route("/api/ops/orders")
def api_ops_orders():
    status = request.args.get("status") or None
    return ok_json(ops.recent_orders(status, min(int(request.args.get("limit", 20)), 100)))


@app.route("/api/ops/activity")
def api_ops_activity():
    return ok_json(ops.activity(min(int(request.args.get("limit", 25)), 60)))


@app.route("/api/ops/compute")
def api_ops_compute():
    return ok_json(ops.compute())


@app.route("/api/ops/telemetry")
def api_ops_telemetry():
    return ok_json(ops.telemetry())


@app.route("/api/ops/inventory")
def api_ops_inventory():
    return ok_json(ops.inventory())


@app.route("/api/ops/security")
def api_ops_security():
    return ok_json(ops.security())


@app.route("/api/ops/health")
def api_ops_health():
    return ok_json(ops.health())


@app.route("/api/whoami")
def whoami():
    return jsonify(instance=INSTANCE_ID, az=AZ, time=time.time())


@app.route("/api/burn")
def burn():
    """Generates CPU load for the Auto Scaling demo (capped at 20 s per request)."""
    secs = min(float(request.args.get("s", 5)), 20)
    end = time.time() + secs
    x = 0.0
    while time.time() < end:
        for i in range(20000):
            x += math.sqrt(i * 1.0001)
    return jsonify(instance=INSTANCE_ID, az=AZ, burned=secs)


@app.errorhandler(404)
def nf(e):
    if request.path.startswith("/api/"):
        return jsonify(error="not found"), 404
    return render_template("message.html", title="Not found", msg="We could not find that page or order. Check the order number and email."), 404


@app.errorhandler(500)
def err(e):
    if request.path.startswith("/api/"):
        return jsonify(error="server error"), 500
    return render_template("message.html", title="Something went wrong", msg="The platform logged this error. Please retry in a moment."), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
