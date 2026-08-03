/*!
 * app.js — BLACKZ CRACK FINDER UI layer.
 *
 * Split out of index.html so the page can ship a strict
 * Content-Security-Policy (script-src 'self' — no 'unsafe-inline').
 * All scanning logic lives in scanner.js; this file is presentation,
 * the live pipeline, the network trace, and the localStorage cache.
 */
/* =====================================================================
   OPERATOR PORTRAIT (inlined data URI — no network request, no tracker)
===================================================================== */
(function () {
  const img = document.getElementById("ghost-portrait");
  if (img && typeof window.OPERATOR_PORTRAIT === "string") img.src = window.OPERATOR_PORTRAIT;
})();

/* =====================================================================
   MATRIX RAIN
   rAF-driven with a frame budget + auto-pause when the tab is hidden or
   the user prefers reduced motion. A background setInterval that paints
   ~18fps forever is the single biggest idle-CPU cost on a page like this.
===================================================================== */
(function matrixRain() {
  const canvas = document.getElementById("matrix-rain");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d", { alpha: true });
  let w, h, cols, drops, last = 0, raf = 0;
  const STEP = 55; // ms between painted frames
  const chars = "01アイウエオカキクケコサシスセソABCDEFGHIJKLMNOPQRSTUVWXYZ$#@%&";
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    cols = Math.floor(w / 16);
    drops = new Array(cols).fill(0).map(() => Math.random() * -50);
  }
  function draw() {
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#00ff66";
    ctx.font = "14px monospace";
    for (let i = 0; i < cols; i++) {
      ctx.fillText(chars[(Math.random() * chars.length) | 0], i * 16, drops[i] * 16);
      if (drops[i] * 16 > h && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (t - last < STEP) return;
    last = t;
    draw();
  }
  function start() { if (!raf && !reduce && !document.hidden) raf = requestAnimationFrame(loop); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  resize();
  addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  if (reduce) draw(); else start();
})();

/* =====================================================================
   TICKER + UPTIME
===================================================================== */
const TICKER_MSGS = [
  "rule engine loaded: 13 detectors online",
  "watching for allow_origins=[\"*\"] patterns...",
  "grepping for eval(), exec(), shell_exec(), pickle.loads()...",
  "checking for AKIA... / sk_live_... / ghp_... key patterns...",
  "waiting for input above — paste, upload, or point at a repo",
  "GitHub scans use api.github.com + raw.githubusercontent.com directly",
  "nothing you scan leaves this browser tab",
  "rate-limit budget: 60/hr unauthenticated (github api)",
  "scan cap: 60 files / 250KB each",
  "every finding shows its real file:line — check it yourself",
  "heuristic scanner: fast first pass, not a full SAST replacement",
  "session uptime ticking up...",
  "tail -f /var/log/curiosity.log",
];
let tickerIdx = 0;
const tickerEl = document.getElementById("ticker");
function tick() { tickerEl.textContent = TICKER_MSGS[tickerIdx % TICKER_MSGS.length]; tickerIdx++; }
tick();
setInterval(tick, 3500);

const startTime = Date.now();
setInterval(() => {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(s / 60), sec = s % 60;
  document.getElementById("uptime").textContent = m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}, 1000);

/* =====================================================================
   SCAN LOG UI HELPERS
===================================================================== */
const scanLogEl = document.getElementById("scan-log");
const scanErrorEl = document.getElementById("scan-error");
function scanLog(msg, cls) {
  scanLogEl.classList.add("show");
  const line = document.createElement("div");
  line.className = "ln" + (cls ? " " + cls : "");
  line.textContent = "$ " + msg;
  scanLogEl.appendChild(line);
  scanLogEl.scrollTop = scanLogEl.scrollHeight;
}
function scanLogReset() { scanLogEl.innerHTML = ""; scanLogEl.classList.remove("show"); scanErrorEl.classList.remove("show"); scanErrorEl.textContent = ""; }
function scanErrorShow(msg) { scanErrorEl.textContent = "✗ " + msg; scanErrorEl.classList.add("show"); }
function setButtonsDisabled(disabled) {
  document.getElementById("gh-scan-btn").disabled = disabled;
  document.getElementById("paste-scan-btn").disabled = disabled;
  document.getElementById("upload-scan-btn").disabled = disabled;
}

/* =====================================================================
   LIVE PIPELINE — visible steps, per-step timing, running total.
   Purely a view over the real work: each step is marked started/finished
   by the actual scan code below, so the timings are measured, not faked.
===================================================================== */
const Pipeline = (() => {
  const panel = document.getElementById("live-panel");
  const head = document.getElementById("live-head");
  const label = document.getElementById("live-label");
  const elapsedEl = document.getElementById("live-elapsed");
  const listEl = document.getElementById("pipeline");
  const barFill = document.getElementById("pl-bar-fill");
  const ICON = { wait: "○", run: "▸", ok: "✔", err: "✖" };
  let steps = [], t0 = 0, timer = 0;

  const fmt = ms => (ms / 1000).toFixed(2) + "s";

  function paint() {
    listEl.innerHTML = steps.map(s => `
      <div class="pl-step" data-state="${s.state}">
        <span class="pl-icon">${ICON[s.state]}</span>
        <span>${escapeHtml(s.label)}${s.detail ? `<span class="pl-detail">${escapeHtml(s.detail)}</span>` : ""}</span>
        <span class="pl-time">${s.ms == null ? "" : fmt(s.ms)}</span>
      </div>`).join("");
    const done = steps.filter(s => s.state === "ok").length;
    barFill.style.width = steps.length ? (done / steps.length * 100).toFixed(1) + "%" : "0%";
  }

  return {
    begin(title, stepDefs) {
      steps = stepDefs.map(([id, lbl]) => ({ id, label: lbl, state: "wait", ms: null, detail: "", _t: 0 }));
      t0 = performance.now();
      panel.classList.add("show");
      head.classList.remove("done", "failed");
      label.textContent = title;
      clearInterval(timer);
      timer = setInterval(() => { elapsedEl.textContent = fmt(performance.now() - t0); }, 50);
      paint();
    },
    start(id, detail) {
      const s = steps.find(x => x.id === id); if (!s) return;
      s.state = "run"; s._t = performance.now(); if (detail) s.detail = detail;
      paint();
    },
    detail(id, detail) {
      const s = steps.find(x => x.id === id); if (!s) return;
      s.detail = detail; paint();
    },
    ok(id, detail) {
      const s = steps.find(x => x.id === id); if (!s) return;
      s.state = "ok"; s.ms = performance.now() - (s._t || t0); if (detail) s.detail = detail;
      paint();
    },
    fail(id, detail) {
      const s = steps.find(x => x.id === id); if (!s) return;
      s.state = "err"; s.ms = performance.now() - (s._t || t0); if (detail) s.detail = detail;
      paint();
    },
    finish(okText) {
      clearInterval(timer);
      const total = performance.now() - t0;
      elapsedEl.textContent = fmt(total);
      head.classList.add("done");
      label.textContent = okText;
      paint();
      return total;
    },
    abort(msg) {
      clearInterval(timer);
      elapsedEl.textContent = fmt(performance.now() - t0);
      head.classList.add("failed");
      label.textContent = msg;
      steps.forEach(s => { if (s.state === "run") { s.state = "err"; s.ms = performance.now() - s._t; } });
      paint();
    },
  };
})();

/* =====================================================================
   NETWORK TRACE — wrap our own fetch so the page can *show* the literal
   request URL, HTTP status, wall-clock timing, and the first bytes of the
   real response body. Only same-purpose GitHub hosts are traced; the body
   preview is read from a clone and hard-capped, and every rendered value
   goes through escapeHtml() (responses are attacker-controlled text).
===================================================================== */
const NetTrace = (() => {
  const listEl = document.getElementById("net-list");
  const MAX_ITEMS = 25, PREVIEW = 420;
  let count = 0;
  return {
    reset() { count = 0; listEl.innerHTML = ""; },
    // Lets the fetch wrapper skip cloning+reading a body it would only throw
    // away. On a 60-file scan that's ~35 wasted full-body reads.
    isFull() { return count >= MAX_ITEMS; },
    add(url, status, ms, preview) {
      if (count >= MAX_ITEMS) return;
      count++;
      const ok = status >= 200 && status < 300;
      const el = document.createElement("div");
      el.className = "net-item";
      el.innerHTML = `
        <div class="net-req">
          <span class="verb">GET</span>
          <span class="url">${escapeHtml(url)}</span>
          <span class="status ${ok ? "ok" : "bad"}">${status}</span>
          <span class="ms">${ms.toFixed(0)}ms</span>
        </div>
        ${preview ? `<div class="net-res">${escapeHtml(preview.slice(0, PREVIEW))}${preview.length > PREVIEW ? " …" : ""}</div>` : ""}`;
      listEl.appendChild(el);
      listEl.scrollTop = listEl.scrollHeight;
    },
  };
})();

(function instrumentFetch() {
  const TRACED = /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!TRACED.test(url)) return nativeFetch(input, init);
    const t = performance.now();
    const res = await nativeFetch(input, init);
    const ms = performance.now() - t;
    if (NetTrace.isFull()) return res;   // don't pay for a clone we'd discard
    let preview = "";
    try { preview = (await res.clone().text()).slice(0, 600); } catch (_) { /* body unreadable — trace the headers anyway */ }
    NetTrace.add(url, res.status, ms, preview);
    return res;
  };
})();

