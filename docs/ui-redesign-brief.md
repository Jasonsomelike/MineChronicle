# MineChronicle UI Redesign — Executable Brief

> **Reader**: an autonomous coding agent asked to redesign this app's UI.
> **Method**: written against `design-taste-frontend` (Leonxlnx taste-skill). That
> skill declares dense product UI **out of scope**, so §1 records that judgement and
> names exactly which parts of it are borrowed and which are not. The parts that are
> borrowed are the brief-inference discipline, the three dials, the redesign protocol
> and the pre-flight matrix.
>
> **Before touching code**: §2 (constraints) and §9 (verification). **Before claiming
> done**: §10 (pre-flight). Neither is optional.

---

## 0. Design Read

> **Reading this as: a local-first instrument console for one technical user reading
> their own Minecraft saves, with a dense, restrained, dark-capable language, leaning
> toward a bespoke CSS token system (not a component library) with monospace figures
> and exactly one saturated accent.**

### 0.A The three dials

Set from the read above, not from the skill's baseline of `8 / 6 / 4`. The baseline is
tuned for landing pages; this is the opposite kind of surface.

| Dial               | Value | Why                                                                                                                                                                         |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DESIGN_VARIANCE`  | **4** | A product UI is used daily by one person. Novelty costs them re-learning. Layout should be predictable; the invention belongs in the readout, not the chrome.               |
| `MOTION_INTENSITY` | **3** | The skill's own guidance: motion must be justified in one sentence. Here that sentence is "confirm the state changed". Nothing else earns its place on a screen of numbers. |
| `VISUAL_DENSITY`   | **7** | This is a measurement instrument. Airy would mean scrolling to compare two numbers, which defeats the product.                                                              |

Cross-references below use these exact variable names.

---

## 1. Scope: what this skill does and does not cover here

`design-taste-frontend` §13 lists **dashboards and dense product UI** as out of scope
and instructs the reader to say so rather than apply it anyway. This is that statement.

**Borrowed, because it transfers:**

- §0 Brief inference + the one-line Design Read + dials (framing above).
- §11 Redesign Protocol: audit before touching, preservation rules, modernisation
  levers in priority order, "what never changes silently".
- §14 Pre-Flight: adapted to this product in §10.
- §4.2 Colour Consistency Lock, §4.4 Shape Consistency Lock, §4.5 full state cycles.

**Not borrowed, and why:**

- §2.A "reach for a real design system" names **Fluent UI** for this class of product.
  This project already has a working bespoke token system that predates this document.
  Adopting Fluent now is a full rewrite of every surface with **no user-visible
  benefit** and a large regression risk. Honest position: the recommendation is
  correct in general and **not worth acting on here**. If a future task adds a large
  new surface with no design opinions of its own, reconsider then.
- §3.C discourages `lucide-react`. The rule allows it when the project already depends
  on it, which this one does. No change.
- §9.G "zero em-dashes" is a marketing-copy rule. The UI is Chinese; not applicable.
- §3 Tailwind utilities, `motion/react`, `next/font`, `'use client'`: this is Vite +
  React + bespoke CSS on Tauri. Tailwind is present **only for its preflight**. None of
  the stack guidance applies.
- The entire hero / bento / marquee / logo-wall vocabulary. There is no marketing page.

---

## 2. Hard constraints

Not preferences. Violating one is a defect.

1. **Offline. No network at runtime.** No CDN, no remote fonts, no telemetry, no
   external request of any kind. Fonts are bundled; verify with §9.4.
2. **Tailwind is only its preflight.** `@import 'tailwindcss' source(none)`. Do not add
   utility classes; do not remove the import. Preflight supplies the base reset and
   `source(none)` is what stops it scanning for utilities.
3. **Styling lives in CSS files, not utility classes.**

   | File                                               | Owns                                                                |
   | -------------------------------------------------- | ------------------------------------------------------------------- |
   | `src/styles/tokens.css`                            | Design scales: control sizes, spacing, type, radius, shadow, motion |
   | `src/warmth.css`                                   | **Colour roles** only, as `:root` and `:root[data-theme='dark']`    |
   | `src/styles/shell.css`                             | App chrome: header, primary nav, status strip, settings jump        |
   | `src/styles/pages.css`                             | Page-level density helpers                                          |
   | `src/styles.css`                                   | The bulk: components and pages                                      |
   | `src/motion.css`                                   | Motion, and the reduced-motion reset                                |
   | `src/components/Dashboard.css`, `ZoomControls.css` | Component-local                                                     |

   A colour literal in a component file is a defect. Add a role to `warmth.css`.

4. **Windows + WebView2 (Chromium 153).** `@starting-style`,
   `transition-behavior: allow-discrete`, `color-mix()`, `:has()` are all available. Do
   not add prefixed fallbacks for them.
5. **UI language is Chinese; numerals and identifiers are Latin.** Keep it that way.
6. **The archive is the user's only copy.** A UI task must never write to
   `%APPDATA%\dev.minechronicle.desktop\minechronicle.sqlite3`. Read a copy if needed.
7. **Do not break the suites.** `npm run verify` and the four Playwright suites stay
   green. Several assert on DOM shape; if you change markup, update them **and say so**.

---

## 3. The subject

|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| **Product**    | MineChronicle — local-first Windows desktop app (Tauri 2 + React 19 + Vite)          |
| **Job**        | Watch a Minecraft save's statistics files and report how a world's play time changed |
| **User**       | One person, own machine, asking "how much have I actually played"                    |
| **Not**        | a server dashboard, multi-user, cloud, or a launcher                                 |
| **Vernacular** | 观测 · 存档 · 实例 · 增量 · tick                                                     |

**The unit is the tick.** Minecraft stores play time in ticks, 20 per second. The app
accumulates them as `i64` and moves them over IPC as decimal strings. A design that
treats time as generic duration has missed what this measures.

**The mechanism is observation.** It samples a file periodically and records a delta. A
gap in the record means _the observer was not running_, **not** that the user was not
playing. The UI must never blur that. Several copy decisions exist purely to keep it
sharp, and they are load-bearing.

---

## 4. Current state — measured 2026-09-23

Baseline re-measured with `scripts/qa-remeasure-baseline.mjs` (1440×1000, mock IPC +
observation fixture, details closed). Card/shadow counts use a resting-panel heuristic
(`border-radius ≥ 8`, `border ≥ 1`, `padding ≥ 12`, height > 60) and may under-count
nested article chips relative to the 2026-09-22 eyeball pass; heights and type sizes
are directly comparable.

### 4.A Page heights at 1440×1000

| Route           | Height | Cards | Shadowed | Type sizes rendered |
| --------------- | ------ | ----- | -------- | ------------------- |
| `#/dashboard`   | 1697px | 2     | 2        | 11,12,13,15,18,28   |
| `#/instances`   | 1000px | 0     | 0        | 12,13,18            |
| `#/worlds`      | 1000px | 0     | 0        | 11,12,13,15,18      |
| `#/timeline`    | 1030px | 0     | 0        | 11,12,13,15,18      |
| `#/statistics`  | 1404px | 0     | 0        | 11,12,13,15,18      |
| `#/observation` | 1167px | 2     | 2        | 11,12,13,15,18,22   |
| `#/settings`    | 2152px | 6     | 6        | 11,12,13,18         |

