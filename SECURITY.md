# Security

This document explains, concretely, what this project can and can't leak, because it's a
security tool and that question deserves a real answer instead of a badge.

## Architecture in one sentence

`index.html` + `scanner.js` + `app.js` are 100% static, client-side files. There is no
backend, no database, no analytics, no telemetry, and no server owned by this project.
Opening the file *is* running the whole application.

## Data flow — what actually leaves your browser

| Action | Request goes to | Sent | Received |
|---|---|---|---|
| Paste code / upload files | **nowhere** | — | — |
| Scan a public GitHub repo | `api.github.com` (unauthenticated) | repo owner/name, branch name | file tree metadata (paths, sizes) |
| Scan a public GitHub repo | `raw.githubusercontent.com` (unauthenticated) | file path | raw file text |

That's the entire network surface, and you don't have to take it on faith: the page's
**network trace** panel prints every request it makes — URL, status, timing, and the first
bytes of the response — by wrapping its own `fetch`. If a request isn't in that list, it
didn't happen.

No pasted code, uploaded file, or scan result is ever sent to any server controlled by this
project — there isn't one. Both GitHub endpoints are called unauthenticated (no token, no
cookies), and both are documented by GitHub to support CORS (`Access-Control-Allow-Origin: *`)
specifically so browser apps like this one can call them directly — this was verified live
during development, not assumed, including running the full paste → scan and GitHub-repo →
index → scan pipelines against real content (a known-vulnerable file and a clean, popular
real-world file) rather than only synthetic examples.

## Data retention

| Data | Storage | Lifetime |
|---|---|---|
| Pasted code, uploaded files, fetched repo contents | Tab memory only | Until the tab closes |
| Last scan's findings | `localStorage["bcf:lastScan"]`, on the user's own device | 24 hours, then evicted on the next read |
| Anything | A server owned by this project | Never — none exists |

The cache is versioned (`v: 1`), size-capped (400 findings), fails silently on quota
errors, self-expires on read, and is wiped by the **Clear cached scan** button. It never
leaves the device. Keeping other people's source code and vulnerability findings off a
server is a deliberate security decision, not an unimplemented feature: a database of
"known-vulnerable code, indexed by repo" would be a far more attractive target than
anything this tool protects.

## Content-Security-Policy

`index.html` carries a strict CSP as a `<meta>` tag so it applies on any static host:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data:;
connect-src https://api.github.com https://raw.githubusercontent.com;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`connect-src` is the important line: even if an XSS bug were found, the page cannot
exfiltrate to any host other than GitHub's two read-only endpoints. `script-src 'self'`
(no `'unsafe-inline'`) is only possible because there is **zero** inline JavaScript — a CI
check asserts index.html contains no inline `<script>`, so that property can't silently
regress. `style-src` still needs `'unsafe-inline'` for the severity-color style attributes;
that's the one deliberate relaxation.

When deployed to Cloudflare Pages, `_headers` promotes the same policy to real response
headers and adds HSTS, `nosniff`, and `Cross-Origin-Opener-Policy`.

## Threat model

**In scope / defended against:**
- A malicious public repo trying to XSS the person scanning it. Every attacker-controlled
  string (file paths, matched code snippets, and the raw response bytes shown in the network
  trace) is passed through `escapeHtml()` before it touches `innerHTML`. This is enforced by
  tests in `tests/scanner.test.js` and `tests/ui.smoke.js` — see the tests named
  `SECURITY: ...`. This exact class of bug was found and fixed during development (a
  `.env`/private-key finding template interpolated a raw file path into a fix snippet
  unescaped); it's now covered by regression tests so it can't silently come back.
- Executing fetched/pasted code. The scanner never `eval`s, `Function()`s, or otherwise
  runs anything it scans — content is only ever pattern-matched as text and rendered as
  escaped text.
- Exfiltration after a hypothetical XSS — blocked by `connect-src`, above.

**Explicitly out of scope:**
- This is a **heuristic, regex-based scanner**, not a real SAST engine. It will miss bugs
  a tool like Semgrep or CodeQL would catch, and it can false-positive. Treat every finding
  as "worth a human look," not as ground truth.
- It cannot scan private repos (there's no auth flow) and it cannot see git *history* — a
  secret that was committed and later deleted is invisible to it, even though it's still
  recoverable from the repo's history. This is the single biggest gap; see
  `docs/SYSTEM_DESIGN.md` for the planned fix.
- GitHub's unauthenticated API rate limit (60 requests/hour **per IP**) is shared by
  everyone behind the same network. On a shared/NAT'd connection, heavy use by one person
  can make the tool fail for others until the hour rolls over. There is currently no way
  around this without adding a personal access token input (on the roadmap).

## Responsible use

Only point the GitHub-repo scanner at code you own or are authorized to review. It only
reads what GitHub already serves to any anonymous visitor — it does not bypass access
control, authentication, or rate limits — but running any scanner against someone else's
project without permission is a courtesy issue even when it's technically "just reading
public data."

## Reporting a vulnerability

If you find a real security bug in the scanner itself (e.g., a new XSS vector, a way to
make it leak data somewhere it shouldn't), please open a GitHub issue, or email
**kevinklubeck@gmail.com** if it's sensitive enough that you'd rather not post it publicly
first. This is a small, unfunded personal project — there's no bug bounty, but real
reports are taken seriously and credited.
