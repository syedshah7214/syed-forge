/* SYED FORGE - interactive AWS Architecture Explorer (vanilla SVG, pan/zoom, live badges, simulated flows) */
(function () {
  const W = 1800, H = 1100;
  const C = { amber: "#FFB800", cyan: "#00D9FF", green: "#22C55E", red: "#FF4D67", muted: "#94A3B8", text: "#F5F8FF" };

  // ---------------------------------------------------------------- model
  const groups = [
    { id: "region", x: 380, y: 40, w: 1390, h: 1040, label: "AWS Cloud · us-east-1", c: "rgba(148,163,184,.35)", f: "rgba(16,26,45,.35)" },
    { id: "appvpc", x: 410, y: 80, w: 900, h: 680, label: "Application VPC · 10.10.0.0/16", c: "rgba(0,217,255,.55)", f: "rgba(0,217,255,.03)" },
    { id: "aza", x: 430, y: 112, w: 420, h: 630, label: "Availability Zone A · us-east-1a", c: "rgba(148,163,184,.3)", dash: "6 6" },
    { id: "azb", x: 870, y: 112, w: 420, h: 630, label: "Availability Zone B · us-east-1b", c: "rgba(148,163,184,.3)", dash: "6 6" },
    { id: "pub", x: 440, y: 142, w: 840, h: 150, label: "Public subnets 10.10.0.0/24 · 10.10.1.0/24", c: "rgba(34,197,94,.35)", f: "rgba(34,197,94,.04)" },
    { id: "app", x: 440, y: 312, w: 840, h: 200, label: "Private app subnets 10.10.10.0/24 · 10.10.11.0/24", c: "rgba(0,217,255,.3)", f: "rgba(0,217,255,.03)" },
    { id: "data", x: 440, y: 532, w: 840, h: 190, label: "Isolated data subnets 10.10.20.0/24 · 10.10.21.0/24 — no internet route", c: "rgba(168,85,247,.4)", f: "rgba(168,85,247,.04)" },
    { id: "mgmt", x: 1340, y: 80, w: 410, h: 420, label: "Management VPC · 10.20.0.0/16", c: "rgba(255,77,103,.5)", f: "rgba(255,77,103,.03)" },
    { id: "regional", x: 410, y: 790, w: 1340, h: 270, label: "Regional managed services", c: "rgba(148,163,184,.25)", f: "rgba(8,13,24,.25)" },
  ];
  const N = [
    { id: "customer", x: 40, y: 110, w: 250, label: "B2B customers", sub: "browser · HTTPS", k: "ext" },
    { id: "machines", x: 40, y: 230, w: 250, label: "Factory machines", sub: "telemetry API", k: "ext" },
    { id: "r53", x: 40, y: 400, w: 250, label: "Route 53", sub: "public + private zones", k: "net" },
    { id: "nat", x: 460, y: 190, w: 190, label: "NAT gateway", sub: "outbound only", k: "net" },
    { id: "alb", x: 690, y: 190, w: 380, label: "Application Load Balancer", sub: "HTTP 80 · HTTPS 443 · both AZs", k: "net" },
    { id: "s3ep", x: 1095, y: 190, w: 170, label: "S3 endpoint", sub: "gateway · free", k: "net" },
    { id: "weba", x: 460, y: 352, w: 370, label: "EC2 web · Elastic Beanstalk", sub: "AZ-a", k: "compute", live: "web" },
    { id: "webb", x: 900, y: 352, w: 370, label: "EC2 web · Elastic Beanstalk", sub: "AZ-b", k: "compute", live: "web" },
    { id: "wka", x: 460, y: 432, w: 370, label: "Fulfilment worker", sub: "AL2023 AMI · AZ-a", k: "compute", live: "wk" },
    { id: "wkb", x: 900, y: 432, w: 370, label: "Fulfilment worker", sub: "AL2023 AMI · AZ-b", k: "compute", live: "wk" },
    { id: "rdsp", x: 460, y: 590, w: 370, label: "RDS MySQL 8.0 · primary", sub: "KMS · TLS · 7-day backups", k: "db", live: "rds" },
    { id: "rdss", x: 900, y: 590, w: 370, label: "RDS standby", sub: "synchronous replica", k: "db" },
    { id: "bastion", x: 1365, y: 130, w: 360, label: "Bastion / admin host", sub: "Session Manager · no open SSH", k: "sec" },
    { id: "ssm", x: 1365, y: 210, w: 360, label: "Systems Manager", sub: "Session Manager · Run Command", k: "sec" },
    { id: "pzone", x: 1365, y: 290, w: 360, label: "Private DNS · megafab.internal", sub: "app · db · bastion", k: "net" },
    { id: "peer", x: 1365, y: 400, w: 360, label: "VPC peering", sub: "10.20/16 ⇄ 10.10/16", k: "net" },
    { id: "sqs", x: 430, y: 840, w: 150, label: "SQS orders", sub: "KMS · long poll", k: "int", live: "sqs" },
    { id: "dlq", x: 595, y: 840, w: 150, label: "Dead-letter queue", sub: "5 receives", k: "int", live: "dlq" },
    { id: "swf", x: 760, y: 840, w: 150, label: "Amazon SWF", sub: "OrderFulfilment", k: "int", live: "swf" },
    { id: "sns", x: 925, y: 840, w: 150, label: "Amazon SNS", sub: "filtered email", k: "int" },
    { id: "s3a", x: 1090, y: 840, w: 150, label: "S3 assets", sub: "product images", k: "store" },
    { id: "s3d", x: 1255, y: 840, w: 150, label: "S3 documents", sub: "invoices · backups", k: "store" },
    { id: "s3l", x: 1420, y: 840, w: 150, label: "S3 logs", sub: "ALB · flow logs", k: "store" },
    { id: "s3u", x: 1585, y: 840, w: 150, label: "S3 audit", sub: "CloudTrail", k: "store" },
    { id: "kms", x: 430, y: 955, w: 150, label: "AWS KMS", sub: "alias/megafab-data", k: "sec" },
    { id: "secrets", x: 595, y: 955, w: 150, label: "Secrets Manager", sub: "DB credentials", k: "sec" },
    { id: "trail", x: 760, y: 955, w: 150, label: "CloudTrail", sub: "multi-region", k: "sec" },
    { id: "cw", x: 925, y: 955, w: 150, label: "CloudWatch", sub: "dashboard · alarms", k: "ops" },
    { id: "iam", x: 1090, y: 955, w: 150, label: "IAM", sub: "least privilege", k: "sec" },
    { id: "ta", x: 1255, y: 955, w: 150, label: "Trusted Advisor", sub: "reviewed via CLI", k: "ops" },
    { id: "cfn", x: 1420, y: 955, w: 315, label: "CloudFormation", sub: "megafab-platform + 6 nested stacks", k: "ops" },
  ].map((n) => ({ h: n.h || 56, ...n }));
  const byId = Object.fromEntries(N.map((n) => [n.id, n]));
  const KC = { ext: C.muted, net: "#A78BFA", compute: C.amber, db: "#C084FC", int: "#F472B6", store: C.green, sec: C.cyan, ops: C.muted };

  const E = [
    ["customer", "r53", "req"], ["r53", "alb", "req"], ["machines", "alb", "req"], ["alb", "weba", "req"], ["alb", "webb", "req"],
    ["weba", "rdsp", "req"], ["webb", "rdsp", "req"], ["rdsp", "rdss", "rep"], ["weba", "s3a", "req2"],
    ["weba", "sqs", "ord"], ["webb", "sqs", "ord"], ["sqs", "wka", "ord"], ["sqs", "wkb", "ord"], ["sqs", "dlq", "fail"],
    ["wka", "swf", "ord"], ["wkb", "swf", "ord"], ["wka", "rdsp", "ord2"], ["wkb", "rdsp", "ord2"], ["wkb", "s3d", "ord3"], ["wkb", "sns", "ord4"],
    ["peer", "rdss", "adm"], ["bastion", "peer", "adm"], ["ssm", "bastion", "adm"], ["nat", "weba", "net"], ["s3ep", "webb", "net"], ["pzone", "peer", "adm"],
  ].map(([a, b, t], i) => ({ id: "e" + i, a, b, t }));
  const FLOWS = {
    request: { label: "Customer request", color: "req", chain: ["customer", "r53", "alb", "weba", "rdsp"], alt: [["alb", "webb"], ["webb", "rdsp"]] },
    order: { label: "Order processing", color: "order", chain: ["weba", "sqs", "wka", "swf", "wka", "rdsp"], tail: [["wkb", "s3d"], ["wkb", "sns"]] },
    admin: { label: "Admin access", color: "req", chain: ["ssm", "bastion", "peer", "rdss"] },
  };

  const INFO = {
    customer: ["B2B customers", "Factories and workshops placing bulk orders.", "Reach the portal by DNS name over HTTP/HTTPS.", ["Route 53", "Application Load Balancer"]],
    machines: ["Factory machines", "Shop-floor equipment posting temperature, run-hours and fault codes.", "POST /api/telemetry · faults trigger a staff SNS alert.", ["ALB", "EC2 web tier", "SNS"]],
    r53: ["Amazon Route 53", "Friendly names and health checking.", "Public zone megafab-macloud.com (www, portal → Beanstalk) · private zone megafab.internal for both VPCs · HTTP health check on /health.", ["ALB", "Private DNS"]],
    nat: ["NAT gateway", "Lets private instances reach the internet for packages without being reachable from it.", "One NAT in AZ-a (HighAvailabilityNat=true adds one per AZ).", ["EC2 web", "Workers"]],
    alb: ["Application Load Balancer", "Spreads customer traffic over healthy web instances in both AZs.", "Listeners 80 and 443 (TLS 1.3 policy) · health check /health every 10 s · access logs to S3.", ["EC2 web tier", "S3 logs"]],
    s3ep: ["S3 gateway endpoint", "Keeps S3 traffic on the AWS network and off the NAT bill.", "Attached to public and private route tables.", ["EC2", "S3 buckets"]],
    weba: ["EC2 web tier (Elastic Beanstalk)", "Runs the customer portal and these APIs; only enqueues orders.", "Python 3.12 on AL2023 · t3.micro · Auto Scaling min 2 / max 6 · +2 at CPU > 45 %, −1 below 15 %.", ["ALB", "RDS", "SQS", "S3 assets"]],
    wka: ["Fulfilment workers (EC2 Auto Scaling)", "Poll SQS, start SWF workflows and run the 5 activities.", "Launch template from the AL2023 AMI · encrypted root + data EBS · ASG 1–4 scaling on SQS depth.", ["SQS", "SWF", "RDS", "S3 documents", "SNS"]],
    rdsp: ["Amazon RDS MySQL 8.0", "System of record for products, customers, orders, events and telemetry.", "Multi-AZ · KMS encrypted · require_secure_transport · 7-day automated backups + point-in-time restore.", ["Web tier", "Workers", "Secrets Manager", "KMS"]],
    rdss: ["RDS Multi-AZ standby", "Synchronous replica in the other AZ.", "Automatic DNS failover in roughly 1–2 minutes; zero data loss.", ["RDS primary", "VPC peering (DBA access)"]],
    bastion: ["Bastion / admin host", "DBA and operator access from the management VPC.", "No inbound SSH (security group closed) · reached through Session Manager · megafab-db and megafab-backup tools.", ["Systems Manager", "VPC peering", "RDS"]],
    ssm: ["AWS Systems Manager", "Session Manager shell access and Run Command, used instead of open SSH.", "Instance role with SSM permissions; every session is logged by CloudTrail.", ["Bastion", "EC2"]],
    pzone: ["Route 53 private zone", "Stable internal names: app., db., bastion.megafab.internal.", "Associated with both VPCs.", ["VPC peering", "RDS"]],
    peer: ["VPC peering", "Private, non-transitive link from the management VPC to the application VPC.", "Routes 10.20.0.0/16 ⇄ 10.10.0.0/16 in every route table; DB security group and data NACL allow 3306 from 10.20/16.", ["Bastion", "RDS"]],
    sqs: ["Amazon SQS — megafab-orders", "Buffers orders so the website never waits on fulfilment.", "KMS encrypted · 20 s long polling · visibility 60 s · redrive to DLQ after 5 receives · TLS-only policy.", ["Web tier", "Workers", "DLQ"]],
    dlq: ["Dead-letter queue", "Holds orders that failed 5 times so none are lost.", "CloudWatch alarm emails operations · redrive with start-message-move-task.", ["SQS", "CloudWatch"]],
    swf: ["Amazon SWF — MegaFab-Fulfilment", "Coordinates the multi-step fulfilment workflow.", "OrderFulfilment v1.0: Validate → Reserve stock → Invoice → Ship → Notify · timed-out steps retried on another worker.", ["Workers", "SQS"]],
    sns: ["Amazon SNS", "Order and maintenance notifications.", "order-events topic with filter policies (customers only see their own orders) · ops-alarms topic · KMS encrypted.", ["Workers", "Web tier", "CloudWatch"]],
    s3a: ["S3 assets bucket", "Product images served by pre-signed URL.", "SSE-KMS + bucket key · versioning · Block Public Access · TLS-only policy.", ["Web tier", "KMS"]],
    s3d: ["S3 documents bucket", "Invoices and database backups.", "SSE-KMS · lifecycle to IA / Glacier · rejects uploads under any other key.", ["Workers", "Bastion", "KMS"]],
    s3l: ["S3 logs bucket", "ALB access logs, S3 access logs and VPC flow logs.", "SSE-S3 (required by ALB logs) · 90-day expiry.", ["ALB", "VPC"]],
    s3u: ["S3 audit bucket", "CloudTrail log files and integrity digests.", "SSE-KMS · deletion denied by bucket policy · Glacier after 90 days.", ["CloudTrail", "KMS"]],
    kms: ["AWS KMS — alias/megafab-data", "One customer-managed key for data at rest.", "Encrypts RDS, S3, EBS (account default), SQS, SNS, Secrets Manager and CloudTrail · annual rotation.", ["Every data store"]],
    secrets: ["AWS Secrets Manager", "Generated RDS master password — never in code or templates.", "KMS encrypted; read at runtime by the instance role.", ["RDS", "Web tier", "Workers"]],
    trail: ["AWS CloudTrail", "Records every API call for audit.", "Multi-region · log-file validation · KMS · S3 data events on invoices.", ["S3 audit", "KMS"]],
    cw: ["Amazon CloudWatch", "Dashboard, alarms and log streaming.", "Alarms: DLQ, queue backlog (drives worker scaling), RDS CPU, portal health check, billing.", ["SNS", "Auto Scaling"]],
    iam: ["AWS IAM", "Least-privilege access for people and instances.", "Job-role managed policies + MFA enforcement; instances use roles, never access keys.", ["All services"]],
    ta: ["AWS Trusted Advisor", "Cost, security and fault-tolerance review.", "Blocked in the Learner Lab, so the same checks run via scripts/evidence.sh ta.", ["CloudWatch", "IAM"]],
    cfn: ["AWS CloudFormation", "Builds everything as code.", "megafab-platform root + foundation, network, security, data, integration, compute, governance stacks.", ["All resources"]],
  };
  INFO.webb = INFO.weba; INFO.wkb = INFO.wka;

  // ---------------------------------------------------------------- render
  const host = document.getElementById("arch"), svgNS = "http://www.w3.org/2000/svg";
  const el = (t, a = {}, p) => { const e = document.createElementNS(svgNS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "MegaFab AWS architecture" }, host);
  const root = el("g", {}, svg);
  groups.forEach((g) => {
    el("rect", { x: g.x, y: g.y, width: g.w, height: g.h, rx: 16, fill: g.f || "none", stroke: g.c, "stroke-dasharray": g.dash || "", id: "g-" + g.id }, root);
    el("text", { x: g.x + 14, y: g.y + 20, fill: g.c.replace(/[\d.]+\)$/, ".95)"), "font-size": 12.5, "font-weight": 650, "font-family": "Inter" }, root).textContent = g.label;
  });
  const edgeLayer = el("g", {}, root), nodeLayer = el("g", {}, root), pktLayer = el("g", {}, root);
  const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];
  function clip(n, tx, ty) { // point where the line to (tx,ty) leaves node n's box
    const [cx, cy] = center(n), dx = tx - cx, dy = ty - cy, sx = (n.w / 2) / Math.abs(dx || 1e-6), sy = (n.h / 2) / Math.abs(dy || 1e-6), s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  }
  E.forEach((e) => {
    const A = byId[e.a], B = byId[e.b], [bx, by] = center(B), [ax, ay] = center(A);
    const p1 = clip(A, bx, by), p2 = clip(B, ax, ay), mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
    const d = Math.abs(p1[0] - p2[0]) > Math.abs(p1[1] - p2[1]) ? `M${p1}C${mx},${p1[1]} ${mx},${p2[1]} ${p2}` : `M${p1}C${p1[0]},${my} ${p2[0]},${my} ${p2}`;
    e.path = el("path", { d, class: "edge", "stroke-dasharray": e.t === "rep" || e.t === "fail" || e.t === "adm" ? "5 5" : "" }, edgeLayer);
  });
  N.forEach((n) => {
    const g = el("g", { class: "anode", tabindex: 0, role: "button", "aria-label": n.label, "data-id": n.id }, nodeLayer);
    el("rect", { class: "box", x: n.x, y: n.y, width: n.w, height: n.h, rx: 11, fill: "#132036", stroke: "rgba(148,163,184,.3)", "stroke-width": 1.3 }, g);
    el("rect", { x: n.x, y: n.y + 10, width: 4, height: n.h - 20, rx: 2, fill: KC[n.k] }, g);
    el("text", { x: n.x + 16, y: n.y + 23, fill: C.text, "font-size": 14, "font-weight": 650, "font-family": "Inter" }, g).textContent = n.label;
    el("text", { x: n.x + 16, y: n.y + 42, fill: C.muted, "font-size": 11.5, "font-family": "JetBrains Mono, monospace" }, g).textContent = n.sub;
    n.badge = el("text", { x: n.x + n.w - 12, y: n.y + 23, fill: C.green, "font-size": 11, "font-weight": 600, "text-anchor": "end", "font-family": "JetBrains Mono, monospace" }, g);
    g.addEventListener("click", () => select(n.id)); g.addEventListener("keydown", (ev) => ev.key === "Enter" && select(n.id));
  });
  // AZ-a failure overlay (Multi-AZ explanation)
  const fail = el("g", { opacity: 0, style: "transition:opacity .4s;pointer-events:none" }, root);
  el("rect", { x: 430, y: 112, width: 420, height: 630, rx: 14, fill: "rgba(255,77,103,.12)", stroke: C.red, "stroke-dasharray": "8 6" }, fail);
  el("text", { x: 640, y: 770, fill: C.red, "font-size": 14, "font-weight": 700, "text-anchor": "middle", "font-family": "Inter" }, fail).textContent = "SIMULATED: AZ-a unavailable → ALB uses AZ-b, RDS standby is promoted, ASGs relaunch in AZ-b";

  // ---------------------------------------------------------------- pan & zoom
  const FIT = { x: -20, y: -70, w: W + 40, h: H + 120 };
  let vb = { ...FIT };
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const zoom = (f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const nw = Math.min(W * 1.6, Math.max(W / 5, vb.w * f)), k = nw / vb.w;
    vb = { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: nw, h: vb.h * k }; apply();
  };
  host.addEventListener("wheel", (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.12 : 0.89, vb.x + (e.clientX - r.left) / r.width * vb.w, vb.y + (e.clientY - r.top) / r.height * vb.h); }, { passive: false });
  let drag = null;
  host.addEventListener("pointerdown", (e) => { if (e.target.closest(".anode") || e.target.closest("button")) return; drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; host.classList.add("drag"); host.setPointerCapture(e.pointerId); });
  host.addEventListener("pointermove", (e) => { if (!drag) return; const r = svg.getBoundingClientRect(); vb.x = drag.vb.x - (e.clientX - drag.x) / r.width * vb.w; vb.y = drag.vb.y - (e.clientY - drag.y) / r.height * vb.h; apply(); });
  host.addEventListener("pointerup", () => { drag = null; host.classList.remove("drag"); });
  document.getElementById("z-in").onclick = () => zoom(0.8); document.getElementById("z-out").onclick = () => zoom(1.25);
  document.getElementById("z-fit").onclick = () => { vb = { ...FIT }; apply(); };

  // ---------------------------------------------------------------- details panel
  let live = {};
  const drawer = document.getElementById("drawer"), scrim = document.getElementById("scrim");
  function select(id) {
    document.querySelectorAll(".anode").forEach((g) => g.classList.toggle("sel", g.dataset.id === id));
    E.forEach((e) => e.path.classList.toggle("hl", e.a === id || e.b === id));
    const [name, purpose, cfg, rel] = INFO[id] || [byId[id].label, "", "", []];
    const st = liveText(id);
    document.getElementById("d-kind").textContent = (byId[id].k || "").toUpperCase();
    document.getElementById("d-body").innerHTML = `<h2 style="font-size:22px;margin:0 0 6px">${NX.esc(name)}</h2><p class="muted" style="margin:0 0 18px">${NX.esc(purpose)}</p>
      <span class="eyebrow">Configuration</span><p style="margin:8px 0 18px">${NX.esc(cfg)}</p>
      <span class="eyebrow">Connected to</span><div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 18px">${rel.map((r) => `<span class="badge">${NX.esc(r)}</span>`).join("")}</div>
      <span class="eyebrow">Current status</span><div style="margin-top:10px">${st || '<span class="badge info">No live metric for this service — configuration shown above is from CloudFormation</span>'}</div>`;
    drawer.classList.add("open"); scrim.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
  }
  const close = () => { drawer.classList.remove("open"); scrim.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); document.querySelectorAll(".anode.sel").forEach((g) => g.classList.remove("sel")); };
  scrim.onclick = close; document.getElementById("d-close").onclick = close; document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  function liveText(id) {
    const s = live.summary, c = live.compute; if (!s) return "";
    const b = (cls, t) => `<span class="badge ${cls}" style="margin:0 6px 6px 0">${t}</span>`;
    const probe = (n) => (s.health.probes || []).find((p) => p.name.startsWith(n));
    if ((id === "weba" || id === "webb") && c && c.state === "ok" && c.web) return b("ok", `${c.web.in_service} in service`) + b("", `desired ${c.web.desired} · ${c.web.min}–${c.web.max}`) + c.web.instances.map((i) => b(i.health === "Healthy" ? "ok" : "warn", `${i.id} · ${i.az}`)).join("");
    if ((id === "wka" || id === "wkb") && s.workers.state === "ok") return b(s.workers.healthy ? "ok" : "bad", `${s.workers.healthy} worker heartbeat(s) < 90 s`) + (c && c.workers ? b("", `ASG ${c.workers.in_service}/${c.workers.desired} · ${c.workers.min}–${c.workers.max}`) : "");
    if (id === "rdsp" && probe("RDS")) return b(probe("RDS").state === "ok" ? "ok" : "bad", `query probe ${probe("RDS").state} · ${probe("RDS").ms} ms`);
    if (id === "sqs" && s.queues.state === "ok") return b("ok", `${s.queues.orders.waiting} waiting`) + b("", `${s.queues.orders.inflight} in flight`);
    if (id === "dlq" && s.queues.state === "ok") return b(s.queues.dlq.waiting ? "bad" : "ok", `${s.queues.dlq.waiting} message(s)`);
    if (id === "swf" && s.workflows.state === "ok") return b("ok", `${s.workflows.open} open`) + b("", `${s.workflows.closed} closed (24 h)`);
    if (id === "sns" && probe("SNS")) return b(probe("SNS").state === "ok" ? "ok" : "bad", `topic reachable · ${probe("SNS").ms} ms`);
    if (id === "s3a" && probe("S3")) return b(probe("S3").state === "ok" ? "ok" : "bad", `bucket reachable · ${probe("S3").ms} ms`);
    if (id === "secrets" && probe("Secrets")) return b(probe("Secrets").state === "ok" ? "ok" : "bad", `secret readable by role · ${probe("Secrets").ms} ms`);
    return "";
  }
  async function refresh() {
    try {
      const [s, c] = await Promise.all([NX.get("/api/ops/summary"), NX.get("/api/ops/compute")]);
      live = { summary: s, compute: c }; NX.stamp();
      const set = (ids, t, col = C.green) => ids.forEach((i) => { byId[i].badge.textContent = t; byId[i].badge.setAttribute("fill", col); });
      if (c.state === "ok" && c.web) {
        const az = (z) => c.web.instances.filter((i) => i.az.endsWith(z) && i.lifecycle === "InService").length;
        byId.weba.badge.textContent = `${az("a")} live`; byId.webb.badge.textContent = `${az("b")} live`;
        renderCapacity(c);
      } else document.getElementById("capacity").innerHTML = '<div class="empty">Auto Scaling API unavailable from the app role.</div>';
      if (c.state === "ok" && c.workers) {
        const az = (z) => c.workers.instances.filter((i) => i.az.endsWith(z) && i.lifecycle === "InService").length;
        byId.wka.badge.textContent = `${az("a")} live`; byId.wkb.badge.textContent = `${az("b")} live`;
      }
      if (s.queues.state === "ok") { set(["sqs"], `${s.queues.orders.waiting} waiting`, s.queues.orders.waiting > 10 ? C.amber : C.green); set(["dlq"], `${s.queues.dlq.waiting}`, s.queues.dlq.waiting ? C.red : C.green); }
      if (s.workflows.state === "ok") set(["swf"], `${s.workflows.open} open`);
      const rp = (s.health.probes || []).find((p) => p.name.startsWith("RDS")); if (rp) set(["rdsp"], rp.state === "ok" ? `${rp.ms} ms` : "DOWN", rp.state === "ok" ? C.green : C.red);
    } catch (e) { /* banner handles it */ }
  }
  function renderCapacity(c) {
    const row = (name, g) => !g ? "" : `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px"><b>${name}</b><span class="mono muted">${g.in_service} live · desired ${g.desired} · ${g.min}–${g.max}</span></div>
      <div style="position:relative;height:26px;margin-top:8px;border-radius:8px;background:rgba(148,163,184,.08);overflow:hidden">
        <div style="position:absolute;inset:0 auto 0 0;width:${g.max ? g.min / g.max * 100 : 0}%;background:rgba(148,163,184,.12)"></div>
        <div style="position:absolute;inset:4px auto 4px 0;width:${g.max ? g.in_service / g.max * 100 : 0}%;border-radius:6px;background:linear-gradient(90deg,var(--amber),#ffd45c);transition:width .8s"></div>
        ${Array.from({ length: g.max }, (_, i) => `<span style="position:absolute;top:0;bottom:0;left:${(i + 1) / g.max * 100}%;border-left:1px solid rgba(8,13,24,.8)"></span>`).join("")}</div>
      <div class="mono dim" style="font-size:10.5px;margin-top:4px">grey = configured minimum · amber = instances actually in service · ticks = max capacity</div></div>`;
    document.getElementById("capacity").innerHTML = row("Web tier (Elastic Beanstalk ASG)", c.web) + row("Fulfilment workers ASG", c.workers);
  }

  // ---------------------------------------------------------------- simulated flows (clearly labelled)
  let anim = null;
  function play(name) {
    stop(); const f = FLOWS[name]; const sim = document.getElementById("sim"); sim.hidden = false; sim.querySelector("b").textContent = f.label;
    const segs = [];
    for (let i = 0; i < f.chain.length - 1; i++) segs.push([f.chain[i], f.chain[i + 1]]);
    (f.alt || []).concat(f.tail || []).forEach((s) => segs.push(s));
    const edges = segs.map(([a, b]) => { const e = E.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)); return e && { e, rev: e.a !== a }; }).filter(Boolean);
    edges.forEach(({ e }) => e.path.classList.add("hl", ...(f.color === "order" ? ["order"] : [])));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; if (reduce) return;
    const pk = edges.map(({ e, rev }, i) => ({ e, rev, c: el("circle", { r: 6, class: "packet " + (f.color === "order" ? "order" : "") }, pktLayer), off: i * 0.55 }));
    const t0 = performance.now(), L = pk.map((p) => p.e.path.getTotalLength());
    const step = (t) => {
      const s = (t - t0) / 1000;
      pk.forEach((p, i) => { const k = ((s - p.off) % (pk.length * 0.55 + 0.8)) / 0.9; if (k < 0 || k > 1) { p.c.setAttribute("opacity", 0); return; }
        const pt = p.e.path.getPointAtLength((p.rev ? 1 - k : k) * L[i]); p.c.setAttribute("cx", pt.x); p.c.setAttribute("cy", pt.y); p.c.setAttribute("opacity", 1); });
      anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function stop() { cancelAnimationFrame(anim); pktLayer.innerHTML = ""; E.forEach((e) => e.path.classList.remove("hl", "order")); document.getElementById("sim").hidden = true; fail.setAttribute("opacity", 0); }
  document.querySelectorAll("[data-flow]").forEach((b) => b.addEventListener("click", () => play(b.dataset.flow)));
  document.getElementById("f-stop").onclick = stop;
  document.getElementById("f-az").onclick = () => { stop(); fail.setAttribute("opacity", 1); const sim = document.getElementById("sim"); sim.hidden = false; sim.querySelector("b").textContent = "AZ failure (Multi-AZ)";
    ["alb", "webb", "rdss", "wkb"].forEach((i) => E.filter((e) => e.a === i || e.b === i).forEach((e) => e.path.classList.add("hl"))); };

  // ---------------------------------------------------------------- architecture layers
  const LAYERS = { all: null, network: ["ext", "net"], compute: ["compute", "ext"], data: ["db", "store"], integration: ["int", "compute"], security: ["sec", "ops"] };
  document.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-layer]").forEach((x) => x.classList.toggle("on", x === b));
    const ks = LAYERS[b.dataset.layer], show = (id) => !ks || ks.includes(byId[id].k);
    document.querySelectorAll(".anode").forEach((g) => g.classList.toggle("dimmed", !show(g.dataset.id)));
    E.forEach((e) => e.path.classList.toggle("dimmed", !(show(e.a) && show(e.b))));
  }));
  // deep link from the Command Center map: /ops/architecture#rdsp
  const fromHash = () => { const id = decodeURIComponent(location.hash.slice(1)); if (byId[id]) select(id); };
  addEventListener("hashchange", fromHash); setTimeout(fromHash, 300);

  NX.poll(refresh, 20000);
})();