Heights match the 2026-09-22 pass exactly. `#/statistics` no longer renders **10px**
(step 1 landed).

**2026-09-23 step 2**: resting-card elevation removed in light mode
(`--shadow-card` off `.settings-card` and dashboard panels). Shadowed resting cards
**10 → 0** (dashboard 2→0, observation 2→0, settings 6→0). Overlay layers
(`--shadow-pop` / `--shadow-modal`) and structural shadows (nav, field, focus glow,
cutout, sticky settings jump) unchanged. `qa-design-check.mjs`: 14/14, 0 violations.

### 4.B What already works — do not undo

- **A seven-step type scale** 11/12/13/15/18/22/28. Two regressions, both in
  `src/styles/pages.css`: a **9px** size (below the floor) and a **10px** size. Fixed in
  step 1 of §8; see §4.D.
- **Named scales** for radius, motion and elevation, applied to every stylesheet
  **except `pages.css`**, which was added later and bypassed them in four radii and one
  shadow. Fixed in step 1; see §4.D.
- **A cool graphite / jade palette.** Light is neutral paper, dark is near-black
  graphite, one phosphor-jade accent. Measured 0 text nodes below WCAG AA across
  7 pages × 2 themes.
- **A bundled monospace** (`--font-mono`, JetBrains Mono) on figures and identifiers.
  0 remote requests.
