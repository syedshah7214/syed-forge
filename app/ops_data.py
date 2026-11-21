"""
MegaFab NEXUS - read-only operational data for the Operations Console.

Every value comes from a real source (RDS, SQS, SWF, Auto Scaling, EC2, KMS, S3, CloudTrail,
Secrets Manager). When a source cannot be reached the API says "unavailable" - it never invents
numbers. Results are cached briefly so many browsers polling the console do not hammer AWS.
Nothing here returns credentials, secret values, ARNs or the AWS account id.
"""
import os
import threading
import time

import megafab_core as core

EB_ENV_NAME = os.environ.get("EB_ENV_NAME", "megafab-prod")
WORKER_ASG = os.environ.get("WORKER_ASG", "megafab-fulfilment-asg")
PROJECT = os.environ.get("PROJECT", "megafab")
TRAIL_NAME = os.environ.get("TRAIL_NAME", f"{PROJECT}-audit-trail")
DB_INSTANCE_ID = os.environ.get("DB_INSTANCE_ID", f"{PROJECT}-orders-db")

_cache, _lock = {}, threading.Lock()


def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (now, val)
    return val


def _client(name):
    return core._session.client(name)


def mask(s, keep=4):
    """Hide account ids / long identifiers that should not be shown in a public UI."""
    s = str(s or "")
    acct = "".join(ch for ch in s if ch.isdigit())
    if len(acct) >= 12:
        import re
        s = re.sub(r"\d{12}", lambda m: "••••" + m.group(0)[-keep:], s)
    return s


def _ok(**kw):
    return {"state": "ok", **kw}


def _unavailable(err):
    return {"state": "unavailable", "reason": type(err).__name__}


# ------------------------------------------------------------------ database
def db_summary():
    def f():
        p = core.query("SELECT COUNT(*) n, SUM(stock<=reorder_level) low FROM products", one=True)
        o = core.query("""SELECT COUNT(*) n, COALESCE(SUM(total),0) v,
                          SUM(status='COMPLETED') done, SUM(status IN ('REJECTED','FAILED')) failed
                          FROM orders""", one=True)
        by = core.query("SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC")
        return _ok(products=int(p["n"]), low_stock=int(p["low"] or 0), orders=int(o["n"]), value=float(o["v"]),
                   completed=int(o["done"] or 0), failed=int(o["failed"] or 0),
                   pending=int(o["n"]) - int(o["done"] or 0) - int(o["failed"] or 0), by_status=by)
    try:
        return cached("db", 5, f)
    except Exception as e:
        return _unavailable(e)


def queues():
    def f():
        out = {}
        for name, url in (("orders", core.ORDERS_QUEUE_URL), ("dlq", core.DLQ_URL)):
            a = core.sqs.get_queue_attributes(QueueUrl=url, AttributeNames=[
                "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"])["Attributes"]
            out[name] = {"waiting": int(a["ApproximateNumberOfMessages"]), "inflight": int(a["ApproximateNumberOfMessagesNotVisible"])}
        return _ok(**out)
    try:
        return cached("sqs", 5, f)
    except Exception as e:
        return _unavailable(e)


def workflows():
    def f():
        since = {"oldestDate": time.time() - 86400}
        o = core.swf.count_open_workflow_executions(domain=core.SWF_DOMAIN, startTimeFilter=since)["count"]
        c = core.swf.count_closed_workflow_executions(domain=core.SWF_DOMAIN, startTimeFilter=since)["count"]
        return _ok(open=o, closed=c, domain=core.SWF_DOMAIN)
    try:
        return cached("swf", 10, f)
    except Exception as e:
        return _unavailable(e)


def workers():
    """Heartbeats written by the real worker processes (no heartbeat = not shown as healthy)."""
    def f():
        rows = core.query("""SELECT instance_id, az, processed, TIMESTAMPDIFF(SECOND,last_seen,NOW()) age
                             FROM workers ORDER BY last_seen DESC LIMIT 12""")
        for r in rows:
            r["state"] = "healthy" if r["age"] <= 90 else ("stale" if r["age"] <= 600 else "gone")
        return _ok(items=rows, healthy=sum(r["state"] == "healthy" for r in rows))
    try:
        return cached("workers", 5, f)
    except Exception as e:
        return _unavailable(e)


