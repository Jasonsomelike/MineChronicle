# UI Review — 0.10.24

> **Reader**: the agent that produced 0.10.24, or whoever picks this up next.
> **Verdict**: the mechanical targets were all met and the result still reads badly.
> That gap is the whole point of this document.
>
> Every claim below was measured on the current working tree (0.10.24, `1de9238`), not
> inferred from a screenshot. Reproduce anything you doubt; §5 has the commands.

---

## 0. What is genuinely good — do not undo it

I ran the checks before writing anything, and they pass. Say so plainly so the fixes
below are not read as "start over".

- **Resting-card elevation.** `--shadow-card` now has **0 references** and cards use
  `border: 1px solid var(--border)` + `background: var(--surface-raised)`. That is
  exactly the brief's §6 ask. `--shadow-pop` and `--shadow-modal` are still referenced
  by the player popover and the two dialogs, so overlay layers kept their depth. The
  fix was done correctly and should not be reverted.
- **Contrast and type scale.** `scripts/qa-design-check.mjs` reports **PASS across all
  14 page-theme combinations**: no off-scale size, nothing below the 11px floor, no
  text node below WCAG AA, no request leaving the origin.
- **`npm run verify` exits 0** (130 frontend tests, 223 Rust).
- **Snapshot determinism holds.**
- **The empty/one-row distinction** was added and is asserted, which the brief asked for.

The problem is not compliance. It is that compliance was treated as the finish line.

---

## P0 — A real information regression

### P0.1 `ReadStatus` replaced a timestamp with a constant word

**Evidence** — `git show 6afbeee -- src/components/ReadStatus.tsx`:

```diff
-        <small>最近更新：{new Date(updatedAt).toLocaleTimeString()}</small>
+        <small title={`最近更新 ${new Date(updatedAt).toLocaleString()}`}>
+          已缓存数据
+        </small>
```

**Why it is wrong.** The condition is `updatedAt > 0`, i.e. _after the first successful
read_, which is the permanent steady state. So the label shows `已缓存数据` on almost
every page, forever, and never changes. It carries no information. Meanwhile the one
piece of information it used to carry — when the data was last read — was moved into a
`title` attribute, which is:

- invisible unless a mouse hovers it,
- unreachable from the keyboard,
- announced inconsistently by screen readers.

Measured: the label renders **twice on the dashboard** (y≈184 and y≈1086) and once on
each of timeline, statistics, observation and settings. Each occurrence is a bare
`<small>` at 11px with no border and no background.

**Fix.** Put the time back in the visible text and drop the constant word:

```
最近更新 12:00:00
```

If you want the un-refreshed case to be legible, make the label _state_ something that
differs between states — for example a relative age (`2 分钟前`) that changes, or
nothing at all when the read is recent. A status indicator whose happy path is a fixed
string is decoration wearing the costume of information.

---

## P1 — What makes the app look broken

### P1.1 The `body` wash gradient reads as a smudge

**Evidence** — on every page, `body` paints two radial gradients, each 1440×597:

```
light: radial-gradient(at 95% 0%, rgba(238,241,240,.5), transparent 48%),
       radial-gradient(at 0% 35%, rgba(233,239,236,.5), transparent 50%)
dark:  radial-gradient(at 95% 0%, rgba(22,32,30,.5),   transparent 48%),
       radial-gradient(at 0% 35%, rgba(18,26,24,.5),   transparent 50%)
```

**Why it is wrong.** A 5% luminance difference spread over a 600px soft blob, anchored
to the page rather than to anything in it. On screen it does not read as depth; it reads
as a **rendering artefact** — the impression that the window has not finished painting.
It also fights the surface ladder: the eye cannot tell whether the pale region is a
surface or a smudge, which is precisely the signal dark mode depends on.

The brief's own §7 forbids decoration that encodes nothing. This is that, with the added
cost of looking like a bug.

**Fix.** Delete both gradients. If the page needs warmth, take it from the type and the
accent, not from a background wash. If you want to keep _something_, anchor it to a real
element — the observation status strip is the only thing on these pages whose state
changes — rather than to `body`.

### P1.2 Settings is two layout systems stacked, with a 200px hole

**Evidence** — measured on `#/settings` at 1440×1000:

| Column | x range    | Width | Height | Top → bottom |
| ------ | ---------- | ----- | ------ | ------------ |
| left   | 60 – 613   | 553   | 1049   | 244 → 1293   |
| right  | 633 – 1381 | 748   | 849    | 244 → 1093   |

The right column ends **200px before** the left, leaving a visible rectangular void. The
two columns are also a 1 : 1.35 width ratio. Then, below both, the page abandons the grid
entirely and stacks full-width blocks (档案与备份, the tinted notice blocks, 数据健康).

**Why it is wrong.** A two-column grid promises that both columns are the same length.
When they are not, the shorter one reads as a loading skeleton that never filled in.
Stacking a different layout underneath makes the page look assembled from two unrelated
screens.

**Fix.** Pick one:

- a real two-column grid with `align-items: start` **and** content balanced between the
  columns, plus a full-width band for the notices; or