- **Elevation is surface steps in dark, shadows in light.** The four elevation tokens
  resolve to `none` under `[data-theme='dark']`.
- **A global reduced-motion reset** at `src/styles.css` ≈ line 1328
  (`*, *::before, *::after { animation: none !important }`). Keep it.
- **The instrument readout**: a shared ruler primitive showing a measured value against
  a graduated track, now used across list surfaces.

### 4.D Scale violations found and fixed on 2026-09-22

`src/styles/pages.css` was added after the token pass and bypassed it in seven places.
All were fixed and the check in §9.4 now reports 0 violations across 14 combinations.
Recorded here because the first draft of this document asserted these did not exist,
and the assertion was wrong:

| Location                      | Was                  | Now                    | Visual change                     |
| ----------------------------- | -------------------- | ---------------------- | --------------------------------- |
| `.world-mini-bar` (4px tall)  | `border-radius: 2px` | `var(--radius-xs)`     | none — CSS clamps to half the box |
| `.rank-bar` (3px tall)        | `border-radius: 2px` | `var(--radius-xs)`     | 0.5px tighter                     |
| corner badge (14px tall)      | `border-radius: 7px` | `var(--radius-pill)`   | none — 7px is half of 14px        |
| placeholder badge (16px tall) | `border-radius: 8px` | `var(--radius-pill)`   | none — 8px is half of 16px        |
| corner badge text             | `font-size: 9px`     | `var(--type-micro)`    | **was below the floor**           |
| placeholder badge text        | `font-size: 10px`    | `var(--type-micro)`    | **was off-scale**                 |
| placeholder badge ring        | literal `box-shadow` | `var(--shadow-cutout)` | none — new structural token       |

**The lesson for the reader**: the two type sizes were invisible to a code read. The
only thing that surfaced them was rendering every page and collecting the computed
sizes. Run §9.4 before and after any change to a stylesheet.

### 4.E Commit line

```
23cbc76 Restore world row mini playtime bars beside totals
ef89d6b Remove duplicate stat placeholder rules so icon badges keep the larger size
8e2ed82 Drop ranking underline bars so list rows stop reading as stray green rules
d9be37f Fix snapshot page routing and unify instrument readouts across lists
6afbeee Polish instrument readouts, ranking bars, stats placeholders and status tones
f5b4149 Split ScanPanel into shell and page modules and close UX density debt
```

**The installed app (0.10.23) lags this source.** Do not read the installed build as a
picture of the code. Run `npm run dev` and look at `http://127.0.0.1:1420`.

---

## 5. Redesign protocol (skill §11, applied)

### 5.A Mode: **Redesign — Preserve**

Per skill §11.A. Justification: the information architecture is sound, the content is
real, and a design system with tokens already exists. Nothing here is a greenfield.

Consequence, per §11.E: **targeted evolution, not a full redesign.** Roughly 70% of the
value at 40% of the risk.

### 5.B The audit is done — §4 above is it

Skill §11.B asks for brand tokens, IA, content blocks, patterns to preserve, patterns to
retire, a dial reading of the existing site, and an SEO baseline. For a local desktop
app with no SEO surface, the applicable parts are recorded in §4.B (preserve) and §6
(retire).

### 5.C Modernisation levers, in priority order

Skill §11.D. **Apply in order and stop when the brief is satisfied.** Do not skip ahead:
the levers are ordered by value per unit of risk.