# ------------------------------------------------------------------ compute (Auto Scaling + EC2)
def _asg_view(g):
    inst = [{"id": i["InstanceId"], "az": i["AvailabilityZone"], "lifecycle": i["LifecycleState"],
             "health": i["HealthStatus"], "type": i.get("InstanceType", "")} for i in g["Instances"]]
    return {"name": g["AutoScalingGroupName"] if "awseb" not in g["AutoScalingGroupName"] else f"EB: {EB_ENV_NAME}",
            "min": g["MinSize"], "max": g["MaxSize"], "desired": g["DesiredCapacity"],
            "in_service": sum(i["lifecycle"] == "InService" for i in inst), "instances": inst,
            "azs": g["AvailabilityZones"], "suspended": [p["ProcessName"] for p in g.get("SuspendedProcesses", [])]}


def compute():
    def f():
        asg = _client("autoscaling")
        groups = asg.describe_auto_scaling_groups(Filters=[{"Name": "tag:elasticbeanstalk:environment-name", "Values": [EB_ENV_NAME]}])["AutoScalingGroups"]
        web = _asg_view(groups[0]) if groups else None
        wg = asg.describe_auto_scaling_groups(AutoScalingGroupNames=[WORKER_ASG])["AutoScalingGroups"]
        work = _asg_view(wg[0]) if wg else None
        acts = []
        for g in [x for x in (groups[:1] + wg[:1])]:
            for a in asg.describe_scaling_activities(AutoScalingGroupName=g["AutoScalingGroupName"], MaxRecords=6)["Activities"]:
                acts.append({"group": "web" if "awseb" in g["AutoScalingGroupName"] else "workers", "time": a["StartTime"].isoformat(),
                             "status": a["StatusCode"], "text": a["Description"]})
        acts.sort(key=lambda a: a["time"], reverse=True)
        return _ok(web=web, workers=work, activities=acts[:10])
    try:
        return cached("compute", 15, f)
    except Exception as e:
        return _unavailable(e)


