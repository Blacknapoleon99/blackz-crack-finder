# System Design — BLACKZ CRACK FINDER

## 1. Requirements

**Functional**
- Let a person scan arbitrary code — pasted text, uploaded files, or a public GitHub
  `owner/repo` — for common security/quality issues, using real, live-fetched content every
  time. No target is special-cased or pre-written into the page.
- Show results as expandable issue cards (what/why/impact/fix), with dynamic severity and
  category charts, filters, and an auto-generated fix roadmap, computed fresh from whatever
  was just scanned.

**Non-functional**
- Must run as a single static page with **zero backend, zero build step, zero install**. This
  is the whole value proposition: clone it, open it, it works.
- Must not leak anything scanned to any server this project controls, because it doesn't have
  one — verified, not just claimed (see §4, XSS invariant).
- Must be honest, not hardcoded: before a scan runs, every section shows a real empty state
  rather than fabricated example content. After a scan, every number and chart is derived
  from that scan's actual findings.
- Must degrade honestly, not silently, when it hits a real external constraint (GitHub's rate
  limit, a huge repo, a network error).

**Constraints**
- Solo maintainer, no infrastructure budget → rules out any design that needs a server,
  database, or paid API tier.
- Must stay approachable for outside contributors adding a rule in one file, without touching
  build tooling that doesn't exist.

## 2. High-level design

```
┌─────────────────────────────── your browser ───────────────────────────────┐
│                                                                              │
│   index.html                              scanner.js                       │
│   ┌────────────────────┐    calls as globals     ┌─────────────────────┐   │
│   │ UI: tabs, issue     │ ───────────────────────▶│ RULES (13 detectors) │   │
│   │ cards, charts,      │                          │ scanFileContent()   │   │
│   │ current-scan state, │◀─────────────────────────│ escapeHtml()        │   │
│   │ empty states         │      returns findings    │ GitHub indexer:     │   │
│   └────────────────────┘                          │  parseRepoInput()   │   │
│                                                     │  fetchTree()        │   │
│                                                     │  pickFiles()        │   │
│                                                     │  fetchRaw()         │   │
│                                                     └──────────┬───────────┘   │
└─────────────────────────────────────────────────────────────────┼──────────────┘
                                                                  │ fetch() — no auth, no cookies
                                     ┌────────────────────────────┼─────────────────────────┐
                                     ▼                            ▼                          
                           api.github.com              raw.githubusercontent.com
                           (repo meta, file tree —      (raw file contents —
                            CORS: allow-origin *)        CORS: allow-origin *)
```

There is no third box for "our server," because there isn't one. There is also no fourth box
for "example/case-study data" — the page holds no pre-written findings about any specific
project; `current` (the in-memory scan state) starts empty and is only ever populated by a
real scan you just ran.

## 3. Data flow

1. **Paste/upload scan**: `scanFileContent(path, content)` runs synchronously in-browser on
   exactly what you provided. Nothing leaves the tab.
2. **GitHub repo scan**:
   `parseRepoInput` → `fetchRepoMeta` (get default branch) → `fetchTree` (recursive git tree,
   one request) → `pickFiles` (filter/cap) → `fetchRaw` × N via `mapLimit` (concurrency 6) →
   `scanFileContent` per file → findings assigned to `current.issues` → rendered by the same
   code path as a paste/upload scan.
3. **Before any scan**: `current = { issues: [], repoCards: [], targetLabel: null }`. Every
   render function (`renderSummary`, `renderSevChart`, `renderCatChart`, `renderFilters`,
   `renderIssues`, `renderRoadmap`, `renderRepoCards`, `renderSecurityBanner`) checks for this
   empty state first and shows an honest "no scan yet" message rather than any placeholder
   findings.

## 4. Deep dive

**Rule engine data model** (`scanner.js`): each rule is
`{ id, sev, cat, title, regexes[], why, fix, exclude? }`. `scanFileContent()` runs every regex
against a file's text, dedupes to one hit per rule per line, and turns each match into a
finding object (`sev`, `cat`, `title`, `what`, `why`, `impact`, `fixCode`, `file`, `line`).
Every finding — regardless of target — flows through the exact same object shape and the exact
same rendering code, so there is no special-casing between "this repo" and "that repo": the
renderer has no concept of a specific project at all, only of `current.issues`.

