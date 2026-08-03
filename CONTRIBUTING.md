# Contributing

Thanks for looking at this. The project has one hard rule and everything else is
negotiable:

> **Zero build step, zero install, zero runtime dependencies.** `git clone` + double-click
> `index.html` must always just work. Don't add a bundler, a package.json with
> dependencies, a framework, or anything that needs `npm install` to *run* the app.
> (`npm` is fine for *tests only* — see below.)

## Adding a new detection rule

All rules live in one array in `scanner.js`. Each rule looks like this:

```js
{ id: "my-new-rule", sev: "high", cat: "injection", title: "Human-readable title",
  regexes: [/some-pattern/g, /another-pattern/gi],
  why: `Why this pattern is dangerous — shown in the expanded issue card.`,
  fix: `A concrete fix, e.g. <code>use_this_instead()</code>.`,
  exclude: v => /* optional: return true to suppress a match, e.g. placeholder values */ },
```

Severity is one of `critical | high | medium | low | info`. Category (`cat`) is a short
lowercase tag like `security`, `secrets`, `injection`, `xss`, `crypto`, `config`, `network`,
`doc` — it's shown as a filter chip in the UI, so keep it terse.

**Before opening a PR:**
1. Add your rule to `RULES` in `scanner.js`.
2. Add at least one test in `tests/scanner.test.js` proving it fires on a real vulnerable
   pattern, and ideally one proving it *doesn't* false-positive on the safe equivalent.
   Where possible, use a real snippet from a well-known vulnerable app (DVWA, NodeGoat,
   etc.) rather than a synthetic one — that's how the current rules were validated.
3. Run `node tests/scanner.test.js` locally — it should print all green before you push.
   CI (`.github/workflows/test.yml`) runs the same command on every PR.
4. Open `index.html` in a real browser and sanity-check the new finding renders correctly
   (severity color, filter pill, expand/collapse, fix snippet) — the test suite checks the
   *logic*, not the rendering.

## Adding a whole new capability (not just a rule)

Bigger ideas — git-history secret scanning, an optional GitHub token input, dependency
vulnerability checks via OSV.dev, a SARIF/JSON export, etc. — are welcome. See
`docs/SYSTEM_DESIGN.md` for the current architecture and the reasoning behind what's
already there, so a new feature fits the same shape (client-side only, no new runtime
dependency, honest about its own limitations).

## Project layout

```
index.html                    the whole app: markup, styles, live-scan state, UI wiring
scanner.js                    pure logic: rule engine + GitHub indexer (no DOM access)
tests/scanner.test.js         node tests/scanner.test.js — zero-dependency test runner
.github/workflows/test.yml    CI: runs the tests above on every push/PR
docs/SYSTEM_DESIGN.md         architecture, verified limitations, roadmap
docs/DESIGN_SYSTEM.md         the UI's design tokens/components, for consistent styling
```

## Code style

No linter is enforced (no build step, remember) — just match the existing style: 2-space
indent, double quotes in JS, template literals for HTML fragments, and keep functions
DOM-free in `scanner.js` so they stay testable in plain Node.
