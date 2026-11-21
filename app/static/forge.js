/* SYED FORGE — cinematic intro, industrial hero scene, console alerts & account menu.
   No external libraries: canvas + CSS only, so nothing blocks the application from loading. */
(function () {
  const F = (window.FORGE = window.FORGE || {});
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LOGO = document.documentElement.dataset.logo;
  const KEY = "forge-intro-seen";
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return "1"; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  // =====================================================================
  //  1. Cinematic intro
  // =====================================================================
  F.intro = function (force) {
    const html = document.documentElement;
    if (reduce || (!force && ss.get(KEY))) { html.classList.remove("intro-pending"); return; }
    ss.set(KEY, "1");
    if (document.querySelector(".forge-intro")) return;
    html.classList.add("intro-pending");
    const root = document.createElement("div");
    root.className = "forge-intro"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "SYED FORGE introduction");
    root.innerHTML = `<canvas></canvas><div class="grid3d"></div>
      <div class="stage"><div class="logo-wrap"><div class="halo"></div><img class="syed-logo" src="${LOGO}" alt="SYED logo" decoding="async"></div>
        <div class="title"><h1>SYED FORGE</h1></div>
        <div class="rule"><i></i><span class="tag">Engineered for Industry. Powered by AWS.</span><i></i></div></div>
      <div class="meta">INDUSTRIAL CLOUD &amp; SUPPLY INTELLIGENCE · ${(html.dataset.region || "").toUpperCase()}</div>
      <button class="skip" type="button">SKIP INTRO ›</button>`;
    document.body.appendChild(root);
    const cv = root.querySelector("canvas"), ctx = cv.getContext("2d");
    let W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener("resize", size);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const P = Array.from({ length: Math.round(Math.min(170, W / 9)) }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(.4, 1.8), v: rnd(.05, .35), a: rnd(0, 6.28), d: rnd(0, .5) }));
    const T = Array.from({ length: 18 }, (_, i) => {
      const ang = (i / 18) * Math.PI * 2 + rnd(-.15, .15), R = Math.hypot(W, H) * .62;
      return { sx: W / 2 + Math.cos(ang) * R, sy: H / 2 + Math.sin(ang) * R * .7, cx: W / 2 + Math.cos(ang + 1.1) * R * .45, cy: H / 2 + Math.sin(ang + 1.1) * R * .3,
        t0: .45 + rnd(0, .35), dur: rnd(.8, 1.1), hue: Math.random() < .2 ? "255,184,0" : "0,190,255" };
    });
    const q = (t, a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
    const start = performance.now(); let raf, done = false;
    function frame(now) {
      const s = (now - start) / 1000;
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .6);
      g.addColorStop(0, `rgba(0,90,200,${Math.min(.16, s * .08)})`); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (const p of P) {                                   // atmospheric particles
        const a = Math.min(1, Math.max(0, (s - p.d) * 1.6)) * (.35 + .35 * Math.sin(now / 900 + p.a));
        p.y -= p.v; p.x += Math.sin(now / 2000 + p.a) * .15; if (p.y < -4) p.y = H + 4;
        ctx.fillStyle = `rgba(120,210,255,${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
      }
      ctx.globalCompositeOperation = "lighter";
      for (const t of T) {                                   // converging light trails
        const k = (s - t.t0) / t.dur; if (k <= 0 || k > 1.35) continue;
        const head = Math.min(1, k), tail = Math.max(0, head - .38), fade = k > 1 ? 1 - (k - 1) / .35 : 1;
        ctx.lineCap = "round";
        for (let j = 0; j < 14; j++) {
          const u0 = tail + (head - tail) * (j / 14), u1 = tail + (head - tail) * ((j + 1) / 14);
          ctx.strokeStyle = `rgba(${t.hue},${(j / 14) * .85 * fade})`; ctx.lineWidth = .6 + j * .16;
          ctx.beginPath(); ctx.moveTo(q(u0, t.sx, t.cx, W / 2), q(u0, t.sy, t.cy, H / 2)); ctx.lineTo(q(u1, t.sx, t.cx, W / 2), q(u1, t.sy, t.cy, H / 2)); ctx.stroke();
        }
      }
      const burst = s - 1.45;                               // convergence bloom
      if (burst > 0 && burst < 1.4) {
        const r = 40 + burst * 420, a = (1 - burst / 1.4) * .5;
        const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
        bg.addColorStop(0, `rgba(160,225,255,${a})`); bg.addColorStop(1, "rgba(0,120,255,0)");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = `rgba(0,217,255,${a * .7})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, r * 1.3, r * .42, 0, 0, 6.28); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      if (!done) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    const at = (ms, fn) => setTimeout(() => !done && fn(), ms);
    at(950, () => root.classList.add("s-grid"));
    at(1500, () => root.classList.add("s-logo"));
    at(2550, () => root.classList.add("s-text"));
    at(4100, () => exit(false));
    function exit(skipped) {
      if (done) return;
      root.classList.add("s-exit");
      html.classList.remove("intro-pending");
      document.body.classList.add("forge-reveal");
      const target = [...document.querySelectorAll(".fb .syed-logo")].find((e) => e.getBoundingClientRect().width > 0);
      const wrap = root.querySelector(".logo-wrap");
      if (target && !skipped) {                               // logo flies into its place in the interface
        const a = wrap.getBoundingClientRect(), b = target.getBoundingClientRect();
        wrap.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.width / a.width})`;
      }
      setTimeout(() => root.classList.add("out"), skipped ? 0 : 420);
      setTimeout(() => { done = true; cancelAnimationFrame(raf); root.remove(); removeEventListener("resize", size); setTimeout(() => document.body.classList.remove("forge-reveal"), 1200); }, skipped ? 900 : 1400);
      document.removeEventListener("keydown", key);
    }
    const key = (e) => (e.key === "Escape" || e.key === "Enter") && exit(true);
    document.addEventListener("keydown", key);
    root.querySelector(".skip").addEventListener("click", () => exit(true));
    root.querySelector(".skip").focus({ preventScroll: true });
  };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-replay-intro]"); if (b) { e.preventDefault(); F.intro(true); } });

  // =====================================================================
  //  2. Industrial hero scene — isometric factory connected to cloud services
  //     (illustration only; labelled as such in the page)
  // =====================================================================
  F.scene = function (host) {
    const cv = host.querySelector("canvas"); const ctx = cv && cv.getContext && cv.getContext("2d"); if (!ctx) return;
    let W, H, S, ox, oy, mx = 0, my = 0, visible = true, raf;
    const dpr = Math.min(2, window.devicePixelRatio || 1), C30 = Math.cos(Math.PI / 6), S30 = .5;
    function size() { const r = host.getBoundingClientRect(); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); S = Math.min(W / 18.5, H / 22.5); }
    const P = (x, y, z = 0) => [ox + (x - y) * C30 * S, oy + (x + y) * S30 * S - z * S];
    const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
    function box(x, y, w, d, h, tone = 1, lit) {
      const top = [P(x, y, h), P(x + w, y, h), P(x + w, y + d, h), P(x, y + d, h)];
      const left = [P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h)];
      const right = [P(x + w, y, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x + w, y, h)];
      const gl = ctx.createLinearGradient(...left[0], ...left[3]); gl.addColorStop(0, `rgba(${22 * tone},${32 * tone},${50 * tone},1)`); gl.addColorStop(1, `rgba(${46 * tone},${62 * tone},${88 * tone},1)`);
      const gr = ctx.createLinearGradient(...right[0], ...right[3]); gr.addColorStop(0, `rgba(${16 * tone},${24 * tone},${40 * tone},1)`); gr.addColorStop(1, `rgba(${34 * tone},${48 * tone},${72 * tone},1)`);
      poly(left, gl, "rgba(221,229,240,.10)"); poly(right, gr, "rgba(221,229,240,.08)");
      const gt = ctx.createLinearGradient(...top[0], ...top[2]); gt.addColorStop(0, "#5b6f8f"); gt.addColorStop(1, "#2a3a55");
      poly(top, gt, "rgba(221,229,240,.28)");
      if (lit) for (let i = 1; i <= lit; i++) {                // amber window strips
        const zz = h * i / (lit + 1);
        ctx.strokeStyle = "rgba(255,184,0,.75)"; ctx.lineWidth = Math.max(1.2, S * .06); ctx.shadowColor = "rgba(255,184,0,.9)"; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(...P(x + w, y + d * .15, zz)); ctx.lineTo(...P(x + w, y + d * .85, zz)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(...P(x + w * .15, y + d, zz)); ctx.lineTo(...P(x + w * .85, y + d, zz)); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    const NODES = [["EC2", 3.2, 1.8, 8.6], ["SQS", 6.6, 0.4, 9.4], ["SWF", 9.8, 1.6, 8.8], ["RDS", 10.4, 5.4, 9.6], ["S3", 7.2, 6.6, 10.2], ["SNS", 3.4, 5.6, 9.8]];
    const LINKS = [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5], [0, 3], [4, 5]];
    const BEAMS = [[2.6, 2.6, 2.4, 0], [7.4, 2.2, 3.2, 2], [9.4, 7.6, 1.6, 3], [4.6, 8.8, 1.2, 5]];
    function hex(cx, cy, r, glow, label, t) {
      ctx.save(); ctx.shadowColor = "rgba(0,217,255,.8)"; ctx.shadowBlur = 18 * glow;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * .62); } ctx.closePath();
      const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r); g.addColorStop(0, "rgba(30,60,100,.92)"); g.addColorStop(1, "rgba(10,22,42,.92)");
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = `rgba(0,217,255,${.45 + .4 * glow})`; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
      ctx.fillStyle = "#DDE5F0"; ctx.font = `600 ${Math.max(10, S * .38)}px "Geist Mono", "JetBrains Mono", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, cx, cy + 1);
    }
    function draw(now) {
      const t = now / 1000;
      ox = W * .5 + Math.sin(t * .12) * S * .5 + mx * S * .35; oy = (H - 23 * S) / 2 + 11 * S + Math.cos(t * .1) * S * .2 + my * S * .25;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(0,217,255,.09)"; ctx.lineWidth = 1;          // floor grid
      for (let i = 0; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(...P(i, 0)); ctx.lineTo(...P(i, 12)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(...P(0, i)); ctx.lineTo(...P(12, i)); ctx.stroke(); }
      const fg = ctx.createRadialGradient(...P(6, 6), 0, ...P(6, 6), S * 7); fg.addColorStop(0, "rgba(0,140,255,.10)"); fg.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
      // conveyor + crates
      box(1, 10.2, 10, .7, .35, .8);
      for (let i = 0; i < 6; i++) { const x = 1.2 + ((t * .55 + i * 1.65) % 9.4); box(x, 10.3, .5, .5, .85, 1.25); }
      // buildings (painter's order)
      box(1.2, 1.2, 3, 3, 2.4, 1, 2); box(6, 1.2, 3, 2, 3.2, 1.05, 3); box(8.4, 6.2, 2.4, 2.8, 1.6, .95, 1); box(3.6, 7.6, 2, 2, 1.2, .9, 1);
      // stacks with amber tips
      [[2, 1.6, 3.4], [7, 1.6, 4.2]].forEach(([x, y, h]) => { box(x, y, .35, .35, h, 1.15); const p = P(x + .17, y + .17, h + .15); ctx.fillStyle = `rgba(255,184,0,${.5 + .5 * Math.sin(t * 2 + x)})`; ctx.beginPath(); ctx.arc(...p, S * .07, 0, 6.28); ctx.fill(); });
      // robotic arm
      const base = [6.2, 5.6]; box(base[0] - .6, base[1] - .6, 1.2, 1.2, .45, 1.2);
      const a1 = -.9 + Math.sin(t * .9) * .5, a2 = 1.4 + Math.sin(t * .9 + 1.2) * .6, yaw = Math.sin(t * .45) * 1.2;
      const j0 = [base[0], base[1], .45], j1 = [j0[0] + Math.cos(yaw) * Math.cos(a1) * 2.4, j0[1] + Math.sin(yaw) * Math.cos(a1) * 2.4, j0[2] - Math.sin(a1) * 2.4];
      const j2 = [j1[0] + Math.cos(yaw) * Math.cos(a1 + a2) * 2, j1[1] + Math.sin(yaw) * Math.cos(a1 + a2) * 2, j1[2] - Math.sin(a1 + a2) * 2];
      ctx.lineCap = "round";
      [[j0, j1, S * .34], [j1, j2, S * .24]].forEach(([a, b, w]) => { ctx.strokeStyle = "#8ea2bf"; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(...P(...a)); ctx.lineTo(...P(...b)); ctx.stroke(); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = w * .25; ctx.stroke(); });
      [j0, j1].forEach((j) => { ctx.fillStyle = "#FFB800"; ctx.beginPath(); ctx.arc(...P(...j), S * .14, 0, 6.28); ctx.fill(); });
      ctx.fillStyle = "#00D9FF"; ctx.shadowColor = "#00D9FF"; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(...P(...j2), S * .1, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
      // cloud plane
      const np = NODES.map(([l, x, y, z]) => [l, ...P(x, y, z + Math.sin(t * .8 + x) * .12)]);
      ctx.strokeStyle = "rgba(0,217,255,.25)"; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      LINKS.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(np[a][1], np[a][2]); ctx.lineTo(np[b][1], np[b][2]); ctx.stroke(); }); ctx.setLineDash([]);
      LINKS.forEach(([a, b], i) => { const k = (t * .35 + i * .21) % 1; ctx.fillStyle = "rgba(160,235,255,.95)"; ctx.beginPath(); ctx.arc(np[a][1] + (np[b][1] - np[a][1]) * k, np[a][2] + (np[b][2] - np[a][2]) * k, 2.2, 0, 6.28); ctx.fill(); });
      // beams factory -> cloud
      BEAMS.forEach(([x, y, z, n], i) => {
        const a = P(x, y, z), b = [np[n][1], np[n][2]];
        const g = ctx.createLinearGradient(...a, ...b); g.addColorStop(0, "rgba(255,184,0,.55)"); g.addColorStop(1, "rgba(0,217,255,.55)");
        ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
        for (let j = 0; j < 2; j++) { const k = (t * .5 + i * .27 + j * .5) % 1; ctx.fillStyle = j ? "rgba(0,217,255,.95)" : "rgba(255,200,60,.95)"; const kk = j ? 1 - k : k;
          ctx.beginPath(); ctx.arc(a[0] + (b[0] - a[0]) * kk, a[1] + (b[1] - a[1]) * kk, 2.4, 0, 6.28); ctx.fill(); }
      });
      np.forEach(([l, x, y], i) => hex(x, y, S * .72, .5 + .5 * Math.sin(t * 1.4 + i), l, t));
    }
    function loop(now) { if (visible && !document.hidden) draw(now); raf = requestAnimationFrame(loop); }
    size(); addEventListener("resize", () => { size(); if (reduce) draw(8000); });
    host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - .5; my = (e.clientY - r.top) / r.height - .5; });
    host.addEventListener("pointerleave", () => { mx = my = 0; });
    if (reduce) { draw(8000); return; }                       // static fallback frame
    if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(host);
    raf = requestAnimationFrame(loop);
  };

  // =====================================================================
  //  3. Console: alerts (derived only from real API responses) + menus
  // =====================================================================
  const ok = (x) => x && x.state === "ok";
  F.computeAlerts = function (s, t, inv) {
    const A = [], add = (lvl, title, msg, href) => A.push({ lvl, title, msg, href });
    if (!s) add("info", "Summary unavailable", "The operations summary could not be loaded.", "/ops/health");
    else {
      if (ok(s.queues) && s.queues.dlq.waiting) add("bad", `${s.queues.dlq.waiting} order(s) in dead-letter queue`, "Failed 5 times — inspect and redrive.", "/ops/fulfilment");
      if (ok(s.queues) && s.queues.orders.waiting > 20) add("warn", "SQS backlog growing", `${s.queues.orders.waiting} orders waiting for a worker.`, "/ops/fulfilment");
      if (ok(s.workers) && !s.workers.healthy) add("bad", "No fulfilment worker heartbeat", "No worker has reported in the last 90 seconds.", "/ops/compute");
      (s.health && s.health.probes || []).filter((p) => p.state !== "ok").forEach((p) => add("warn", `${p.name} probe failing`, p.reason || "Dependency did not respond.", "/ops/health"));
      if (ok(s.compute) && s.compute.web && s.compute.web.in_service < s.compute.web.min) add("warn", "Web tier below minimum", `${s.compute.web.in_service} of ${s.compute.web.min} instances in service.`, "/ops/compute");
    }
    if (ok(t)) t.machines.forEach((m) => m.status !== "normal" && add(m.status === "critical" ? "bad" : "warn", `${m.machine_id} ${m.status}`, `${m.temperature} °C${m.fault_code ? " · fault " + m.fault_code : ""} · latest reading ${NX.ago(m.ts)}`, "/ops/factory"));
    if (ok(inv)) { const low = inv.items.filter((r) => r.state === "reorder"); if (low.length) add("warn", `${low.length} SKU(s) at re-order level`, low.slice(0, 3).map((r) => r.sku).join(", ") + (low.length > 3 ? "…" : ""), "/ops/inventory"); }
    return A;
  };
  async function alerts() {
    const g = (u) => NX.get(u).catch(() => null);
    const [s, t, inv] = await Promise.all([g("/api/ops/summary"), g("/api/ops/telemetry"), g("/api/ops/inventory")]);
    if (!s && !t && !inv) return;
    const A = F.computeAlerts(s, t, inv), n = A.filter((a) => a.lvl !== "info").length;
    F.lastAlerts = A; document.dispatchEvent(new CustomEvent("forge:alerts", { detail: A }));
    const cnt = document.getElementById("al-cnt"); if (cnt) { cnt.hidden = !n; cnt.textContent = n; }
    const list = document.getElementById("al-list");
    if (list) list.innerHTML = A.length ? A.map((a) => `<a class="al" href="${a.href}"><span class="dot ${a.lvl === "bad" ? "bad" : a.lvl === "warn" ? "warn" : "info"}"></span><span><b>${NX.esc(a.title)}</b><small>${NX.esc(a.msg)}</small></span></a>`).join("")
      : '<div class="empty" style="padding:18px">No active alerts from the checks the platform can run.</div>';
  }
  function menus() {
    document.querySelectorAll("[data-pop]").forEach((btn) => {
      const pop = document.getElementById(btn.dataset.pop);
      btn.addEventListener("click", (e) => { e.stopPropagation(); const open = !pop.classList.contains("open");
        document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open")); document.querySelectorAll("[data-pop]").forEach((b) => b.setAttribute("aria-expanded", "false"));
        pop.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".pop")) { document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open")); document.querySelectorAll("[data-pop]").forEach((b) => b.setAttribute("aria-expanded", "false")); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".pop.open").forEach((p) => p.classList.remove("open")); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    F.intro(false);
    const sc = document.querySelector("[data-scene]"); if (sc) F.scene(sc);
    menus();
    if (document.getElementById("al-list")) NX.poll(alerts, 30000);
  });
})();