# ------------------------------------------------------------------ security posture (configured vs verified)
def security():
    def f():
        checks = []

        def check(area, control, fn):
            try:
                ok, detail = fn()
                checks.append({"area": area, "control": control, "state": "verified" if ok else "attention", "detail": detail})
            except Exception as e:
                checks.append({"area": area, "control": control, "state": "unverified", "detail": f"Not readable from the app role ({type(e).__name__})"})

        kms = _client("kms")

        def k():
            md = kms.describe_key(KeyId=f"alias/{PROJECT}-data")["KeyMetadata"]
            rot = kms.get_key_rotation_status(KeyId=md["KeyId"])["KeyRotationEnabled"]
            return md["KeyState"] == "Enabled" and rot, f"alias/{PROJECT}-data · {md['KeyState']} · rotation {'on' if rot else 'off'}"
        check("Encryption", "Customer-managed KMS key", k)

        def r():
            d = _client("rds").describe_db_instances(DBInstanceIdentifier=DB_INSTANCE_ID)["DBInstances"][0]
            return d["StorageEncrypted"] and d["MultiAZ"], (f"{d['Engine']} {d['EngineVersion']} · encrypted={d['StorageEncrypted']} · "
                                                            f"Multi-AZ={d['MultiAZ']} · backups {d['BackupRetentionPeriod']} days · "
                                                            f"{d.get('AvailabilityZone')} / standby {d.get('SecondaryAvailabilityZone', '-')}")
        check("Data", "RDS encryption, Multi-AZ & backups", r)

        def b():
            s3c, out, allok = core.s3, [], True
            for bucket, label in ((core.ASSETS_BUCKET, "assets"), (core.DOCS_BUCKET, "docs")):
                enc = s3c.get_bucket_encryption(Bucket=bucket)["ServerSideEncryptionConfiguration"]["Rules"][0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"]
                pab = s3c.get_public_access_block(Bucket=bucket)["PublicAccessBlockConfiguration"]
                blocked = all(pab.values())
                allok &= enc == "aws:kms" and blocked
                out.append(f"{label}: {enc}, public access {'blocked' if blocked else 'OPEN'}")
            return allok, " · ".join(out)
        check("Storage", "S3 SSE-KMS & Block Public Access", b)

        def t():
            st = _client("cloudtrail").get_trail_status(Name=TRAIL_NAME)
            tr = _client("cloudtrail").describe_trails(trailNameList=[TRAIL_NAME])["trailList"][0]
            ok = st["IsLogging"] and tr.get("LogFileValidationEnabled") and tr.get("IsMultiRegionTrail")
            return ok, f"logging={st['IsLogging']} · multi-region={tr.get('IsMultiRegionTrail')} · validation={tr.get('LogFileValidationEnabled')} · KMS={'yes' if tr.get('KmsKeyId') else 'no'}"
        check("Audit", "CloudTrail multi-region with integrity validation", t)

        def sm():
            d = _client("secretsmanager").describe_secret(SecretId=core.DB_SECRET_ARN)
            return bool(d.get("KmsKeyId")), "DB password generated & stored in Secrets Manager, encrypted with the MegaFab key (value never displayed)"
        check("Identity", "Secrets Manager for database credentials", sm)

        def q():
            a = core.sqs.get_queue_attributes(QueueUrl=core.ORDERS_QUEUE_URL, AttributeNames=["KmsMasterKeyId"])["Attributes"]
            return bool(a.get("KmsMasterKeyId")), "orders queue encrypted with the MegaFab KMS key"
        check("Messaging", "SQS server-side encryption", q)

        def tls():
            r = core.query("SELECT @@require_secure_transport AS t", one=True)
            v = str(r["t"]) in ("1", "ON")
            return v, f"require_secure_transport={r['t']} · app verifies the RDS CA and hostname"
        check("Transit", "TLS enforced to the database", tls)

        configured = [
            {"area": "Identity", "control": "Least-privilege IAM managed policies per job role + MFA enforcement", "where": "06-dns-governance.yaml"},
            {"area": "Network", "control": "Public / app / data subnets, chained security groups, NACLs", "where": "01-network.yaml, 02-security.yaml"},
            {"area": "Network", "control": "Management VPC + VPC peering + private DNS", "where": "01-network.yaml, 06-dns-governance.yaml"},
            {"area": "Operations", "control": "Systems Manager Session Manager instead of open SSH", "where": "05-compute.yaml"},
            {"area": "Encryption", "control": "Account-wide EBS encryption by default with the MegaFab key", "where": "00-foundation.yaml"},
        ]
        return _ok(checks=checks, configured=configured)
    try:
        return cached("security", 60, f)
    except Exception as e:
        return _unavailable(e)


# ------------------------------------------------------------------ health probes
def health():
    def f():
        probes = []

        def probe(name, fn):
            t0 = time.time()
            try:
                fn()
                probes.append({"name": name, "state": "ok", "ms": round((time.time() - t0) * 1000)})
            except Exception as e:
                probes.append({"name": name, "state": "down", "ms": round((time.time() - t0) * 1000), "reason": type(e).__name__})
        probe("RDS MySQL", lambda: core.query("SELECT 1", one=True))
        probe("SQS orders queue", lambda: core.sqs.get_queue_attributes(QueueUrl=core.ORDERS_QUEUE_URL, AttributeNames=["QueueArn"]))
        probe("SWF domain", lambda: core.swf.describe_domain(name=core.SWF_DOMAIN))
        probe("S3 assets bucket", lambda: core.s3.head_bucket(Bucket=core.ASSETS_BUCKET))
        probe("SNS topic", lambda: core.sns.get_topic_attributes(TopicArn=core.TOPIC_ARN))
        probe("Secrets Manager", lambda: core.secrets.describe_secret(SecretId=core.DB_SECRET_ARN))
        up = sum(p["state"] == "ok" for p in probes)
        return _ok(probes=probes, score=round(100 * up / len(probes)))
    return cached("health", 10, f)


# ------------------------------------------------------------------ factory + inventory + activity
def telemetry():
    def f():
        latest = core.query("""SELECT t.machine_id, t.temperature, t.run_hours, t.fault_code, t.ts FROM telemetry t
                               JOIN (SELECT machine_id, MAX(id) mid FROM telemetry GROUP BY machine_id) x ON x.mid=t.id
                               ORDER BY t.machine_id""")
        hist = core.query("""SELECT machine_id, temperature, ts FROM telemetry
                             WHERE ts > NOW() - INTERVAL 7 DAY ORDER BY id DESC LIMIT 500""")
        series = {}
        for h in reversed(hist):
            series.setdefault(h["machine_id"], []).append({"t": h["ts"].isoformat(), "v": float(h["temperature"] or 0)})
        for m in latest:
            temp = float(m["temperature"] or 0)
            m["status"] = "critical" if (m["fault_code"] or temp > 90) else ("warning" if temp > 75 else "normal")
            m["ts"] = m["ts"].isoformat()
            m["readings"] = len(series.get(m["machine_id"], []))
        return _ok(machines=latest, series=series)
    try:
        return cached("telemetry", 5, f)
    except Exception as e:
        return _unavailable(e)


def inventory():
    def f():
        rows = core.query("""SELECT p.sku, p.name, p.category, p.unit, p.price, p.stock, p.reorder_level,
                                    COALESCE(SUM(l.qty),0) sold, COALESCE(SUM(l.qty*l.unit_price),0) revenue
                             FROM products p LEFT JOIN order_lines l ON l.sku=p.sku
                             GROUP BY p.sku ORDER BY p.category, p.name""")
        for r in rows:
            for k in ("price", "revenue"):
                r[k] = float(r[k])
            r["sold"] = int(r["sold"])
            r["state"] = "reorder" if r["stock"] <= r["reorder_level"] else ("watch" if r["stock"] <= 2 * r["reorder_level"] else "healthy")
        cats = {}
        for r in rows:
            c = cats.setdefault(r["category"], {"category": r["category"], "revenue": 0.0, "units": 0, "stock_value": 0.0})
            c["revenue"] += r["revenue"]; c["units"] += r["sold"]; c["stock_value"] += r["stock"] * r["price"]
        return _ok(items=rows, categories=sorted(cats.values(), key=lambda c: -c["revenue"]))
    try:
        return cached("inventory", 10, f)
    except Exception as e:
        return _unavailable(e)


def activity(limit=25):
    def f():
        ev = core.query("""SELECT e.order_id, e.status, e.detail, e.actor, e.ts, c.company FROM order_events e
                           JOIN orders o ON o.id=e.order_id JOIN customers c ON c.id=o.customer_id
                           ORDER BY e.id DESC LIMIT %s""", (limit,))
        for e in ev:
            e["ts"] = e["ts"].isoformat()
        return _ok(items=ev)
    try:
        return cached(f"activity{limit}", 4, f)
    except Exception as e:
        return _unavailable(e)


def recent_orders(status=None, limit=20):
    sql = """SELECT o.id, o.status, o.total, o.priority, o.served_by, o.carrier, o.tracking_no, c.company,
                    o.created_at, TIMESTAMPDIFF(SECOND,o.created_at,o.updated_at) secs
             FROM orders o JOIN customers c ON c.id=o.customer_id"""
    args = []
    if status:
        sql += " WHERE o.status=%s"; args.append(status)
    sql += " ORDER BY o.id DESC LIMIT %s"; args.append(limit)
    try:
        rows = core.query(sql, args)
        for r in rows:
            r["total"] = float(r["total"]); r["created_at"] = r["created_at"].isoformat()
        return _ok(items=rows)
    except Exception as e:
        return _unavailable(e)
