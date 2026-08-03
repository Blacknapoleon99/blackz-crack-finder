/*!
 * ui.smoke.js — executes app.js against a minimal DOM stub.
 *
 * This is NOT a substitute for opening the page in a browser; it's a guard
 * against the failure mode that actually bites here: a rename/typo in an
 * element id or a crash inside the render/pipeline path that only shows up
 * at runtime. It drives all three scan modes with a mocked fetch and asserts
 * the live pipeline, network trace, and localStorage cache behave.
 *
 * Run: node tests/ui.smoke.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// Tests are queued and awaited in order. A plain try/catch around an async
// fn would let rejected promises pass silently — that exact bug hid three
// real failures the first time this file was run.
let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
async function run() {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log(`  ok  - ${name}`); }
    catch (e) { console.error(`FAIL - ${name}\n       ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${queue.length} test(s) passed.`);
  if (process.exitCode) { console.error("\nSome tests FAILED."); process.exit(1); }
}

/* ------------------------------------------------------------------ *
 * Minimal DOM stub — just enough surface for what index.html touches. *
 * ------------------------------------------------------------------ */
class El {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this._html = "";
    this._text = "";
    this.disabled = false;
    this.value = "";
    this.files = [];
    this.classList = {
      _s: new Set(),
      add: (...c) => c.forEach(x => this.classList._s.add(x)),
      remove: (...c) => c.forEach(x => this.classList._s.delete(x)),
      toggle: (c, on) => (on ? this.classList._s.add(c) : this.classList._s.delete(c)),
      contains: c => this.classList._s.has(c),
    };
    this.listeners = {};
  }
  // Mirror the real DOM closely enough to matter: assigning innerHTML blows
  // away appended children, and reading it back includes them. renderIssues()
  // builds cards with createElement/appendChild, so without this the rendered
  // findings would be invisible to assertions.
  set innerHTML(v) { this._html = String(v); this.children.length = 0; }
  get innerHTML() { return this._html + this.children.map(c => c.innerHTML).join(""); }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  dispatch(ev, arg) { return Promise.all((this.listeners[ev] || []).map(f => f(arg))); }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  scrollIntoView() {}
  getContext() {
    return { fillRect() {}, fillText() {}, set fillStyle(_) {}, get fillStyle() { return ""; }, set font(_) {}, get font() { return ""; } };
  }
}