| #   | Lever                            | Status here                                                                             |
| --- | -------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | **Typography refresh**           | Largely done (seven-step scale + mono figures). Remaining: the 10px regression.         |
| 2   | **Spacing & rhythm**             | Partly done (4px scale). Remaining: the hero card's dead space; the three 1000px pages. |
| 3   | **Colour recalibration**         | Done (graphite + jade, 0 below AA). Remaining: light-mode shadow audit.                 |
| 4   | **Motion layer**                 | Done and deliberately thin (`MOTION_INTENSITY: 3`). Do not add more.                    |
| 5   | Hero & key-section recomposition | Done — the dashboard hero is the ruler.                                                 |
| 6   | Full block replacement           | **Not warranted.** Do not reach for this.                                               |

The work order in §8 follows this table.

### 5.D Preservation rules (skill §11.C)

- **Do not change information architecture.** Routes, section order, nav labels and
  anchor ids stay stable. Muscle memory is the product here.
- **Extract brand colour before applying any palette opinion.** Graphite + jade is the
  brand. It is not up for renegotiation in a polish pass.
- **Preserve copy voice.** Visual modernisation is not a content rewrite. In
  particular the boundary vocabulary (`结束时间未知`, `缺少本地基线`, `已缺失`) is
  precise and must not be softened into error-speak.
- **Honour existing accessibility wins.** Do not regress focus states, keyboard paths,
  contrast, or the reduced-motion reset.
- **Respect existing test assertions.** They encode behaviour someone chose on purpose.

### 5.E What never changes silently (skill §11.F)

Requires explicit human approval:

- Route slugs in `src/app/routes.ts`, and primary nav labels.
- Form field names and order.
- The wordmark.
- Any copy that states a data limitation (the boundary vocabulary above).
- Anything that changes what a number _means_.

---

## 6. What to retire

- **Resting cards wearing a shadow in light mode.** Six of eight settings cards. A
  shadow says "this floats"; a resting card needs a border. Reserve elevation for
  layers that genuinely overlay.
- **The dashboard hero card's dead space.** Roughly 40% empty. Either raise the ruler's
  row count or let the card shrink. Unfilled space in a card reads as unfinished.
- **Off-scale sizes and radii in `src/styles/pages.css`.** 9px, 10px, and four literal
  radii. Retired in §4.D; `scripts/qa-design-check.mjs` now guards against a repeat.
- **The three 1000px pages.** That is the viewport height, which means the content is
  _shorter_ than the screen. Check the one-row and empty states; an empty page and a
  page with one row must not look the same.
- **Any rule, underline or accent bar that encodes nothing.** Commit `8e2ed82` removed
  some. Do not reintroduce the pattern.

---

## 7. Token contract

Defined in `src/styles/tokens.css` (scales) and `src/warmth.css` (colour roles).
**Never hardcode a value these cover.**

### 7.A Scales — `src/styles/tokens.css`

```
--control-sm 28px   --control-md 38px   --control-lg 46px
--space-1..8  4 8 12 16 20 24 28 32px
--type-micro 11  --type-caption 12  --type-body 13  --type-lead 15
--type-title 18  --type-heading 22  --type-display 28      (px)
--font-ui    'Segoe UI', 'Microsoft YaHei', sans-serif
--font-mono  'JetBrains Mono Variable', ui-monospace, 'Cascadia Mono', Consolas, monospace
--radius-xs 4  --radius-sm 6  --radius-md 10  --radius-lg 16  --radius-pill 999
--shadow-hairline / --shadow-card / --shadow-pop / --shadow-modal
--shadow-nav / --shadow-field / --shadow-focus-glow
--motion-reveal 650ms
--chrome-header 48px
```

### 7.B Rules that are easy to get wrong

- **Nothing renders below `--type-micro` (11px).** Tailwind's preflight sets
  `small { font-size: 80% }`; nested, that compounded to 9.6px. `<small>` is pinned to
  `--type-micro` outright. Never reintroduce a percentage floor — `max(11px, 85%)` does
  **not** work, because the percentage resolves against the parent first (13 × 0.85 =
  11.05) and the `max` then picks it.
- **Type tokens are `--type-*`, never `--text-*`.** `--text-caption` is a **colour** in
  `warmth.css`. A type token named `--text-something` silently shadows it, the invalid
  `font-size` falls back to inherited, and the change produces **no error and no
  off-scale value**. This shipped once and moved 130 elements up a size.