/* =====================================================================
   LOCAL CACHE — the only place a scan is ever persisted.
   Scope: this browser, this origin. Lifetime: 24h, then self-expires on
   read. Never transmitted; there is no server to transmit it to.
===================================================================== */
const Cache = (() => {
  const KEY = "bcf:lastScan", TTL_MS = 24 * 60 * 60 * 1000, MAX_ISSUES = 400;
  const bar = document.getElementById("cache-bar");
  const available = () => { try { const k = "__t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (_) { return false; } };
  function clear() { try { localStorage.removeItem(KEY); } catch (_) {} bar.classList.remove("show"); }
  return {
    save(state) {
      if (!available()) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({
          v: 1, ts: Date.now(), targetLabel: state.targetLabel,
          repoCards: state.repoCards, secretsNote: state.secretsNote,
          issues: state.issues.slice(0, MAX_ISSUES),
        }));
      } catch (_) { /* quota exceeded — a cache miss is harmless, so fail silently */ }
    },
    load() {
      if (!available()) return null;
      let raw; try { raw = localStorage.getItem(KEY); } catch (_) { return null; }
      if (!raw) return null;
      let d; try { d = JSON.parse(raw); } catch (_) { clear(); return null; }
      if (!d || d.v !== 1 || !Array.isArray(d.issues) || Date.now() - d.ts > TTL_MS) { clear(); return null; }
      return d;
    },
    showBar(ts) {
      const mins = Math.round((Date.now() - ts) / 60000);
      const age = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
      bar.innerHTML = `<span>💾 Showing your last scan, restored from this browser's local storage (${escapeHtml(age)}). It expires automatically after 24h and was never sent anywhere. Run a new scan for fresh results.</span>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Clear cached scan";
      btn.addEventListener("click", () => { clear(); location.reload(); });
      bar.appendChild(btn);
      bar.classList.add("show");
    },
    hideBar() { bar.classList.remove("show"); },
    clear,
  };
})();

/* =====================================================================
   CURRENT SCAN STATE + RENDERING
   (single always-live model — no hardcoded/saved dataset. Before the
   first scan, `current` is empty and every section shows an honest
   empty state instead of fabricated content.)
===================================================================== */
const current = {
  issues: [],
  repoCards: [],
  targetLabel: null,
  secretsNote: `No scan has been run yet. Use the panel above to scan a GitHub repo, pasted code, or uploaded files — results below are always from a real, just-completed scan.`,
};

function computeCounts(issues) {
  return {
    critical: issues.filter(i => i.sev === "critical").length,
    high: issues.filter(i => i.sev === "high").length,
    medium: issues.filter(i => i.sev === "medium").length,
    low: issues.filter(i => i.sev === "low" || i.sev === "info").length,
    total: issues.length,
  };
}

function renderSecurityBanner() {
  const el = document.getElementById("security-banner");
  const hasScanned = current.targetLabel !== null;
  const hasSecretFinding = current.issues.some(i => i.cat === "secrets");
  el.classList.toggle("bad", hasScanned && hasSecretFinding);
  el.classList.toggle("neutral", !hasScanned);
  const heading = !hasScanned ? "⏳ No scan yet" : (hasSecretFinding ? "🔴 Secret scan: findings" : "🛡️ Secret scan: clean");
  el.innerHTML = `<h3>${heading}</h3><p>${current.secretsNote}</p>`;
}

function renderStatusChips() {
  const c = computeCounts(current.issues);
  document.getElementById("chip-crit").textContent = `${c.critical} critical`;
  document.getElementById("chip-high").textContent = `${c.high} high`;
  document.getElementById("chip-med").textContent = `${c.medium} medium`;
  const hasSecrets = current.issues.some(i => i.cat === "secrets");
  document.getElementById("chip-secrets").textContent = current.targetLabel === null ? "secrets: —" : `secrets: ${hasSecrets ? "found" : "clean"}`;
}

function renderSummary() {
  const c = computeCounts(current.issues);
  document.getElementById("summary-grid").innerHTML = `
    <div class="stat red"><div class="num">${c.critical}</div><div class="label">Critical</div></div>
    <div class="stat orange"><div class="num">${c.high}</div><div class="label">High</div></div>
    <div class="stat yellow"><div class="num">${c.medium}</div><div class="label">Medium</div></div>
    <div class="stat cyan"><div class="num">${c.low}</div><div class="label">Low / info</div></div>`;
}

function renderSevChart() {
  const c = computeCounts(current.issues);
  if (!c.total) {
    document.getElementById("sev-chart-bars").innerHTML = `<div class="chart-empty">No findings yet — run a scan above.</div>`;
    document.getElementById("sev-chart-note").textContent = "";
    return;
  }
  const max = Math.max(c.critical, c.high, c.medium, c.low, 1);
  const rows = [
    ["🔴 Critical", c.critical, "var(--red)"],
    ["🟠 High", c.high, "var(--orange)"],
    ["🟡 Medium", c.medium, "var(--yellow)"],
    ["🔵 Low/Info", c.low, "var(--cyan)"],
  ];
  document.getElementById("sev-chart-bars").innerHTML = rows.map(([label, n, color]) => `
    <div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${color}"></div></div>
      <div class="bar-count">${n}</div>
    </div>`).join("");
  document.getElementById("sev-chart-note").innerHTML = `Total: <strong>${c.total} finding(s)</strong> in <code>${escapeHtml(current.targetLabel || "")}</code>.`;
}

const CAT_PALETTE = ["var(--red)", "var(--pink)", "var(--orange)", "var(--cyan)", "var(--yellow)", "var(--green)", "var(--green-dim)", "var(--text-dim)"];
function renderCatChart() {
  const el = document.getElementById("cat-chart-bars");
  if (!current.issues.length) {
    el.innerHTML = `<div class="chart-empty">No findings yet — run a scan above.</div>`;
    document.getElementById("cat-chart-note").textContent = "";
    return;
  }
  const counts = {};
  for (const i of current.issues) counts[i.cat] = (counts[i.cat] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(e => e[1]), 1);
  el.innerHTML = entries.map(([cat, n], idx) => `
    <div class="bar-row">
      <div class="bar-label">${escapeHtml(cat)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max * 100).toFixed(0)}%;background:${CAT_PALETTE[idx % CAT_PALETTE.length]}"></div></div>
      <div class="bar-count">${n}</div>
    </div>`).join("");
  document.getElementById("cat-chart-note").textContent = `${entries.length} distinct categor${entries.length === 1 ? "y" : "ies"} found.`;
}

function renderRepoCards() {
  const el = document.getElementById("repos");
  if (!current.repoCards.length) { el.innerHTML = `<div class="repo-empty">No scan target yet — scan a repo, paste, or upload above.</div>`; return; }
  el.innerHTML = current.repoCards.map(r => `
    <div class="repo">
      <div class="repo-name">${escapeHtml(r.name)} <span class="lang">${escapeHtml(r.lang)}</span></div>
      <div class="repo-url">${escapeHtml(r.url)}</div>
    </div>`).join("");
}

function renderFilters() {
  const c = computeCounts(current.issues);
  const catGroups = {};
  for (const i of current.issues) { if (!catGroups[i.cat]) catGroups[i.cat] = { key: i.cat, label: i.cat, count: 0 }; catGroups[i.cat].count++; }
  const pills = [
    { key: "all", label: "All", count: current.issues.length },
    { key: "critical", label: "🔴 Critical", count: c.critical },
    { key: "high", label: "🟠 High", count: c.high },
    { key: "medium", label: "🟡 Medium", count: c.medium },
    { key: "low", label: "🔵 Low", count: c.low },
    ...Object.values(catGroups),
  ];
  const el = document.getElementById("filters");
  if (!current.issues.length) { el.innerHTML = ""; renderIssues("all"); return; }
  el.innerHTML = pills.map((p, idx) => `<div class="pill${idx === 0 ? " active" : ""}" data-filter="${escapeHtml(p.key)}" role="button" tabindex="0" aria-pressed="${idx === 0}">${escapeHtml(p.label)} <span class="count">${p.count}</span></div>`).join("");
  function activatePill(p) {
    el.querySelectorAll(".pill").forEach(x => { x.classList.remove("active"); x.setAttribute("aria-pressed", "false"); });
    p.classList.add("active");
    p.setAttribute("aria-pressed", "true");
    renderIssues(p.dataset.filter);
  }
  el.querySelectorAll(".pill").forEach(p => {
    p.addEventListener("click", () => activatePill(p));
    p.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activatePill(p); } });
  });
}

const sevLabel = { critical: "🔴 Critical", high: "🟠 High", medium: "🟡 Medium", low: "🔵 Low", info: "🟢 Info" };
const sevClass = { critical: "sev-critical", high: "sev-high", medium: "sev-medium", low: "sev-low", info: "sev-info" };

function renderIssues(filter) {
  filter = filter || "all";
  const issuesEl = document.getElementById("issues");
  if (!current.issues.length) {
    issuesEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-faint)">No scan yet. Paste code, upload files, or scan a public GitHub repo above to see real findings here.</div>`;
    return;
  }
  const filtered = filter === "all" ? current.issues : current.issues.filter(i => i.sev === filter || i.cat === filter);
  issuesEl.innerHTML = "";
  if (!filtered.length) { issuesEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-faint)">No issues match this filter.</div>`; return; }
  for (const i of filtered) {
    const div = document.createElement("div");
    div.className = "issue"; div.dataset.sev = i.sev; div.dataset.cat = i.cat;
    const fixHtml = i.fixCode ? `<div class="code-block"><div class="code-block-header good">✅ Fix</div><pre>${i.fixCode}</pre></div>` : "";
    const locTag = i.file ? `<span class="tag loc">${escapeHtml(i.file)}${i.line ? ":" + i.line : ""}</span>` : "";
    div.innerHTML = `
      <div class="issue-head" role="button" tabindex="0" aria-expanded="false">
        <span class="issue-sev ${sevClass[i.sev]}">${sevLabel[i.sev]}</span>
        <div class="issue-title">${i.title}</div>
        <div class="issue-tags"><span class="tag cat">${escapeHtml(i.cat)}</span>${locTag}</div>
        <div class="chevron">▶</div>
      </div>
      <div class="issue-body">
        <div class="explainer">
          <div class="explainer-label">What</div><div class="explainer-text">${i.what}</div>
          <div class="explainer-label">Why</div><div class="explainer-text">${i.why}</div>
          ${i.impact ? `<div class="explainer-label">Impact</div><div class="explainer-text">${i.impact}</div>` : ""}
        </div>
        ${fixHtml}
      </div>`;
    const head = div.querySelector(".issue-head");
    function toggleIssue() {
      div.classList.toggle("open");
      head.setAttribute("aria-expanded", div.classList.contains("open") ? "true" : "false");
    }
    head.addEventListener("click", toggleIssue);
    head.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleIssue(); } });
    issuesEl.appendChild(div);
  }
}

