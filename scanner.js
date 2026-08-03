/*!
 * scanner.js — BLACKZ CRACK FINDER rule engine + GitHub indexer
 *
 * Pure, DOM-free logic shared between:
 *   - index.html (loaded via <script src="scanner.js"> — attaches to window)
 *   - tests/scanner.test.js (loaded via require("../scanner.js") in Node)
 *
 * This is a pattern-based (regex/heuristic) scanner, not a real SAST engine.
 * It is intentionally dependency-free so the whole project stays a
 * zero-build, zero-install static page. See docs/SYSTEM_DESIGN.md for the
 * architecture and known limitations.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function isPlaceholder(v) {
    return /your[-_ ]?(key|token|secret|password|api)|xxxx|changeme|placeholder|dummy|<[^>]+>|\{\{|example\.com|test[-_]?(key|token|secret)|fake[-_]?(key|token)/i.test(v);
  }

  /* ===================================================================
     RULE ENGINE — pattern-based vulnerability detectors
     Each rule: { id, sev, cat, title, regexes: [...], why, fix, exclude? }
     Add a new rule by pushing a new object here — see CONTRIBUTING.md.
  =================================================================== */
  const RULES = [
    { id: "cors-wildcard", sev: "critical", cat: "security", title: "CORS allows any origin (wildcard)",
      regexes: [/allow_origins\s*=\s*\[\s*["']\*["']\s*\]/g, /origin\s*:\s*["']\*["']/gi, /Access-Control-Allow-Origin['"]?\s*[:=]\s*["']\*["']/gi],
      why: `Any website can call this API directly from a victim's browser. Combined with no auth/rate-limit, it's an open relay attackers can use as a free backend or to burn API budget.`,
      fix: `Replace the wildcard with an explicit allow-list of the real frontend origin(s), and set <code>allow_credentials=False</code> unless you specifically need cookies.` },
    { id: "hardcoded-secret", sev: "critical", cat: "secrets", title: "Hardcoded credential / API key detected",
      regexes: [/AKIA[0-9A-Z]{16}/g, /sk_live_[0-9a-zA-Z]{16,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /xox[baprs]-[0-9A-Za-z-]{10,}/g,
        /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-\/+=]{12,}["']/gi, /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/g],
      exclude: v => isPlaceholder(v),
      why: `A real-looking credential is committed to source. Anyone who can read the repo (or its history) can use it directly.`,
      fix: `Revoke/rotate the credential immediately, remove it from git history (<code>git filter-repo</code> or BFG), and load secrets from environment variables / a secrets manager instead.` },
    { id: "eval-exec", sev: "high", cat: "injection", title: "Dynamic code execution (eval/exec/Function)",
      regexes: [/\beval\s*\(/g, /\bexec\s*\(\s*[^)]*(input|request|argv|params)/gi, /new Function\s*\(/g],
      why: `Executing dynamically-built strings as code is a classic path to remote code execution if any part of the string is influenced by user input.`,
      fix: `Avoid eval/exec entirely. Use a safe parser, an allow-listed dispatch table, or <code>ast.literal_eval</code> for simple data.` },
    { id: "shell-injection", sev: "high", cat: "injection", title: "Shell command built from a string (shell=True / shell_exec / system)",
      regexes: [/subprocess\.\w+\([^)]*shell\s*=\s*True/g, /\bos\.system\s*\(/g, /child_process\.exec\s*\(/g,
        /\bshell_exec\s*\(/g, /\bpassthru\s*\(/g, /\bproc_open\s*\(/g, /(?<!\w)popen\s*\(/g],
      why: `shell=True (Python), os.system/child_process.exec, and PHP's shell_exec/passthru/proc_open/popen all pass a string through an actual shell — if any part comes from user input, it's command injection.`,
      fix: `Pass arguments as a list with <code>shell=False</code> (Python), use <code>execFile</code>/<code>spawn</code> with an argument array (Node), or use <code>escapeshellarg()</code> plus an allow-list of expected values (PHP) — never raw string interpolation into a shell command.` },
    { id: "sql-injection", sev: "high", cat: "injection", title: "SQL built via string formatting/concatenation/interpolation",
      regexes: [/(execute|cursor\.execute)\s*\(\s*f["']/g, /(SELECT|INSERT|UPDATE|DELETE)[^;\n]{0,160}["']\s*\+\s*\w/gi,
        /(SELECT|INSERT|UPDATE|DELETE)[^;\n]{0,160}["']\s*\.\s*\$\w/gi, /(SELECT|INSERT|UPDATE|DELETE)[^;\n]{0,160}\$\w+/gi],
      why: `Interpolating values directly into SQL text — via +/. concatenation, f-strings, or PHP's "$var" string interpolation — lets an attacker change the query's meaning (classic SQL injection).`,
      fix: `Use parameterized queries / prepared statements — e.g. <code>cursor.execute("... WHERE id = %s", (id,))</code> (Python) or <code>$stmt = $pdo->prepare("... WHERE id = :id"); $stmt->execute(['id' => $id]);</code> (PHP) — never build SQL text with concatenation or interpolation.` },
    { id: "xss-innerhtml", sev: "medium", cat: "xss", title: "Unescaped HTML injection (innerHTML / dangerouslySetInnerHTML)",
      regexes: [/\.innerHTML\s*=(?!=)/g, /dangerouslySetInnerHTML/g, /document\.write\s*\(/g],
      why: `Writing unsanitized strings into the DOM lets attacker-controlled content execute as HTML/JS (stored or reflected XSS).`,
      fix: `Use <code>textContent</code>, a templating engine that auto-escapes, or sanitize with DOMPurify before inserting HTML.` },
    { id: "insecure-deserialization", sev: "high", cat: "injection", title: "Insecure deserialization (pickle / unsafe yaml.load)",
      regexes: [/pickle\.loads?\s*\(/g, /yaml\.load\s*\((?!.*Loader)/g],
      why: `Deserializing untrusted data with pickle or unsafe yaml.load can execute arbitrary code during deserialization.`,
      fix: `Use <code>json</code> for untrusted data, or <code>yaml.safe_load</code>. Never unpickle data from an untrusted source.` },
    { id: "weak-hash", sev: "low", cat: "crypto", title: "Weak hash algorithm (MD5/SHA1) in a security context",
      regexes: [/hashlib\.md5\s*\(/g, /hashlib\.sha1\s*\(/g, /createHash\(\s*["']md5["']\s*\)/g],
      why: `MD5/SHA1 are broken for integrity/collision resistance and unsuitable for password hashing.`,
      fix: `Use bcrypt/argon2/scrypt for passwords, or SHA-256+ for general integrity checks.` },
    { id: "debug-mode", sev: "medium", cat: "config", title: "Debug mode enabled",
      regexes: [/debug\s*=\s*True/g, /app\.run\([^)]*debug\s*=\s*True/g, /DEBUG\s*=\s*True/g],
      why: `Debug mode often exposes stack traces, source snippets, and an interactive debugger console to anyone who triggers an error.`,
      fix: `Set debug off in production; read it from an environment variable that defaults to False.` },
    { id: "insecure-http", sev: "low", cat: "network", title: "Hardcoded plaintext HTTP URL",
      regexes: [/http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[a-zA-Z0-9.\-]+/g],
      why: `Traffic over plain HTTP can be intercepted or tampered with in transit.`,
      fix: `Use HTTPS for any external endpoint; redirect HTTP to HTTPS server-side.` },
    { id: "permissive-perms", sev: "low", cat: "config", title: "Overly permissive file permissions (777)",
      regexes: [/chmod\s+(-R\s+)?777/g, /os\.chmod\([^)]*0o777\)/g],
      why: `World-writable files/directories let any local user (or compromised process) modify them.`,
      fix: `Use the minimum permission needed — typically 644 for files, 755 for directories.` },
    { id: "todo-security", sev: "info", cat: "doc", title: "TODO/FIXME referencing a known security gap",
      regexes: [/(TODO|FIXME)[^\n]{0,20}(cors|auth|security|secret)/gi],
      why: `A leftover TODO acknowledging a security gap that shipped to production anyway.`,
      fix: `Track it as a real issue with an owner and a deadline instead of a comment, or fix it now.` },
    { id: "insecure-random-secret", sev: "low", cat: "crypto", title: "Math.random() used near token/secret/password context",
      regexes: [/Math\.random\(\)[^\n]{0,40}(token|secret|password)|((token|secret|password)[^\n]{0,40}Math\.random\(\))/gi],
      why: `Math.random() is not cryptographically secure — predictable output can let an attacker guess tokens/passwords.`,
      fix: `Use <code>crypto.randomBytes()</code> (Node) or <code>secrets.token_urlsafe()</code> (Python) for anything security-sensitive.` },
  ];

  function makeFinding(rule, path, lineNo, snippet) {
    return {
      sev: rule.sev, repo: "live", repoTag: "🛰 live scan", cat: rule.cat,
      title: rule.title + (path ? ` — <code>${escapeHtml(path)}${lineNo ? ":" + lineNo : ""}</code>` : ""),
      what: `Pattern <code>${rule.id}</code> matched${path ? ` in <code>${escapeHtml(path)}</code>${lineNo ? ` at line ${lineNo}` : ""}` : ""}: <code>${escapeHtml((snippet || "").slice(0, 140))}</code>`,
      why: rule.why, impact: `Flagged by the client-side heuristic scanner — review the surrounding code to confirm before treating as a real finding.`,
      fixCode: rule.fix, fixIsHtml: true,
      file: path, line: lineNo,
    };
  }

  function scanFileContent(path, content) {
    const findings = [];
    if (/(^|\/)\.env(\.|$)/.test(path) && !/\.example|\.sample|\.template/i.test(path)) {
      findings.push({ sev: "critical", repo: "live", repoTag: "🛰 live scan", cat: "secrets",
        title: `Raw <code>.env</code> file committed — <code>${escapeHtml(path)}</code>`,
        what: `A <code>.env</code> file (not <code>.env.example</code>) is present in the scanned files.`,
        why: `.env files typically hold real credentials — committing one exposes every secret inside it to anyone with repo access.`,
        impact: `Treat every value in this file as compromised.`,
        fixCode: `git rm --cached ${escapeHtml(path)}\necho "${escapeHtml(path)}" >> .gitignore\n# then rotate every credential that was in this file`, file: path });
    }
    if (/\.(pem|key)$/.test(path) || /(^|\/)id_rsa$/.test(path)) {
      findings.push({ sev: "critical", repo: "live", repoTag: "🛰 live scan", cat: "secrets",
        title: `Private key file committed — <code>${escapeHtml(path)}</code>`,
        what: `A file matching a private-key naming pattern is present in the scanned files.`,
        why: `Private keys committed to a repo are compromised the moment they're pushed, even if later deleted (git history retains them).`,
        impact: `Rotate/replace the key pair immediately.`,
        fixCode: `git rm --cached ${escapeHtml(path)}\n# rotate the key pair; scrub git history with git-filter-repo or BFG`, file: path });
    }
    const lines = content.split("\n");
    for (const rule of RULES) {
      let countForRule = 0;
      const seenLines = new Set();
      for (const re of rule.regexes) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content)) && countForRule < 5) {
          const idx = m.index;
          const lineNo = content.slice(0, idx).split("\n").length;
          const lineText = (lines[lineNo - 1] || m[0]).trim().slice(0, 160);
          if (rule.exclude && rule.exclude(lineText)) continue;
          if (seenLines.has(lineNo)) { if (!re.global) break; else continue; }
          seenLines.add(lineNo);
          findings.push(makeFinding(rule, path, lineNo, lineText));
          countForRule++;
          if (!re.global) break;
        }
      }
    }
    return findings;
  }

  /* ===================================================================
     GITHUB REPO INDEXER (client-side, public repos only)
  =================================================================== */
  const ALLOWED_EXT = new Set(["js","jsx","ts","tsx","py","rb","go","java","php","json","yml","yaml","html","htm","txt","md","sh","c","cpp","cs","rs","kt","swift","conf","ini","toml","xml","env"]);
  const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor|\.git|\.next|venv|\.venv|__pycache__|coverage)(\/|$)/i;

  function parseRepoInput(raw) {
    raw = (raw || "").trim();
    let m = raw.match(/github\.com[:\/]+([^\/\s]+)\/([^\/\s#?]+)/i);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
    m = raw.match(/^([^\/\s]+)\/([^\/\s]+)$/);
    if (m) return { owner: m[1], repo: m[2] };
    throw new Error("Enter a GitHub repo as owner/repo or a full github.com URL");
  }
  async function fetchRepoMeta(owner, repo) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (r.status === 404) throw new Error("Repo not found — must be public");
    if (r.status === 403) throw new Error("GitHub API rate-limited (60 req/hr unauthenticated) — try again later, or paste the code instead");
    if (!r.ok) throw new Error(`GitHub API error ${r.status}`);
    return r.json();
  }
  async function fetchTree(owner, repo, branch) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    if (!r.ok) throw new Error(`Could not list files (${r.status})`);
    const data = await r.json();
    return { tree: data.tree || [], truncated: !!data.truncated };
  }
  function pickFiles(tree, maxFiles = 60, maxBytes = 250000) {
    const blobs = tree.filter(t => t.type === "blob" && !SKIP_DIR.test(t.path));
    const scored = blobs.map(b => {
      const ext = (b.path.split(".").pop() || "").toLowerCase();
      const isEnvFile = /(^|\/)\.env(\.|$)/.test(b.path) && !/\.example|\.sample|\.template/i.test(b.path);
      const isKeyFile = /\.(pem|key)$/.test(b.path) || /(^|\/)id_rsa$/.test(b.path);
      return { path: b.path, size: b.size || 0, isEnvFile, isKeyFile, relevant: isEnvFile || isKeyFile || ALLOWED_EXT.has(ext) };
    }).filter(b => b.relevant && b.size < maxBytes);
    scored.sort((a, b) => (b.isEnvFile || b.isKeyFile ? 1 : 0) - (a.isEnvFile || a.isKeyFile ? 1 : 0) || a.size - b.size);
    return scored.slice(0, maxFiles);
  }
  async function fetchRaw(owner, repo, branch, path) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch failed ${r.status}`);
    return r.text();
  }
  async function mapLimit(items, limit, fn) {
    const ret = new Array(items.length);
    let i = 0;
    async function worker() { while (i < items.length) { const idx = i++; try { ret[idx] = await fn(items[idx], idx); } catch (e) { ret[idx] = null; } } }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return ret;
  }

  return {
    escapeHtml, isPlaceholder, RULES, makeFinding, scanFileContent,
    ALLOWED_EXT, SKIP_DIR, parseRepoInput, fetchRepoMeta, fetchTree, pickFiles, fetchRaw, mapLimit,
  };
});