- full-width sections with a max content width, and two columns only inside a section
  that genuinely has two halves.

Do not leave a fixed-height column next to a short one.

### P1.3 Settings section ids do not describe settings sections

**Evidence** — the headings and the section each one lives in:

| Heading      | Section id          |
| ------------ | ------------------- |
| 自己         | `settings-identity` |
| 启动与界面   | `settings-startup`  |
| PCL 自动联动 | `settings-import`   |
| 窗口与显示   | **`root`**          |
| 读取本地存档 | **`scan-title`**    |

The sticky nav lists five labels (身份 / 启动与显示 / 导入与联动 / 档案与备份 / 数据健康)
and targets anchors by id. Two of the visible sections have ids that belong to other
parts of the app, so the nav's relationship to the page is accidental rather than
declared.

**Fix.** Give every settings section a `settings-*` id and point each nav item at one.
There should be exactly as many nav items as sections, and each should be checkable by a
test.

---

## P2 — Density and proportion

The dials are `VISUAL_DENSITY: 7`. An instrument is judged on how much it shows and how
much padding it spends getting there.

### P2.1 A 1252px search field for 2 results

On `#/instances` the search input is **1252px wide** (viewport 1440) with the placeholder
「名称、Minecraft 版本或加载器」, and the page holds **2 results**. A field stretched to its
container is the classic tell of a layout that was never proportioned, only filled.

**Fix.** Cap it — `max-width: 360px`, or `min(360px, 100%)`. Let the results area have the
width instead.

### P2.2 Thin pages read as unfinished

Content ends at **510px** on `#/instances` and **662px** on `#/worlds`, inside a 1000px
window. That is not a defect in itself, but the content that _is_ there is very sparse:
a heading, a full-width search box, one collapsed group, and two bare lines of text
(`共 1 个实例`, `档案：D:\QA\archive.sqlite3`) with no container and no alignment to
anything above them.

**Fix.** Either give the short pages something to say — the instance's worlds, its last
read, its size on disk, a link into 实例观测 — or stop spending a full-width row on a
search box that filters two items. A short page of real content is fine; a short page of
chrome is not.

### P2.3 — withdrawn

An earlier draft of this review claimed the timeline rows had inconsistent heights
(`77, 77, 229, 29, 29, 29, 29, 76`) and that the date column could not be scanned. That
was wrong, and it is recorded here rather than deleted because the mistake is the
instructive part.

The measurement used the selector `.timeline-event, .event-row, li`. The bare `li` also
matched nested list items inside the expanded observation details, so the 29px "rows"
were somebody else's list. Measured against `.timeline-events > li`, the real rows are:

```
h= 77  .event-initial_import
h= 77  .event-increment
h=104  .event-mixed
h= 76  .event-rollback
```

Consistent within a sensible band, and the date column resolves to `left=72 width=132`
on **every** row, so it aligns perfectly. There is nothing to fix here.

The lesson: a loose selector produces confident numbers about the wrong elements. When a
measurement is the basis of a criticism, name the exact element it came from and then
check that the element is the one you think it is.

---

## 3. The pattern behind all of it

Each P1 and P2 item is the same mistake in a different costume: **something was added or
left in place because it was easy to reach, not because it earns its space.**

The wash is anchored to `body` because that is where a background is easy to set. The
constant label is easy to render because `updatedAt > 0` is already computed. The
full-width search is easy because the container is already full width. None of them
answers "what does this tell the reader".

Before adding any surface, answer in one sentence what it says that is not already on
screen. If the answer is "nothing", it is decoration. The brief's §7 lists the shapes
this takes; the list is not exhaustive.

---

## 4. Suggested order

| #   | Item                                                       | Why first                                                            |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | P0.1 restore the visible timestamp                         | It is a regression, and it is the only item that removes information |
| 2   | P1.1 delete the wash                                       | Largest single change in how the app reads, smallest diff            |
| 3   | P1.2 + P1.3 fix the settings grid and section ids together | Same file, same sitting                                              |
| 4   | P2.1 cap the search field                                  | One declaration                                                      |
| 5   | P2.2 short pages                                           | Needs a content decision, so leave it last                           |

---

## 5. How to re-verify

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm run verify                      # expect exit 0, 130 frontend / 223 Rust
node scripts/qa-design-check.mjs    # needs npm run dev on :1420; expect PASS
node scripts/qa-visual-snapshot.mjs
Copy-Item output\visual-baseline output\snap-a -Recurse -Force
node scripts/qa-visual-snapshot.mjs
node scripts/qa-compare-snapshots.mjs output\snap-a output\visual-baseline
```

Plus the four Playwright suites (`qa-reliability-flow`, `qa-review-fixes`,
`qa-observation-flow`, `qa-player-persistence`).

**These will all be green after the fixes above, and they were all green before them.**
That is the lesson to carry: on a visual task, a passing gate proves only that nothing
mechanical broke. It says nothing about whether the result is any good. The measurements
in this document — column geometry, gradient size, control width, row heights — are the
kind of check that catches what the gate cannot, and they are worth adding to
`qa-design-check.mjs` rather than repeating by hand.