function renderRoadmap() {
  const el = document.getElementById("roadmap");
  if (!current.issues.length) {
    el.innerHTML = ["ship", "soon", "later"].map((cls, i) => `
      <div class="phase ${cls}">
        <h3><span class="phase-num">${["P0", "P1", "P2"][i]}</span> ${["Ship today", "This week", "When you have time"][i]}</h3>
        <div class="est">Run a scan to populate this</div>
        <ul><li style="color:var(--text-faint)">— no scan yet —</li></ul>
      </div>`).join("");
    return;
  }
  const strip = s => String(s).replace(/<[^>]+>/g, "");
  const rm = {
    ship: current.issues.filter(i => i.sev === "critical").map(i => strip(i.title)),
    soon: current.issues.filter(i => i.sev === "high").map(i => strip(i.title)),
    later: current.issues.filter(i => i.sev === "medium" || i.sev === "low" || i.sev === "info").map(i => strip(i.title)),
  };
  const phase = (cls, num, title, est, items) => `
    <div class="phase ${cls}">
      <h3><span class="phase-num">${num}</span> ${title}</h3>
      <div class="est">${est}</div>
      <ul>${items.length ? items.map(t => `<li>${escapeHtml(t)}</li>`).join("") : '<li style="color:var(--text-faint)">— none —</li>'}</ul>
    </div>`;
  el.innerHTML = phase("ship", "P0", "Fix first", "Critical severity", rm.ship)
    + phase("soon", "P1", "Fix soon", "High severity", rm.soon)
    + phase("later", "P2", "When you have time", "Medium / low / info", rm.later);
}

