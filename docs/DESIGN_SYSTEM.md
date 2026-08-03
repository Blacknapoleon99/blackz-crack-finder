# Design System Audit — BLACKZ CRACK FINDER

Everything lives in one `<style>` block in `index.html` (no build step, remember — see
CONTRIBUTING.md). This audit documents the design language as it exists today so new
components/contributors stay visually consistent.

## Summary

**Components reviewed:** 11 | **Score:** 91/100

The token system (CSS custom properties in `:root`) is solid and consistently used across the
UI. The handful of gaps found during the initial pass (hardcoded button/chart colors, missing
keyboard focus styles, non-accessible click-only toggles) were fixed as part of this audit —
see "Priority actions" for what changed and why.

## Design tokens

### Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | Page background |
| `--surface` | `#030a04` | Card/panel background |
| `--surface-2` | `#06140a` | Hover/secondary surface |
| `--border` | `#113a1d` | Default border |
| `--border-bright` | `#1d6b32` | Interactive/focus border |
| `--text` | `#c8ffd8` | Primary text |
| `--text-dim` | `#5c9a71` | Secondary text |
| `--text-faint` | `#2e5c3c` | Tertiary/disabled/empty-state text |
| `--green` | `#00ff66` | Brand / success / primary action |
| `--green-dim` | `#08c94e` | Secondary green (borders, dim accents) |
| `--green-bright` | `#33ff85` | Primary button hover state |
| `--on-accent` | `#001a08` | Text color on top of a `--green` fill (buttons, active pills/tabs) |
| `--red` | `#ff3b4e` | Critical / error |
| `--orange` | `#ff9130` | High severity |
| `--yellow` | `#ffd83b` | Medium severity / warning |
| `--cyan` | `#23e8ff` | Low severity / links / info |
| `--pink` | `#ff2ec4` | "security" category accent (legend, category chart) |
| `--red-soft` / `--yellow-soft` / `--green-soft` | tints | Text-on-tinted-background where the full-saturation token doesn't have enough contrast |

Semantic mapping is consistent: red=critical, orange=high, yellow=medium, cyan=low/info,
green=clean/success/primary action. This mapping is used identically in the severity chips,
issue-card left accents, filter pills, and both dynamic bar charts — keep it that way for any
new severity-linked UI.

### Typography

| Token | Font | Use |
|---|---|---|
| `--mono` | JetBrains Mono | Body text, code blocks, inputs |
| `--term` | Share Tech Mono | Section titles, chips, buttons, labels (the "terminal UI" voice) |
| `--vt` | VT323 | ASCII header, glitch H1 (the "CRT" voice) |

Three-tier type system: `--mono` for anything read carefully (code, findings), `--term` for UI
chrome, `--vt` for decorative/display moments. Don't introduce a fourth font without a clear
reason.

### Spacing & radius

No spacing scale is tokenized — paddings/margins are hand-picked per component. Border radius
is consistently small and sharp: `3px`–`4px` everywhere except the terminal window chrome
(`8px`, intentionally more "window-like"). **Open item:** formalize a `--space-{1..5}` scale
before adding many more components (see Priority actions).

## Components

| Component | Variants | States | Score |
|---|---|---|---|
| `.pill` (filter) | dynamic per scan (severity + category) | default, hover, active, focus-visible | 9/10 |
| `.issue` card | 5 severities | collapsed/open, hover, focus-visible | 9/10 |
| `.scan-tab` | 3 (github/paste/upload) | active/inactive, focus-visible | 9/10 |
| `.scan-btn` | — | default, hover, disabled, focus-visible | 8/10 |
| `.chip` (status) | 4 (ready/crit/high/med/secrets) | static | 7/10 |
| `.stat` card | 4 (red/orange/yellow/cyan) | static, zero-state | 8/10 |
| `.repo` card | — | populated, empty state | 8/10 |
| `.phase` (roadmap) | 3 (ship/soon/later) | populated, empty state | 8/10 |
| Severity bar chart | dynamic | populated, empty state | 9/10 |
| Category bar chart | dynamic | populated, empty state | 9/10 |
| `.info-card` (how-it-works / legend) | 2 | static | 7/10 |

## Component: `.issue` (issue card)

**Description:** The core content unit — the only kind of finding this page ever renders,
whether it came from a GitHub scan, a paste, or an upload. Its shape is a contract: anything
producing a finding (a `RULES` entry in `scanner.js`) must fit
`{ sev, cat, title, what, why, impact?, fixCode?, file?, line? }`.

**Variants:** one per severity (`sev-critical|high|medium|low|info`), each pairing a text
color + tinted background + matching border from the same token (15%-alpha background is the
established way to tint a surface with a semantic color — reuse it rather than inventing a new
tint approach).

**States:** collapsed (default) → open (click or press Enter/Space on the header, adds `.open`,
rotates the chevron 90°) → hover (border brightens) → focus-visible (green outline, added in
this audit).

**Accessibility:** `.issue-head` is `role="button" tabindex="0" aria-expanded="{true|false}"`
with a keydown handler for Enter/Space, kept in sync with click-driven toggles. This was the
top gap in the first audit pass and is now fixed.

**Do / Don't**

| ✅ Do | ❌ Don't |
|---|---|
| Reuse the `sev-*` classes for any new severity-linked element | Invent a new red/orange/yellow scheme elsewhere |
| Keep `what/why/impact/fix` as the content slots | Add a 5th prose slot without a clear reason |

## Component: `.scan-btn` (primary action button)

**Description:** The one recurring "do the thing" button (scan GitHub repo / paste / upload).
Solid `--green` fill, `--on-accent` text, terminal font.

**States:**

| State | Visual |
|---|---|
| Default | `background: var(--green)`, text `var(--on-accent)` |
| Hover | `background: var(--green-bright)` |
| Disabled | `background: var(--border)`, text `var(--text-faint)` |
| Focus-visible | 2px `var(--green)` outline, 2px offset |

All four states are now fully tokenized (the on-accent text color and hover fill were the
last two hardcoded-hex offenders found in the first audit pass).

## Token coverage

| Category | Defined | Hardcoded instances remaining |
|---|---|---|
| Colors | 20 tokens | 3 acceptable exceptions: the macOS traffic-light dots (universal OS convention, not brand color) and the matrix-rain canvas `fillStyle` (Canvas 2D can't read CSS custom properties at all) |
| Spacing | none | no scale exists yet; ~10 distinct padding values in use |
| Typography | 3 font tokens | 0 hardcoded fonts — full coverage |
| Radius | none (but consistent by convention: 3–4px) | 0 major violations |

## Priority actions

1. ~~**Add visible `:focus-visible` styles**~~ **— done.** `outline: 2px solid var(--green)`
   applies to every interactive element (links, buttons, inputs, pills, tabs, issue headers).
2. ~~**Make `.issue-head`, `.scan-tab`, and `.pill` real accessible toggles**~~ **— done.**
   All three have `role`, `tabindex="0"`, Enter/Space keydown handling, and the correct ARIA
   state attribute (`aria-expanded` on issue headers, `aria-selected` on tabs, `aria-pressed`
   on filter pills).
3. ~~**Tokenize hardcoded chart/button colors**~~ **— done.** Added `--red-soft`,
   `--yellow-soft`, `--green-soft`, `--on-accent`, `--green-bright` tokens and removed the
   remaining hardcoded hex from buttons and charts.
4. **Introduce a `--space-{1..5}` scale** before the component count grows much further — not
   yet done, left for a future pass since it touches every component's padding (higher risk
   than the fixes above).
