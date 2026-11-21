"""
MegaFab shared core: configuration, database access (RDS MySQL over TLS),
schema bootstrap and seed data. Used by both the web tier (Elastic Beanstalk)
and the fulfilment workers (EC2 Auto Scaling group).
"""
import json
import os
import time
import threading
import urllib.request

import boto3
import pymysql

REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
DB_SECRET_ARN = os.environ.get("DB_SECRET_ARN", "")
DB_HOST = os.environ.get("DB_HOST", "")
DB_NAME = os.environ.get("DB_NAME", "megafab")
ASSETS_BUCKET = os.environ.get("ASSETS_BUCKET", "")
DOCS_BUCKET = os.environ.get("DOCS_BUCKET", "")
ORDERS_QUEUE_URL = os.environ.get("ORDERS_QUEUE_URL", "")
DLQ_URL = os.environ.get("DLQ_URL", "")
TOPIC_ARN = os.environ.get("TOPIC_ARN", "")
SWF_DOMAIN = os.environ.get("SWF_DOMAIN", "MegaFab-Fulfilment")
KMS_KEY_ARN = os.environ.get("KMS_KEY_ARN", "")

# RDS CA bundle so every DB connection is verified TLS (encryption in transit)
CA_BUNDLE_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
CA_BUNDLE_PATH = os.environ.get("RDS_CA_PATH", "/tmp/rds-global-bundle.pem")

_session = boto3.session.Session(region_name=REGION)
s3 = _session.client("s3", config=boto3.session.Config(signature_version="s3v4"))
sqs = _session.client("sqs")
sns = _session.client("sns")
# SWF long-polls for up to 60 s, so the client must wait longer than that
swf = _session.client("swf", config=boto3.session.Config(read_timeout=75, connect_timeout=10, retries={"max_attempts": 5}))
secrets = _session.client("secretsmanager")

_creds_cache = {}
_creds_lock = threading.Lock()


def _db_credentials():
    with _creds_lock:
        if not _creds_cache or time.time() - _creds_cache.get("_t", 0) > 900:
            sec = json.loads(secrets.get_secret_value(SecretId=DB_SECRET_ARN)["SecretString"])
            _creds_cache.update(sec)
            _creds_cache["_t"] = time.time()
        return _creds_cache


def _ca_bundle():
    if not os.path.exists(CA_BUNDLE_PATH):
        urllib.request.urlretrieve(CA_BUNDLE_URL, CA_BUNDLE_PATH)
    return CA_BUNDLE_PATH


# Local development only: point at a local MySQL/MariaDB without Secrets Manager/TLS.
# Never set in Elastic Beanstalk - production always uses Secrets Manager + verified TLS.
DEV_DB_PASSWORD = os.environ.get("DEV_DB_PASSWORD")


