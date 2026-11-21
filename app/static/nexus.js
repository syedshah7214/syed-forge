/* MegaFab NEXUS - shared client runtime (no framework, no build step) */
(function () {
  const N = (window.NX = {});
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- formatting ----------
  N.pkr = (v) => "Rs " + Math.round(Number(v) || 0).toLocaleString("en-PK");
  N.num = (v) => (Number(v) || 0).toLocaleString("en-US");
  N.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  N.ago = (iso) => {
    if (!iso) return "—";
    const s = Math.max(0, (Date.now() - new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime()) / 1000);
    if (s < 60) return Math.round(s) + "s ago"; if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago"; return Math.round(s / 86400) + "d ago";
  };
  N.time = (iso) => { try { return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch (e) { return "—"; } };

  // ---------- icons (inline, stroke) ----------
  const P = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    arch: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7.5l3.5 8.5M17 7.5l-3.5 8.5M7.5 6h9"/>',
    flow: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    factory: '<path d="M3 21V10l6 4V10l6 4V6l6 3v12z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    store: '<path d="M4 10v10h16V10M3 6l2-3h14l2 3v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/>',
    queue: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="M5 12l5 5 9-10"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    workers: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5"/>',
    heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', chev: '<path d="M15 6l-6 6 6 6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    invoice: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/>', truck: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    stack: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  };
  N.icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;
  document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = N.icon(el.dataset.icon, +el.dataset.size || 18)));

  // ---------- count-up ----------
  N.count = (el, to, fmt = N.num) => {
    if (!el) return;
    const from = Number(el.dataset.v || 0); el.dataset.v = to;
    el.classList.remove("sk");
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), d = 900;
    const step = (t) => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); const v = from + (to - from) * e; el.textContent = fmt(k < 1 && Number.isInteger(to) ? Math.round(v) : v); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };

  // ---------- toasts ----------
  let tbox;
  N.toast = (title, msg = "", kind = "info") => {
    if (!tbox) { tbox = document.createElement("div"); tbox.className = "toasts"; tbox.setAttribute("aria-live", "polite"); document.body.appendChild(tbox); }
    const t = document.createElement("div"); t.className = "toast";
    t.innerHTML = `<span class="dot ${kind}" style="margin-top:6px"></span><div><b>${N.esc(title)}</b><span class="muted">${N.esc(msg)}</span></div>`;
    tbox.appendChild(t); setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 4200);
  };

  // ---------- backend connectivity ----------
  let failures = 0;
  const banner = () => document.getElementById("conn-banner");
  N.setConn = (state) => {
    const b = banner(), pill = document.getElementById("conn-pill");
    if (pill) {
      const m = { live: ["ok", "API connected"], partial: ["warn", "AWS partly unreachable"], loading: ["info", "Connecting…"], down: ["bad", "Backend unreachable"] }[state];
      pill.innerHTML = `<span class="dot ${m[0]}"></span>${m[1]}`;
    }
    if (b) b.classList.toggle("show", state === "down");
    const lo = document.getElementById("last-ok"); if (lo) lo.textContent = N.lastOk ? " at " + N.lastOk.toLocaleTimeString() : " (none received yet)";
  };
  N.get = async (url, { timeout = 12000 } = {}) => {
    const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" }, cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json(); failures = 0; N.lastOk = new Date();
      const h = j.health || (j.probes ? j : null);
      N.setConn(j.state === "unavailable" || (h && h.score < 100) ? "partial" : "live"); return j;
    } catch (e) {
      failures++; if (failures >= 2) N.setConn("down"); throw e;
    } finally { clearTimeout(id); }
  };

  // ---------- polling that pauses in background tabs ----------
  N.poll = (fn, every) => {
    let timer = null, busy = false;
    const run = async () => { if (busy || document.hidden) return; busy = true; try { await fn(); } catch (e) { /* surfaced via banner */ } busy = false; };
    const start = () => { clearInterval(timer); timer = setInterval(run, every); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) run(); });
    run(); start(); return { run };
  };

  // ---------- card illumination following the cursor ----------
  document.addEventListener("pointermove", (e) => {
    const c = e.target.closest && e.target.closest(".card.glow"); if (!c) return;
    const r = c.getBoundingClientRect(); c.style.setProperty("--mx", e.clientX - r.left + "px"); c.style.setProperty("--my", e.clientY - r.top + "px");
  });

  // ---------- console sidebar ----------
  const shell = document.querySelector(".shell");
  if (shell) {
    try { if (localStorage.getItem("nx-side") === "c") shell.classList.add("collapsed"); } catch (e) {}
    document.querySelectorAll("[data-collapse]").forEach((b) => b.addEventListener("click", () => {
      shell.classList.toggle("collapsed"); try { localStorage.setItem("nx-side", shell.classList.contains("collapsed") ? "c" : "o"); } catch (e) {}
    }));
    document.querySelectorAll("[data-menu]").forEach((b) => b.addEventListener("click", () => shell.classList.toggle("mobile-open")));
  }
  const clock = document.getElementById("refresh-ts");
  N.stamp = () => { if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };

  // ---------- tiny SVG charts ----------
  N.donut = (el, parts, label) => {
    const total = parts.reduce((a, p) => a + p.v, 0) || 1; let a0 = -Math.PI / 2, out = "";
    parts.forEach((p) => {
      const a1 = a0 + (p.v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0, R = 46, r = 32;
      const P1 = [60 + R * Math.cos(a0), 60 + R * Math.sin(a0)], P2 = [60 + R * Math.cos(a1), 60 + R * Math.sin(a1)];
      const P3 = [60 + r * Math.cos(a1), 60 + r * Math.sin(a1)], P4 = [60 + r * Math.cos(a0), 60 + r * Math.sin(a0)];
      if (p.v > 0) out += p.v === total ? `<circle cx="60" cy="60" r="39" fill="none" stroke="${p.c}" stroke-width="14"><title>${N.esc(p.k)}: ${p.v}</title></circle>`
        : `<path d="M${P1}A${R},${R} 0 ${large} 1 ${P2}L${P3}A${r},${r} 0 ${large} 0 ${P4}Z" fill="${p.c}"><title>${N.esc(p.k)}: ${p.v}</title></path>`;
      a0 = a1;
    });
    el.innerHTML = `<svg viewBox="0 0 120 120" width="150" height="150" role="img" aria-label="${N.esc(label)}">${out}
      <text x="60" y="58" text-anchor="middle" fill="#F5F8FF" font-size="20" font-weight="700">${total === 1 && !parts.some((p) => p.v) ? 0 : total}</text>
      <text x="60" y="74" text-anchor="middle" fill="#94A3B8" font-size="8" font-family="monospace">ORDERS</text></svg>`;
  };
  N.spark = (el, pts, color = "#00D9FF") => {
    if (!pts || pts.length < 2) { el.innerHTML = `<div class="dim mono" style="font-size:11px;padding-top:14px">${pts && pts.length ? "1 reading — history builds as machines report" : "no history yet"}</div>`; return; }
    const vs = pts.map((p) => p.v), mn = Math.min(...vs) - 2, mx = Math.max(...vs) + 2, W = 200, H = 46;
    const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, H - ((p.v - mn) / (mx - mn || 1)) * (H - 6) - 3]);
    const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none"><path d="${d}L${W},${H}L0,${H}Z" fill="${color}" opacity=".08"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
  };
})();