const registry = new Map();
const doc = {
  hidden: false,
  getElementById: id => { if (!registry.has(id)) registry.set(id, new El()); return registry.get(id); },
  createElement: t => new El(t),
  querySelector: () => new El(),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

const store = new Map();
const sandbox = {
  console,
  document: doc,
  innerWidth: 1280,
  innerHeight: 800,
  performance: { now: () => Date.now() },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: (fn) => { fn(); return 0; },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  addEventListener: () => {},
  location: { reload() {} },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.matchMedia = () => ({ matches: false });

// Mocked GitHub endpoints — shaped like the real api.github.com responses.
const RAW_FILES = {
  "app.py": 'app.add_middleware(CORSMiddleware, allow_origins=["*"])\nos.system(cmd)\n',
  "safe.py": "def add(a, b):\n    return a + b\n",
};
const fetchCalls = [];
sandbox.fetch = async (url) => {
  fetchCalls.push(url);
  const body = url.includes("/git/trees/")
    ? JSON.stringify({ truncated: false, tree: Object.keys(RAW_FILES).map(p => ({ path: p, type: "blob", size: 120 })) })
    : url.startsWith("https://api.github.com/repos/")
      ? JSON.stringify({ default_branch: "main" })
      : RAW_FILES[url.split("/main/")[1]] ?? "";
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(body),
    text: async () => body,
    clone() { return this; },
  };
};

const ctx = vm.createContext(sandbox);
// Load the real scanner + portrait modules, then the page's own script.
vm.runInContext(fs.readFileSync(path.join(ROOT, "scanner.js"), "utf8"), ctx, { filename: "scanner.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "portrait.js"), "utf8"), ctx, { filename: "portrait.js" });
// index.html must carry NO inline script — a strict CSP (script-src 'self')
// depends on it, so this is an assertion, not a convenience.
const inlineBlocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// Always resolve through the page's own getElementById so lazily-touched
// ids are created the same way the real DOM would hand them back.
const el = id => doc.getElementById(id);

console.log("ui.smoke.js\n");

test("index.html contains no inline <script> (required by the strict CSP)", () => {
  assert.strictEqual(inlineBlocks.length, 0,
    "found an inline script block — it would be blocked by script-src 'self'");
  assert.ok(/Content-Security-Policy/.test(html), "CSP meta tag is missing");
  assert.ok(/script-src 'self'/.test(html), "CSP must pin script-src to 'self'");
  assert.ok(/connect-src https:\/\/api\.github\.com https:\/\/raw\.githubusercontent\.com/.test(html),
    "CSP must allow exactly the two GitHub hosts and nothing else");
});

test("app.js executes against the DOM without throwing", () => {
  vm.runInContext(appJs, ctx, { filename: "app.js" });
});

test("operator portrait is inlined as a data URI (no external request)", () => {
  const src = el("ghost-portrait").src;
  assert.ok(/^data:image\/webp;base64,/.test(src), "portrait must be an inline data URI, got: " + String(src).slice(0, 40));
});

test("empty state renders before any scan (no fabricated findings)", () => {
  assert.match(el("issues").innerHTML, /No scan yet/);
  assert.match(el("sev-chart-bars").innerHTML, /No findings yet/);
  assert.strictEqual(el("chip-secrets").textContent, "secrets: —");
});

test("paste scan drives the pipeline and makes ZERO network requests", async () => {
  const before = fetchCalls.length;
  el("paste-code").value = 'app.add_middleware(CORSMiddleware, allow_origins=["*"])';
  await el("paste-scan-btn").dispatch("click");
  assert.strictEqual(fetchCalls.length, before, "paste scan must not hit the network");
  assert.ok(el("live-panel").classList.contains("show"), "live panel should be visible");
  assert.match(el("live-label").textContent, /complete/);
  assert.match(el("pipeline").innerHTML, /Run all 13 rules/);
  assert.match(el("pl-bar-fill").style.width, /^100/, "progress bar should reach 100%");
});

test("a completed scan is cached to localStorage and is JSON-round-trippable", () => {
  const raw = store.get("bcf:lastScan");
  assert.ok(raw, "expected a cache entry");
  const d = JSON.parse(raw);
  assert.strictEqual(d.v, 1);
  assert.ok(Array.isArray(d.issues) && d.issues.length > 0);
  assert.ok(Date.now() - d.ts < 5000, "cache timestamp should be now-ish");
});

test("GitHub scan walks every pipeline step and traces the real requests", async () => {
  fetchCalls.length = 0;
  el("gh-repo").value = "octocat/Hello-World";
  await el("gh-scan-btn").dispatch("click");

  assert.ok(fetchCalls.some(u => u.startsWith("https://api.github.com/repos/octocat/Hello-World")), "should call the repo meta endpoint");
  assert.ok(fetchCalls.some(u => u.includes("/git/trees/main?recursive=1")), "should call the recursive tree endpoint");
  assert.ok(fetchCalls.some(u => u.startsWith("https://raw.githubusercontent.com/")), "should download raw file contents");

  const pl = el("pipeline").innerHTML;
  assert.ok(!pl.includes('data-state="err"'), "no pipeline step should be in an error state");
  assert.ok(!pl.includes('data-state="wait"'), "every pipeline step should have run");
  assert.match(el("live-label").textContent, /complete/);
  assert.ok(el("net-list").children.length >= 3, "network trace should list each request");
});

test("the GitHub scan produced real findings from the mocked file contents", () => {
  assert.match(el("sev-chart-note").innerHTML, /octocat\/Hello-World@main/);
  assert.match(el("issues").innerHTML, /CORS allows any origin/);
  assert.match(el("issues").innerHTML, /app\.py:1/, "findings must cite a real file:line");
});

test("SECURITY: a hostile repo name cannot inject HTML into the chart caption", () => {
  const note = el("sev-chart-note").innerHTML;
  assert.ok(!/<script/i.test(note));
});

test("SECURITY: network-trace entries escape attacker-controlled response text", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const NT = el("net-list");
  NT.children.length = 0;
  vm.runInContext(`NetTrace.add("https://raw.githubusercontent.com/a/b/main/${evil}", 200, 5, ${JSON.stringify(evil)});`, ctx);
  const rendered = NT.children.map(c => c.innerHTML).join("");
  assert.ok(!rendered.includes("<img src=x onerror"), "raw payload leaked into the trace");
  assert.ok(rendered.includes("&lt;img"), "payload should be HTML-escaped");
});

test("an expired cache entry is discarded rather than shown as fresh", () => {
  const d = JSON.parse(store.get("bcf:lastScan"));
  d.ts = Date.now() - 25 * 60 * 60 * 1000; // 25h old
  store.set("bcf:lastScan", JSON.stringify(d));
  const restored = vm.runInContext("Cache.load()", ctx);
  assert.strictEqual(restored, null, "a >24h entry must not be restored");
  assert.strictEqual(store.get("bcf:lastScan"), undefined, "expired entry should be evicted");
});

run();
