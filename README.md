# BLACKZ CRACK FINDER

[![test](https://github.com/Blacknapoleon99/blackz-crack-finder/actions/workflows/test.yml/badge.svg)](https://github.com/Blacknapoleon99/blackz-crack-finder/actions/workflows/test.yml)
[![deploy](https://github.com/Blacknapoleon99/blackz-crack-finder/actions/workflows/pages.yml/badge.svg)](https://github.com/Blacknapoleon99/blackz-crack-finder/actions/workflows/pages.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

`// scan any repo // find real issues`

A single-file, zero-install, zero-server web page that scans **any small codebase, uploaded
files, or public GitHub repo** for common security and code-quality issues, and explains each
one in plain language: what it is, why it matters, and how to fix it.

No build step. No `npm install`. No backend. Clone it, open `index.html`, done. Nothing is
hardcoded to any specific project — every result comes from a live scan of whatever you point
it at.

## Quickstart

```bash
git clone https://github.com/Blacknapoleon99/blackz-crack-finder.git
cd blackz-crack-finder
open index.html   # or just double-click it, or drag it into a browser tab
```

Live version: `https://blacknapoleon99.github.io/blackz-crack-finder/`

## What it does

Pick a source — **paste code**, **upload local files**, or give it a **public GitHub
`owner/repo`** — and it runs a 13-rule pattern-based engine across the real content:

CORS wildcards · hardcoded secrets/API keys · `eval`/`exec`/shell injection (Python, Node,
**and PHP** — `shell_exec`/`passthru`/`proc_open`) · SQL built via concatenation *or*
PHP-style string interpolation · XSS sinks · insecure deserialization · weak hashing · debug
mode left on · plaintext HTTP · committed `.env`/private-key files.

Every result shows the real file, line number, and matched snippet — so you (or the friend
you're showing this to) can go check it against the actual source. There is no pre-written
"case study" baked into the page; the severity chart, stats, filters, and fix roadmap are all
computed live from whatever was actually found in your last scan.

## Watch it work

A scan isn't a black box that emits a verdict. While it runs, the page shows:

- **A live pipeline** — every step (parse → resolve branch → list files → filter → download →
  run rules → render), its current state, and how long each one actually took. The timings are
  measured with `performance.now()` around the real work, not animated for effect.
- **A running timer** and progress bar for the scan as a whole.
- **A network trace** — the literal request URL, HTTP status, wall-clock milliseconds, and the
  first bytes of GitHub's real response body, for every single call the page makes. It works by
  wrapping the page's own `fetch`, so it can't drift from what really happened.

Paste and upload scans show an empty trace on purpose: those modes make **zero** network
requests, and the panel says so rather than hiding the fact.

## How it works (the honest version)

1. You give it a real source: pasted text, uploaded files, or a public GitHub repo.
2. For a GitHub repo, it calls GitHub's own public API (`api.github.com`) for the file list,
   then downloads each file's real content from `raw.githubusercontent.com` — the same bytes
   anyone sees on github.com. For paste/upload, it just reads what you gave it.
3. The same fixed set of rules runs on every scan, regardless of target — nothing is
   special-cased per repo.
4. Findings render with the real `file:line` and matched text as evidence.

Full architecture and data-flow diagram: [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

## Where the scanned data goes (short answer: nowhere)

This is the question people should ask a security tool, so here's the whole truth:

| Thing | Where it lives | How long |
|---|---|---|
| Pasted code / uploaded files | Your browser tab's memory only | Until you close the tab |
| File contents fetched from GitHub | Your browser tab's memory only | Until you close the tab |
| Your **last** scan's findings | `localStorage`, on your own machine | **24 hours**, then auto-expired on read |
| Anything at all | A server we own | Never — there is no server |

The only persistence is a single `localStorage` key (`bcf:lastScan`) so a refresh doesn't
lose your results. It's capped, versioned, self-expiring, and wiped by the **Clear cached
scan** button in the UI. It is never transmitted, because there is nothing to transmit it to.

**Why not a database?** Storing other people's source code and vulnerability findings on a
server would turn a harmless static page into a genuinely attractive breach target, and it
would mean writing a privacy policy for data nobody needs kept. Keeping it client-side isn't
a shortcut — it's the security property.

## Hosting

Deployed as pure static files, so effectively any host works. Two are configured:

- **GitHub Pages** — automatic via `.github/workflows/pages.yml` on every green push to
  `main`. Zero config, free TLS, no build step. Enable it once under
  *Settings → Pages → Source: GitHub Actions*.
- **Cloudflare Pages** — recommended for a custom domain. Point it at this repo with build
  command *(none)* and output directory `/`. The `_headers` file then applies a **real**
  Content-Security-Policy, HSTS, and `frame-ancestors 'none'`, which GitHub Pages cannot do
  because it does not support custom response headers.

`index.html` also carries the same CSP as a `<meta>` tag, so the page is locked down even on
a host that ignores `_headers`. There is deliberately no inline `<script>` anywhere, which is
what lets `script-src` stay at `'self'` instead of `'unsafe-inline'` — and a CI check fails
the build if an inline script ever creeps back in.

## Use cases

- **Auditing your own repo before making it public.**
- **Vetting a template/starter repo** before you build on it.
- **Teaching appsec by example** — point it at a friend's or your own project and walk through
  real, live findings together; every card explains *why* it's a problem and shows a concrete
  fix, not just a red flag.
- **Quick triage of an unfamiliar public repo** before you `git clone` and run someone else's
  code.
- **Hackathon / PR review sanity check** for a fast first pass before a deeper manual review.

None of these replace a real SAST tool (Semgrep, CodeQL) for anything you're shipping — see
[Limitations](#limitations).

## Architecture

100% static, three files:

| File | Role |
|---|---|
| `index.html` | Markup + styles only. No inline JavaScript. |
| `scanner.js` | The rule engine + GitHub indexer. DOM-free, so it's testable in plain Node. |
| `app.js` | UI layer: rendering, live pipeline, network trace, localStorage cache. |

Scanning a public repo calls `api.github.com` (file tree) and `raw.githubusercontent.com`
(file contents) directly from your browser — both are documented by GitHub to support CORS for
exactly this kind of client-side use, unauthenticated. Nothing you paste, upload, or scan is
ever sent anywhere else. Full breakdown in [SECURITY.md](SECURITY.md) and
[docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).

## Verified, not just claimed

During development the whole pipeline was run against real, live public repos — not just
synthetic examples:
- A genuinely vulnerable file fetched live from a well-known intentionally-vulnerable PHP app
  produced real `shell-injection` and `sql-injection` findings (this is also how two real rule
  gaps — missing PHP support — were found and fixed).
- A file fetched live from a popular, well-maintained real-world Python project produced **zero**
  findings, confirming the scanner doesn't just cry wolf on clean code.
- Both are captured as permanent regression tests in `tests/scanner.test.js`, which CI runs on
  every push, alongside `tests/ui.smoke.js` which drives all three scan modes end-to-end.

## Limitations

This is a **heuristic, regex-based scanner** — fast and dependency-free, not a substitute for
real static analysis. Concretely, today:

- Misses anything a pattern doesn't cover (13 rules, growing — see [CONTRIBUTING.md](CONTRIBUTING.md)).
- Can false-positive; every finding is "worth a human look," not proven.
- Only scans the current tree, not git **history** — a secret removed after being committed is
  still recoverable from history and this tool won't see it (yet — see the roadmap in
  [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)).
- GitHub's unauthenticated API is capped at 60 requests/hour **per IP**, shared by anyone on the
  same network — you may see a rate-limit error if you (or others near you) scan a lot in a
  short window.
- Can't scan private repos (no auth flow currently).
- Large repos are sampled (60 files / 250KB cap), not fully scanned.

## Testing

```bash
node tests/scanner.test.js   # rule engine, incl. real DVWA fixtures
node tests/ui.smoke.js       # app.js against a DOM stub, all 3 scan modes
```

Zero test-framework dependency, on purpose. CI runs both on every push/PR.

## Contributing

New detection rules, bug reports, and bigger feature ideas are all welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Responsible use

Only scan code you own or are authorized to review. The scanner only reads what GitHub already
serves publicly — it doesn't bypass access control — but scanning someone else's project without
permission is a courtesy issue regardless.

## License

[MIT](LICENSE) — © 2026 Kevin Klubeck

---

[kevinklubeck@gmail.com](mailto:kevinklubeck@gmail.com) · [shadow-lancer.com](https://shadow-lancer.com)