- **A nested corner is `outer − padding`.** `--radius-xs` exists for that. Mapping a
  nested 3px corner up to `--radius-sm` makes inner elements bulge out of the wrapper.
- **Dark takes depth from the surface ladder, not shadows.** Set the four elevation
  tokens to `none` in the dark block. The three structural ones (nav highlight, field
  inset, focus glow) draw structure and stay.
- **Override a token in `:root[data-theme='dark']`, never a plain `:root`.** A plain
  `:root` override applies to both themes. This shipped once and deleted the light
  theme's card depth.

### 7.C Colour roles — `src/warmth.css`

Both blocks define the same names: `--page`, `--surface`,
`--surface-raised/sunken/hover/active/tint/strong/strong-hover`, `--text`,
`--text-strong/muted/faint/label/accent/on-strong/status/hint/caption/summary/button`,
`--border`, `--border-soft/strong/input/danger`, `--danger`, `--danger-surface`,
`--success`, `--success-surface`, `--warning`, `--surface-info/warning/danger`,
`--chart-bar`, `--accent-amber`, `--focus-ring`, `--wash-a/b`, `--header-surface`.

**Every foreground/background pair ≥ 4.5:1** (3:1 for ≥18.66px, or ≥14px at weight
≥700). Measure it. §9.4 has the tool.

**Colour Consistency Lock** (skill §4.2): one accent, used identically everywhere.
`--chart-bar` and `--focus-ring` are the accent's two jobs; `--accent-amber` is a second
data hue for a second metric and must not leak into decoration.

---

## 8. Work order

Each step ends in a green §9.1–9.3 and a stated measurement. Commit per step.

| #     | Step                                                                                    | Lever | Acceptance                                       |
| ----- | --------------------------------------------------------------------------------------- | ----- | ------------------------------------------------ |
| 0     | Re-measure §4 and correct this document if the numbers moved                            | —     | Table carries today's date                       |
| ~~1~~ | ~~Move the off-scale sizes in `pages.css` onto tokens~~ **done, see §4.D**              | 1     | §9.4 reports 0 violations on all 14 combinations |
| 2     | Light-mode shadow audit: resting cards take a border, only overlay layers keep a shadow | 3     | Shadowed-card count reported, before → after     |
| 3     | Fill or remove the dashboard hero's dead space                                          | 2     | Page height and ruler row count reported         |
| 4     | Check the short pages against a larger fixture; design the one-row and empty states     | 2     | A screenshot of each state                       |
| 5     | Re-run §9.4 and §9.5; correct any drift the above introduced                            | —     | 0 violations                                     |
| 6     | Package: bump every version source, `npm run desktop:package`, install, launch          | —     | `last-startup.json` reports the new version      |

Step 1 also added `scripts/qa-design-check.mjs`, which §9.4 depends on and which did not
exist before. Reuse it rather than rewriting the thresholds.

**Version sources that must agree** — a mismatch makes the settings page throw at
startup, because `runtime_info` cross-checks them:
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src/lib/version.ts`, `src-tauri/Cargo.lock`.

Full state cycles (skill §4.5) apply to any interactive element you touch: **loading**,
**empty**, **error**, **tactile** (`:active` translate −1px). A static success state
alone is incomplete.

---

## 9. Verification protocol

Run after **every** step. Do not report a step done on the strength of reading code.

### 9.1 The gate

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"   # cargo is not on PATH by default
npm run verify
```

Must exit `0`: typecheck, eslint, vitest, prettier, rustfmt, clippy, cargo test.
Expected tallies at time of writing: **126 frontend, 223 Rust**.

> `tracking_contract` is intermittently red under the full parallel run. It watches a
> real directory against a deadline and takes ~16s, so concurrent test binaries starve
> it. Re-run once before investigating; if it fails standalone, it is real.

### 9.2 The four Playwright suites

They need the dev server on **port 1420** (`npm run dev` first).

```powershell
node scripts/qa-reliability-flow.mjs
node scripts/qa-review-fixes.mjs
node scripts/qa-observation-flow.mjs
node scripts/qa-player-persistence.mjs
```

Each prints `PASS: …` and exits `0`. A markup change that breaks one means updating the
assertion **and saying so** — never deleting it quietly.