function renderAll() {
  renderSecurityBanner(); renderStatusChips(); renderSummary(); renderSevChart(); renderCatChart(); renderRepoCards(); renderFilters(); renderIssues("all"); renderRoadmap();
  setTimeout(() => document.querySelectorAll(".issue").forEach(el => {
    if (el.dataset.sev === "critical" || el.dataset.sev === "high") {
      el.classList.add("open");
      const head = el.querySelector(".issue-head");
      if (head) head.setAttribute("aria-expanded", "true");
    }
  }), 30);
}

/* =====================================================================
   SCAN TAB SWITCHING
===================================================================== */
function activateScanTab(tab) {
  document.querySelectorAll(".scan-tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
  document.querySelectorAll(".scan-panel").forEach(p => p.classList.remove("active"));
  tab.classList.add("active");
  tab.setAttribute("aria-selected", "true");
  document.querySelector(`.scan-panel[data-panel="${tab.dataset.mode}"]`).classList.add("active");
}
document.querySelectorAll(".scan-tab").forEach(tab => {
  tab.addEventListener("click", () => activateScanTab(tab));
  tab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateScanTab(tab); } });
});
document.getElementById("upload-files").addEventListener("change", (e) => {
  const names = Array.from(e.target.files).map(f => f.name);
  document.getElementById("upload-file-list").textContent = names.length ? `${names.length} file(s): ${names.join(", ")}` : "";
});