**XSS-safety invariant (architectural contract):** any string derived from a scanned file's
*path* or *content* — both fully attacker-controlled when scanning someone else's repo — must
pass through `escapeHtml()` before reaching `innerHTML`. This was violated once during
development (a finding's `fixCode` interpolated a raw path) and is now a committed regression
test (`tests/scanner.test.js`, tests named `SECURITY: ...`), not just a one-time fix. Any new
rule or renderer touching `innerHTML` must uphold this.

**GitHub indexing algorithm:** `git/trees/{branch}?recursive=1` returns the *entire* file tree
in one request (flagged `truncated: true` if GitHub caps it — huge monorepos hit this; the tool
currently scans whatever subset comes back rather than failing). Files are filtered by
extension allow-list and a 250KB cap, `.env`/key files are force-prioritized so they're never
crowded out by the 60-file cap, then fetched concurrently (limit 6) via
`raw.githubusercontent.com`.

## 5. Scale & reliability — verified, not assumed

During development I verified, live, against **real, unrelated public repositories** (not
synthetic examples):
- `api.github.com/repos/{owner}/{repo}` and `.../git/trees/{branch}?recursive=1` both return
  the documented shape and both send `Access-Control-Allow-Origin: *` — confirmed against
  `octocat/Hello-World` and via GitHub's own CORS documentation.
- `raw.githubusercontent.com` serves real file content with the same open CORS header —
  confirmed against multiple unrelated repos.
- **True positives:** the rule engine was run against a real, intentionally-vulnerable PHP
  file (fetched live) and correctly flagged real command-injection and SQL-injection bugs.
  Two real gaps surfaced this way and were fixed: the shell-injection rule didn't cover PHP
  functions, and the SQL rule only understood `+`/f-string concatenation, not PHP's
  `.`/`"$var"` styles.
- **True negatives:** the same engine was run against a real file from a popular,
  well-maintained open-source Python project (fetched live) and correctly produced **zero**
  findings — confirming it doesn't just flag everything.
- Both cases are now permanent regression tests, not one-off manual checks.
- Unauthenticated GitHub API calls **do** get rate-limited in practice — this surfaced as
  intermittent empty responses during testing, which is exactly the failure mode documented in
  SECURITY.md, not a hypothetical.

**Known scale limits:**
- 60 requests/hour per IP (unauthenticated), shared across everyone on that network.
- Full-tree JSON for a very large repo (e.g. a big monorepo) can be several MB even though
  only 60 files get scanned — slow on a bad connection, not currently size-guarded.
- No git-history scanning — the biggest real gap, since real secret leaks are disproportionately
  found in history after a "remove secret" commit, not in the current tree.

## 6. Trade-off analysis

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Scanning approach | Client-side regex heuristics | Server-side Semgrep/CodeQL | Zero infra, zero privacy risk (nothing leaves the browser), instant — but strictly less accurate. Documented, not hidden. |
| Auth | None (unauthenticated GitHub API) | OAuth / personal access token | Simpler, safer by default (nothing to steal, nothing to leak) — costs rate limit headroom and blocks private repos. |
| Content | Zero pre-written examples; always live | A bundled "demo" case study | A hardcoded example is easy to fake trust in — a real, always-fresh scan is more work to show off but is actually trustworthy. |
| Distribution | Single static HTML + one JS file | npm package / CLI / SaaS | Matches "open it and it works" goal; harder to keep DRY as it grows (mitigated by extracting `scanner.js`). |
| Testing | Zero-dependency Node test runner | Jest/Mocha | Keeps the "zero dependencies" promise honest even in dev tooling; loses some ergonomics (no watch mode, no fancy diffs). |

## 7. Roadmap — what would make this better

Ordered roughly by impact-to-effort:

1. **Optional personal access token input** (kept in memory only, sent solely as an
   `Authorization` header to `api.github.com`, never persisted or logged) — raises the rate
   limit from 60/hr to 5,000/hr and unlocks scanning your own private repos. Biggest fix for
   the biggest current limitation.
2. **Git-history secret scanning** — walk recent commits/diffs for files that touch secrets,
   catching the "committed then removed" case the current tree-only scan misses entirely.
3. **Dependency vulnerability check** — parse `package.json`/`requirements.txt`/`go.mod` and
   query the public [OSV.dev API](https://osv.dev) (also CORS-enabled) for known CVEs in
   pinned versions. Real added value, still 100% client-side.
4. **Shareable scan reports** — serialize findings into a compressed, URL-safe hash fragment
   so a scan can be shared via link with no server involved.
5. **Export to SARIF** — enables GitHub's native "Code scanning" UI to ingest results, which
   also makes a natural on-ramp to:
6. **GitHub Action** — package the same `scanner.js` rule engine as a Node-based Action that
   runs on every PR and posts findings as check annotations. This is the highest-value "real
   production use case" and is straightforward now that the rule engine is a standalone,
   DOM-free, tested module.
7. **Browser extension** — "scan this repo" button injected directly on github.com repo pages.
8. **Language-specialized rule packs** (Go, Rust, Java) as the community contributes them —
   see CONTRIBUTING.md's template.

## What I'd revisit as this grows

- If the rule count gets large, split `RULES` into per-language files and load them lazily.
- If a GitHub Action ships, publish `scanner.js`'s logic as a versioned npm package so the
  browser build and the Action consume the exact same tested code instead of two copies.
- If git-history scanning ships, its cost (many more API calls per scan) will make the rate
  limit problem (#1 above) urgent rather than just nice-to-have — build them together.