### 9.3 Visual snapshot determinism

```powershell
node scripts/qa-visual-snapshot.mjs
Copy-Item output\visual-baseline output\snap-a -Recurse -Force
node scripts/qa-visual-snapshot.mjs
node scripts/qa-compare-snapshots.mjs output\snap-a output\visual-baseline
Remove-Item output\snap-a -Recurse -Force
```

Acceptance: **0 pages with real differences.** A few pages may show sub-pixel noise
(max channel delta 1/255) that varies run to run; that is rasterisation jitter and the
comparator separates it from a real difference. **Report the numbers you actually saw**;
do not claim 14/14 if you saw noise.

### 9.4 Contrast and type scale

Write `scripts/qa-design-check.mjs` if absent, and run it. It is the check that has
caught the most real defects on this project.

```
for each of 7 routes × 2 themes:
  open every <details> except .filter-drawer, so hidden content is measured too
  for every element with a non-empty own text node and visible:
    parse font-size -> assert in [11,12,13,15,18,22,28] and >= 11
    resolve nearest opaque ancestor background
    assert contrast(color, background) >= 4.5
      (or >= 3 when font-size >= 18.66px, or >= 14px with font-weight >= 700)
  assert no request left the origin
```

Acceptance: **0 off-scale, 0 below the floor, 0 below-AA**, on all 14 combinations.

This check has found, on this project: a token that shadowed a colour and pushed 130
elements up a size; three hardcoded `color: white` rules measuring 1.92:1 on the dark
accent; and the 10px regression named in §4.B.

### 9.5 Ruler requirements

On `#/dashboard` with `reducedMotion: 'reduce'`:

- widths and scale labels agree with the ranking values beneath;
- every row is a `<button>` and is reached by pressing `Tab`;
- `.ruler-fill` reports `animation-name: none`.

---

## 10. Pre-flight (skill §14, adapted)

Run before delivering. **Not optional.** A box you cannot tick honestly is a defect.

**Scope**

- [ ] Design Read declared, and the out-of-scope judgement in §1 stated rather than skipped?
- [ ] Dials stated with reasoning, not silently at baseline?
- [ ] Redesign mode declared (Preserve) and the modernisation levers applied **in order**?

**Consistency locks**

- [ ] **Colour**: one accent, identical across every surface; no colour literal in a component file?
- [ ] **Shape**: one radius system; nested radii are `outer − padding`?
- [ ] **Theme**: light and dark both defined for every role, and both measured?

**Contrast**

- [ ] Every text node ≥ 4.5:1 (3:1 large) in **both** themes, measured not assumed?
- [ ] Button label readable against its own fill? (White-on-jade measured 1.92:1 once.)
- [ ] Focus ring ≥ 3:1 against every surface it appears on?

**Type**

- [ ] Every size from the seven-step scale; nothing below 11px?
- [ ] Figures use `--font-mono` and tabular alignment?
- [ ] No type token named `--text-*`?

**Motion**

- [ ] Every animation justifiable in one sentence?
- [ ] All of it covered by the global reduced-motion reset?

**States**

- [ ] Loading, empty and error states exist for anything touched?
- [ ] One-row and empty list states designed, not just the populated case?

**Data honesty**

- [ ] Nothing claims "0" where the truth is "unreadable" (a missing world is `已缺失`, not `0 秒`)?
- [ ] Observation gaps are not presented as inactivity?

**Respect for what exists**

- [ ] No route slug, nav label, or section order changed silently?
- [ ] No test assertion deleted without saying so?
- [ ] Bundled font still bundled; no request leaving the origin?

**Mechanical**

- [ ] `npm run verify` exits 0?
- [ ] Four Playwright suites pass?
- [ ] Snapshot: 0 real differences, with the actual noise count reported?
- [ ] Installed build reports the new version in `last-startup.json`?

---

## 11. How to report back

For each step state: what changed, the file paths, the measured before → after, and the
command output proving it. If a check failed and you worked around it, name the check
and the reason. If you changed or deleted a test assertion, say so explicitly.

An honest "step 4 not started, here is why" is worth more than a confident summary that
does not survive `npm run verify`.