def connect(database=True):
    if DEV_DB_PASSWORD:
        return pymysql.connect(host=os.environ.get("DEV_DB_HOST", "localhost"), user="megafab_admin", password=DEV_DB_PASSWORD,
                               database=DB_NAME if database else None, autocommit=True, connect_timeout=5,
                               cursorclass=pymysql.cursors.DictCursor)
    c = _db_credentials()
    return pymysql.connect(
        host=DB_HOST or c.get("host"),
        user=c["username"],
        password=c["password"],
        database=DB_NAME if database else None,
        port=int(c.get("port", 3306)),
        # verified TLS: trust only the RDS CA bundle and check the server hostname
        ssl_ca=_ca_bundle(),
        ssl_verify_cert=True,
        ssl_verify_identity=True,
        connect_timeout=8,
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def query(sql, args=None, one=False):
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
            return (rows[0] if rows else None) if one else rows
    finally:
        conn.close()


def execute(sql, args=None):
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.lastrowid
    finally:
        conn.close()


def add_event(order_id, status, detail, actor):
    execute(
        "INSERT INTO order_events(order_id,status,detail,actor) VALUES(%s,%s,%s,%s)",
        (order_id, status, detail[:480], actor[:60]),
    )
    execute("UPDATE orders SET status=%s, updated_at=NOW() WHERE id=%s", (status, order_id))


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS products(
        sku VARCHAR(20) PRIMARY KEY, name VARCHAR(120) NOT NULL, category VARCHAR(40),
        unit VARCHAR(20), price DECIMAL(10,2) NOT NULL, stock INT NOT NULL,
        reorder_level INT NOT NULL DEFAULT 50, image_key VARCHAR(200), description VARCHAR(400))""",
    """CREATE TABLE IF NOT EXISTS customers(
        id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(160) UNIQUE NOT NULL,
        company VARCHAR(160) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS orders(
        id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT NOT NULL, status VARCHAR(30) NOT NULL,
        total DECIMAL(12,2) NOT NULL DEFAULT 0, priority VARCHAR(12) DEFAULT 'STANDARD',
        workflow_run_id VARCHAR(80), invoice_key VARCHAR(200), tracking_no VARCHAR(40),
        carrier VARCHAR(40), eta DATE, served_by VARCHAR(60),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(customer_id), INDEX(status))""",
    """CREATE TABLE IF NOT EXISTS order_lines(
        id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, sku VARCHAR(20) NOT NULL,
        qty INT NOT NULL, unit_price DECIMAL(10,2) NOT NULL, INDEX(order_id))""",
    """CREATE TABLE IF NOT EXISTS order_events(
        id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, status VARCHAR(30) NOT NULL,
        detail VARCHAR(500), actor VARCHAR(60), ts TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), INDEX(order_id))""",
    """CREATE TABLE IF NOT EXISTS telemetry(
        id BIGINT AUTO_INCREMENT PRIMARY KEY, machine_id VARCHAR(30) NOT NULL, temperature DECIMAL(5,1),
        run_hours DECIMAL(9,1), fault_code VARCHAR(12), ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(machine_id, ts))""",
    """CREATE TABLE IF NOT EXISTS workers(
        instance_id VARCHAR(30) PRIMARY KEY, az VARCHAR(20), role VARCHAR(20), processed INT DEFAULT 0,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""",
]

# (sku, name, category, unit, price PKR, stock, description, colour, glyph)
CATALOGUE = [
    ("BRG-6205", "Deep-Groove Ball Bearing 6205-2RS", "Bearings", "piece", 850, 1200, "Sealed 25x52x15 mm bearing for motors and conveyors.", "#d97706", "bearing"),
    ("BRG-UCP208", "Pillow Block Bearing UCP208", "Bearings", "piece", 4200, 300, "Cast-iron housed unit, 40 mm bore, grease nipple.", "#d97706", "bearing"),
    ("HYD-HOSE-12", "Hydraulic Hose 1/2\" 2-Wire (10 m)", "Hydraulics", "roll", 9800, 140, "SAE 100R2AT, 275 bar working pressure.", "#2563eb", "hose"),
    ("HYD-PUMP-G16", "Gear Pump 16 cc/rev", "Hydraulics", "piece", 38500, 40, "Cast-aluminium gear pump for power packs.", "#2563eb", "pump"),
    ("PWR-VB-B52", "V-Belt B-52 Classic", "Power Transmission", "piece", 1150, 800, "Oil and heat resistant wrapped V-belt.", "#7c3aed", "belt"),
    ("PWR-GM-1.5", "Helical Gear Motor 1.5 kW", "Power Transmission", "piece", 96000, 25, "IE3 motor, 1:20 ratio, foot mount.", "#7c3aed", "motor"),
    ("FST-HEX-M12", "Hex Bolt M12x50 Grade 8.8 (box 100)", "Fasteners", "box", 3600, 600, "Zinc-plated high-tensile bolts.", "#475569", "bolt"),
    ("FST-ANC-M10", "Wedge Anchor M10 (box 50)", "Fasteners", "box", 2900, 450, "For machine base fixing in concrete.", "#475569", "bolt"),
    ("SAF-GLV-CUT5", "Cut-Resistant Gloves Level 5 (pair)", "Safety", "pair", 650, 2500, "HPPE liner, nitrile palm coating.", "#16a34a", "glove"),
    ("SAF-HLM-01", "Industrial Safety Helmet", "Safety", "piece", 1400, 900, "HDPE shell, 6-point ratchet suspension.", "#16a34a", "helmet"),
    ("LUB-CUT-20L", "Soluble Cutting Fluid (20 L)", "Lubricants", "drum", 14500, 120, "Semi-synthetic coolant for CNC machining.", "#0891b2", "drum"),
    ("LUB-GRS-EP2", "Lithium EP2 Grease (18 kg)", "Lubricants", "pail", 12800, 160, "Multipurpose extreme-pressure grease.", "#0891b2", "drum"),
]


def init_schema():
    """Idempotent: creates DB, tables and seed data. Uses a MySQL advisory lock so
    many instances starting at once (Auto Scaling) never seed twice."""
    conn = connect(database=False)
    try:
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
    finally:
        conn.close()
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT GET_LOCK('megafab_init', 30) AS l")
            for stmt in SCHEMA:
                cur.execute(stmt)
            cur.execute("SELECT COUNT(*) AS n FROM products")
            if cur.fetchone()["n"] == 0:
                for sku, name, cat, unit, price, stock, desc, colour, glyph in CATALOGUE:
                    key = f"catalogue/{sku}.svg"
                    if ASSETS_BUCKET:
                        try:
                            s3.put_object(Bucket=ASSETS_BUCKET, Key=key, Body=product_svg(name, cat, colour, glyph).encode(),
                                          ContentType="image/svg+xml", CacheControl="max-age=86400")
                        except Exception as e:  # images are non-critical
                            print("image upload failed", sku, e)
                    cur.execute(
                        "INSERT INTO products(sku,name,category,unit,price,stock,image_key,description) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                        (sku, name, cat, unit, price, stock, key, desc),
                    )
            cur.execute("SELECT RELEASE_LOCK('megafab_init')")
    finally:
        conn.close()


_GLYPHS = {
    "bearing": '<circle cx="160" cy="120" r="62" fill="none" stroke="#fff" stroke-width="16"/><circle cx="160" cy="120" r="26" fill="none" stroke="#fff" stroke-width="10"/>' + "".join(
        f'<circle cx="{160 + 44 * __import__("math").cos(i * 0.785):.1f}" cy="{120 + 44 * __import__("math").sin(i * 0.785):.1f}" r="8" fill="#fff"/>' for i in range(8)),
    "hose": '<path d="M70 170 C 90 40, 230 40, 250 170" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/><rect x="52" y="160" width="36" height="34" rx="4" fill="#fff"/><rect x="232" y="160" width="36" height="34" rx="4" fill="#fff"/>',
    "pump": '<rect x="90" y="70" width="140" height="100" rx="14" fill="none" stroke="#fff" stroke-width="12"/><circle cx="135" cy="120" r="24" fill="#fff"/><circle cx="185" cy="120" r="24" fill="none" stroke="#fff" stroke-width="8"/>',
    "belt": '<rect x="60" y="80" width="200" height="80" rx="40" fill="none" stroke="#fff" stroke-width="14"/><circle cx="100" cy="120" r="22" fill="#fff"/><circle cx="220" cy="120" r="22" fill="#fff"/>',
    "motor": '<rect x="70" y="80" width="120" height="80" rx="10" fill="#fff"/><rect x="190" y="105" width="60" height="30" fill="#fff"/>' + "".join(f'<rect x="{82 + i * 18}" y="70" width="8" height="100" fill="rgba(0,0,0,.18)"/>' for i in range(6)),
    "bolt": '<polygon points="130,50 190,50 210,85 190,120 130,120 110,85" fill="#fff"/><rect x="146" y="118" width="28" height="80" fill="#fff"/>' + "".join(f'<rect x="146" y="{128 + i * 12}" width="28" height="4" fill="rgba(0,0,0,.25)"/>' for i in range(6)),
    "glove": '<path d="M110 200 L110 110 Q110 95 122 95 L122 60 Q134 48 146 60 L146 90 L146 50 Q158 38 170 50 L170 90 L170 58 Q182 46 194 58 L194 110 L212 92 Q228 84 230 104 L200 160 L200 200 Z" fill="#fff"/>',
    "helmet": '<path d="M80 160 Q80 70 160 66 Q240 70 240 160 Z" fill="#fff"/><rect x="60" y="156" width="200" height="18" rx="9" fill="#fff"/><rect x="152" y="66" width="16" height="94" fill="rgba(0,0,0,.18)"/>',
    "drum": '<rect x="105" y="55" width="110" height="140" rx="10" fill="#fff"/><rect x="105" y="90" width="110" height="8" fill="rgba(0,0,0,.2)"/><rect x="105" y="150" width="110" height="8" fill="rgba(0,0,0,.2)"/><text x="160" y="132" font-size="22" text-anchor="middle" font-family="monospace" fill="rgba(0,0,0,.5)">OIL</text>',
}


def product_svg(name, category, colour, glyph):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
<defs><pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="rgba(255,255,255,.12)"/></pattern></defs>
<rect width="320" height="240" fill="{colour}"/><rect width="320" height="240" fill="url(#g)"/>
{_GLYPHS.get(glyph, "")}
<text x="14" y="226" font-family="monospace" font-size="12" fill="rgba(255,255,255,.85)">{category.upper()}</text></svg>'''


def product_svg_v2(sku, name, category, glyph):
    """NEXUS catalogue art: dark blueprint plate, amber/cyan line drawing, consistent 4:3 frame."""
    g = _GLYPHS.get(glyph, "").replace('fill="#fff"', 'fill="#FFB800"').replace('stroke="#fff"', 'stroke="#FFB800"') \
        .replace("rgba(0,0,0,.18)", "rgba(8,13,24,.55)").replace("rgba(0,0,0,.2)", "rgba(8,13,24,.55)") \
        .replace("rgba(0,0,0,.25)", "rgba(8,13,24,.55)").replace("rgba(0,0,0,.5)", "#080D18")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
<defs><radialGradient id="l" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#1F3150"/><stop offset="1" stop-color="#0B1322"/></radialGradient>
<pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="rgba(0,217,255,.07)"/></pattern></defs>
<rect width="320" height="240" fill="url(#l)"/><rect width="320" height="240" fill="url(#g)"/>
<circle cx="160" cy="120" r="92" fill="none" stroke="rgba(0,217,255,.18)" stroke-dasharray="3 6"/>
<g opacity=".95">{g}</g>
<text x="14" y="24" font-family="monospace" font-size="11" fill="rgba(0,217,255,.75)">{sku}</text>
<text x="306" y="226" font-family="monospace" font-size="10" text-anchor="end" fill="rgba(148,163,184,.8)">{category.upper()}</text></svg>'''


def ensure_v2_art():
    """Idempotently uploads the NEXUS artwork to S3 (catalogue/v2/<sku>.svg). Original images are kept."""
    if not ASSETS_BUCKET:
        return
    for sku, name, cat, unit, price, stock, desc, colour, glyph in CATALOGUE:
        key = f"catalogue/v2/{sku}.svg"
        try:
            s3.head_object(Bucket=ASSETS_BUCKET, Key=key)
        except Exception:
            try:
                s3.put_object(Bucket=ASSETS_BUCKET, Key=key, Body=product_svg_v2(sku, name, cat, glyph).encode(),
                              ContentType="image/svg+xml", CacheControl="max-age=86400")
            except Exception as e:
                print("v2 art upload failed", sku, e)


def instance_identity():
    """Instance id + AZ via IMDSv2 (works on EB and worker instances)."""
    try:
        req = urllib.request.Request("http://169.254.169.254/latest/api/token", method="PUT",
                                     headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
        tok = urllib.request.urlopen(req, timeout=1).read().decode()
        get = lambda p: urllib.request.urlopen(urllib.request.Request(
            "http://169.254.169.254/latest/meta-data/" + p, headers={"X-aws-ec2-metadata-token": tok}), timeout=1).read().decode()
        return get("instance-id"), get("placement/availability-zone")
    except Exception:
        return "local", "local"