/* =====================================================================
   SCAN ACTIONS
===================================================================== */
function finalizeScan(findings, targetLabel, repoCard, opts) {
  // Defensive: a hand-edited or truncated cache entry shouldn't be able to
  // render "undefined" into the UI or crash the renderer.
  findings = Array.isArray(findings) ? findings : [];
  targetLabel = typeof targetLabel === "string" && targetLabel ? targetLabel : "unknown target";
  current.issues = findings;
  current.repoCards = repoCard ? [repoCard] : [];
  current.targetLabel = targetLabel;
  const secretCount = findings.filter(i => i.cat === "secrets").length;
  current.secretsNote = secretCount
    ? `${secretCount} potential secret/credential finding(s) in <strong>${escapeHtml(targetLabel)}</strong> — expand the "secrets" issues below.`
    : `No hardcoded secrets, keys, or credentials matched in <strong>${escapeHtml(targetLabel)}</strong>. Heuristic scan — not a guarantee.`;
  renderAll();
  if (!(opts && opts.fromCache)) {
    Cache.save(current);
    Cache.hideBar();
    document.getElementById("security-banner").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

const GH_STEPS = [
  ["parse", "Parse target into owner/repo"],
  ["meta", "GET api.github.com/repos/{owner}/{repo} — resolve default branch"],
  ["tree", "GET .../git/trees/{branch}?recursive=1 — list every file"],
  ["pick", "Filter + prioritise candidate files (cap 60 / 250KB)"],
  ["fetch", "GET raw.githubusercontent.com/... — download real file contents"],
  ["scan", "Run all 13 rules over the downloaded text"],
  ["render", "Compute severities, charts, and fix order from the findings"],
];

document.getElementById("gh-scan-btn").addEventListener("click", async () => {
  scanLogReset();
  NetTrace.reset();
  setButtonsDisabled(true);
  Pipeline.begin("scanning…", GH_STEPS);
  try {
    Pipeline.start("parse");
    const { owner, repo } = parseRepoInput(document.getElementById("gh-repo").value);
    Pipeline.ok("parse", `${owner}/${repo}`);
    scanLog(`resolving ${owner}/${repo} ...`);

    Pipeline.start("meta");
    const meta = await fetchRepoMeta(owner, repo);
    const branch = document.getElementById("gh-branch").value.trim() || meta.default_branch;
    Pipeline.ok("meta", `default branch: ${branch}`);
    scanLog(`default branch: ${branch}`, "ok");

    Pipeline.start("tree");
    const { tree, truncated } = await fetchTree(owner, repo, branch);
    Pipeline.ok("tree", `${tree.length} tree entries${truncated ? " (truncated by GitHub)" : ""}`);
    if (truncated) scanLog("repo tree truncated by GitHub API — scanning a subset", "err");

    Pipeline.start("pick");
    const files = pickFiles(tree);
    if (!files.length) throw new Error("No scannable files found (check the repo isn't empty and uses common source extensions)");
    Pipeline.ok("pick", `${files.length} candidate file(s) selected`);
    scanLog(`${tree.length} entries found, ${files.length} candidate file(s) selected (cap: 60 files / 250KB each)`);

    Pipeline.start("fetch", `0/${files.length}`);
    scanLog(`fetching ${files.length} file(s) from raw.githubusercontent.com ...`);
    let done = 0;
    const contents = await mapLimit(files, 6, async (f) => {
      const text = await fetchRaw(owner, repo, branch, f.path);
      done++;
      Pipeline.detail("fetch", `${done}/${files.length} — ${f.path}`);
      if (done % 10 === 0) scanLog(`fetched ${done}/${files.length} ...`);
      return { path: f.path, text };
    });
    const okFiles = contents.filter(Boolean).length;
    Pipeline.ok("fetch", `${okFiles}/${files.length} downloaded`);

    Pipeline.start("scan");
    scanLog(`running rule engine on ${okFiles} file(s) ...`);
    let findings = [];
    for (const c of contents) { if (c) findings = findings.concat(scanFileContent(c.path, c.text)); }
    Pipeline.ok("scan", `${findings.length} finding(s) across ${okFiles} file(s)`);
    scanLog(`done — ${findings.length} finding(s)`, "ok");

    Pipeline.start("render");
    finalizeScan(findings, `${owner}/${repo}@${branch}`, { name: `🛰 ${owner}/${repo}`, lang: `branch: ${branch}`, url: `github.com/${owner}/${repo} · ${files.length} files scanned` });
    Pipeline.ok("render", "results below are live output from this scan");
    Pipeline.finish(`complete — ${findings.length} finding(s) in ${owner}/${repo}`);
  } catch (e) {
    Pipeline.abort(e.message);
    scanLog(e.message, "err");
    scanErrorShow(e.message);
  } finally { setButtonsDisabled(false); }
});

document.getElementById("paste-scan-btn").addEventListener("click", () => {
  scanLogReset();
  NetTrace.reset();
  const code = document.getElementById("paste-code").value;
  const name = document.getElementById("paste-name").value.trim() || "pasted-snippet.txt";
  if (!code.trim()) { scanErrorShow("Paste some code first."); return; }
  Pipeline.begin("scanning pasted code…", [
    ["read", "Read the pasted text (stays in this tab — zero network requests)"],
    ["scan", "Run all 13 rules over it"],
    ["render", "Compute severities, charts, and fix order"],
  ]);
  Pipeline.start("read");
  Pipeline.ok("read", `${code.split("\n").length} lines as ${name}`);
  Pipeline.start("scan");
  scanLog(`scanning pasted content as ${name} ...`);
  const findings = scanFileContent(name, code);
  Pipeline.ok("scan", `${findings.length} finding(s)`);
  scanLog(`done — ${findings.length} finding(s)`, "ok");
  Pipeline.start("render");
  finalizeScan(findings, name, { name: `📄 ${name}`, lang: "pasted", url: `${code.split("\n").length} lines` });
  Pipeline.ok("render");
  Pipeline.finish(`complete — ${findings.length} finding(s)`);
});

document.getElementById("upload-scan-btn").addEventListener("click", async () => {
  scanLogReset();
  NetTrace.reset();
  const input = document.getElementById("upload-files");
  const files = Array.from(input.files || []);
  if (!files.length) { scanErrorShow("Choose one or more files first."); return; }
  setButtonsDisabled(true);
  Pipeline.begin("scanning uploaded files…", [
    ["read", "Read files from disk (stays in this tab — zero network requests)"],
    ["scan", "Run all 13 rules over each file"],
    ["render", "Compute severities, charts, and fix order"],
  ]);
  try {
    Pipeline.start("read", `${files.length} file(s)`);
    scanLog(`reading ${files.length} file(s) ...`);
    const texts = await Promise.all(files.map(f => f.text()));
    Pipeline.ok("read", `${files.length} file(s) read locally`);

    Pipeline.start("scan");
    let findings = [];
    files.forEach((f, idx) => {
      findings = findings.concat(scanFileContent(f.name, texts[idx]));
      Pipeline.detail("scan", `${idx + 1}/${files.length} — ${f.name}`);
    });
    Pipeline.ok("scan", `${findings.length} finding(s)`);
    scanLog(`done — ${findings.length} finding(s)`, "ok");

    Pipeline.start("render");
    finalizeScan(findings, `${files.length} uploaded file(s)`, { name: `📁 ${files.length} uploaded file(s)`, lang: "local upload", url: files.map(f => f.name).join(", ").slice(0, 120) });
    Pipeline.ok("render");
    Pipeline.finish(`complete — ${findings.length} finding(s)`);
  } catch (e) {
    Pipeline.abort(e.message);
    scanLog(e.message, "err"); scanErrorShow(e.message);
  } finally { setButtonsDisabled(false); }
});

/* =====================================================================
   INIT — restore a cached scan if one is still fresh, else empty state
===================================================================== */
(function init() {
  const cached = Cache.load();
  if (cached) {
    current.secretsNote = cached.secretsNote || current.secretsNote;
    finalizeScan(cached.issues, cached.targetLabel, (cached.repoCards || [])[0], { fromCache: true });
    Cache.showBar(cached.ts);
  } else {
    renderAll();
  }
})();
