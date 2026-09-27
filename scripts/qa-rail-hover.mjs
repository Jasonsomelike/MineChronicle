/* global window, document, localStorage, getComputedStyle, Node, Element */
/**
 * The hover-expansion rail, as a user would meet it: rest on it, tab into it, leave,
 * press Escape, click a destination, dismiss it.
 *
 * Requires `npm run dev` on :1420 (this script never starts a server - see
 * qa-error-boundary.mjs).
 *
 *   node scripts/qa-rail-hover.mjs
 *
 * Asserts (acceptance A1-A15 of the hover-model spec):
 *   A1  no collapse button exists in the DOM, and 'rail-toggle' appears nowhere in src
 *   A2  the resting rail is 72px with zero visible labels and a 72px first grid column
 *   A3  records the content column's x (expected ~88 = 72 + 16 gap)
 *   A4  hovering opens the 192px fixed overlay with all 7 labels and 2 group titles
 *   A5  the content column does not move when the overlay opens (<= 2px)
 *   A6  moving into the content column closes it again (grace + shrink)
 *   A7  Tab into the nav opens the rail immediately (no 100ms intent delay)
 *   A8  Escape closes the overlay and hands focus outside the rail
 *   A9  clicking a destination switches the view and the rail STAYS open
 *       (a click never collapses the overlay; only leaving closes it afterwards)
 *   A10 a pointerdown outside the rail light-dismisses it
 *   A11 the behaviour is identical at 900px and 1440px; the 620px strip has no overlay
 *   A12 reduced motion: no transition/animation on the rail, and hover lands open fast
 *   A13 a legacy minechronicle.rail key is removed before first paint
 *   A14 a full hover -> navigate -> close cycle writes no preference
 *   A15 the nav stays exactly seven buttons in every state
 */
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
/** 100ms intent + 180ms transition + margin: every hover wait clears both timers. */
const OPEN_WAIT_MS = 600;
/** 150ms leave-grace + transition + margin. */
const CLOSE_WAIT_MS = 600;

// This script never starts a server. The first request compiles the app and can take
// ~20s on a cold cache, so retry instead of failing on a single short timeout.
async function reachable() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(BASE, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return true;
    } catch {
      /* retry below */
    }
    await delay(2000);
  }
  return false;
}

if (!(await reachable())) {
  console.error(
    `开发服务器未就绪：请先在另一个终端运行 npm run dev，并确认 ${BASE} 可访问。`,
  );
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`,
  );
}
function checkRange(label, actual, [low, high]) {
  const ok = actual >= low && actual <= high;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: ${actual}${
      ok ? '' : ` (expected ${low}..${high})`
    }`,
  );
}
function checkMax(label, actual, ceiling) {
  const ok = actual < ceiling;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label}: ${actual}${
      ok ? '' : ` (expected < ${ceiling})`
    }`,
  );
}

/* The harness defaults to reduced motion, like the toggle script it replaces: the
   assertions are about state, not animation timing, and reduce makes the width
   land instantly (A7's "within 50ms" and A12's "within 150ms" both rely on it).
   The one transition-timing check lives in A12, which asserts the reduce behaviour
   itself. */
async function open(width, { seedLegacyKey = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 1200 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    (table) => {
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (cb) => cb,
        invoke: async (command) => (command in table ? table[command] : null),
      };
      localStorage.setItem('minechronicle.theme', 'light');
      if (seedLegacyKey) {
        localStorage.setItem('minechronicle.rail', 'collapsed');
      }
    },
    { table: backend, seedLegacyKey },
  );
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'domcontentloaded' });
  // .rail-toggle is gone, so the nav's own buttons are the render gate now.
  await page.waitForSelector('.app-nav button', { timeout: 30000 });
  await page.waitForTimeout(1200);
  return { context, page };
}

async function measure(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('.app-rail');
    const main = document.querySelector('.main-column');
    const cs = getComputedStyle(rail);
    const visible = (selector) =>
      [...document.querySelectorAll(selector)].filter(
        (el) => el.getBoundingClientRect().width > 0,
      ).length;
    const active = document.activeElement;
    return {
      railW: Math.round(rail.getBoundingClientRect().width),
      railX: Math.round(rail.getBoundingClientRect().x),
      position: cs.position,
      zIndex: cs.zIndex,
      transitionDuration: cs.transitionDuration,
      animationName: cs.animationName,
      mainX: Math.round(main.getBoundingClientRect().x),
      mainW: Math.round(main.getBoundingClientRect().width),
      gridCols: getComputedStyle(document.querySelector('.app-shell'))
        .gridTemplateColumns,
      visibleLabels: visible('.app-nav-label'),
      visibleGroupTitles: visible('.app-nav-group-title'),
      navButtons: document.querySelectorAll('.app-shell .app-nav button')
        .length,
      toggleCount: document.querySelectorAll('.rail-toggle').length,
      activeInsideRail: !!(active instanceof Node && rail.contains(active)),
      activeTag: active ? active.tagName.toLowerCase() : '',
      activeClass: active instanceof Element ? active.className : '',
      stored: window.localStorage.getItem('minechronicle.rail'),
      dataRail: document.documentElement.getAttribute('data-rail'),
      hash: window.location.hash,
    };
  });
}

async function hoverRail(page) {
  await page.hover('.app-rail');
  await page.waitForTimeout(OPEN_WAIT_MS);
}

/* --- A1: no collapse button anywhere -------------------------------------- */
{
  const { context, page } = await open(1440);
  const s = await measure(page);
  check('A1: no .rail-toggle in the DOM', s.toggleCount, 0);

  // And none hiding in the sources either.
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      const isDir = statSync(full).isDirectory();
      return isDir ? walk(full) : full;
    });
  const srcRoot = join(process.cwd(), 'src');
  const offenders = walk(srcRoot).filter((file) =>
    /.(css|tsx?|mjs|html)$/.test(file),
  );
  const hits = offenders.filter((file) =>
    readFileSync(file, 'utf8').includes('rail-toggle'),
  );
  check(
    'A1: no rail-toggle in src sources',
    hits.map((f) => f.replace(srcRoot, 'src')),
    [],
  );
  await context.close();
}

/* --- A2 + A3: the resting shape ------------------------------------------- */
{
  const { context, page } = await open(1440);
  const s = await measure(page);
  checkRange('A2: rail width at rest', s.railW, [70, 74]);
  check('A2: zero visible nav labels', s.visibleLabels, 0);
  check('A2: zero visible group titles', s.visibleGroupTitles, 0);
  check('A2: first grid column is 72px', s.gridCols.startsWith('72px'), true);
  console.log(
    `      (A3 baseline: .main-column x = ${s.mainX}, width = ${s.mainW})`,
  );
  await context.close();
}

/* --- A4 + A5: hover opens the overlay without displacing content ---------- */
{
  const { context, page } = await open(1440);
  const before = await measure(page);
  await hoverRail(page);
  const s = await measure(page);
  check('A4: overlay is position fixed', s.position, 'fixed');
  check('A4: overlay z-index', s.zIndex, '25');
  checkRange('A4: overlay width', s.railW, [190, 194]);
  check('A4: all seven labels visible', s.visibleLabels, 7);
  check(
    'A4: both group titles visible (档案 / 观测与设置)',
    s.visibleGroupTitles,
    2,
  );
  check(
    'A5: content column zero displacement',
    Math.abs(s.mainX - before.mainX) <= 2
      ? 0
      : Math.abs(s.mainX - before.mainX),
    0,
  );
  await context.close();
}

/* --- A6: moving into the content column closes it ------------------------- */
{
  const { context, page } = await open(1440);
  await hoverRail(page);
  await page.hover('.main-column');
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const s = await measure(page);
  checkRange('A6: rail width back at rest', s.railW, [70, 74]);
  check('A6: labels gone again', s.visibleLabels, 0);
  check('A6: position back to sticky', s.position, 'sticky');
  await context.close();
}

/* --- A7 + A8: keyboard open, Escape close --------------------------------- */
{
  const { context, page } = await open(1440);
  // First Tab lands on the first nav button (the wordmark and the residency labels
  // are spans, not focusables): focusin opens the rail with no intent delay.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(50);
  const s = await measure(page);
  check('A7: rail open right after Tab', s.railW >= 190, true);
  check('A7: focus is inside the rail', s.activeInsideRail, true);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = await measure(page);
  checkRange('A8: rail closed by Escape', after.railW, [70, 74]);
  check('A8: focus handed out of the rail', after.activeInsideRail, false);
  check(
    'A8: focus landed on the content column',
    `${after.activeTag}.${after.activeClass}`.includes('main-column'),
    true,
  );
  await context.close();
}

/* --- A9: clicking a destination navigates WITHOUT collapsing ---------------- */
{
  const { context, page } = await open(1440);
  await hoverRail(page);
  // 游戏实例: the second button, i.e. not the current page.
  await page.locator('.app-nav button').nth(1).click();
  const s = await measure(page);
  check('A9: view switched', s.hash, '#/instances');
  checkRange('A9: rail still open right after the click', s.railW, [190, 194]);
  check('A9: labels still visible after the click', s.visibleLabels, 7);
  // Only the pointer leaving (after the grace) closes it afterwards.
  await page.hover('.main-column');
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const after = await measure(page);
  checkRange('A9: leaving closes it afterwards', after.railW, [70, 74]);
  await context.close();
}

/* --- A10: light dismiss ---------------------------------------------------- */
{
  const { context, page } = await open(1440);
  await hoverRail(page);
  const main = await page.locator('.main-column').boundingBox();
  /* The open overlay spans x 0..192 and covers the content column's left edge
     (main.x ≈ 116 = 28 shell padding + 72 + 16 gap), so main.x+40 = 156 is still ON
     the overlay and a press there is rail.contains(target) - not a dismiss. Press
     320px in, well past the overlay's right edge, the way a user pressing on real
     content would. */
  await page.mouse.move(main.x + 320, main.y + 40);
  // Down without up would leave a dangling press; down+up is a real user's press.
  await page.mouse.down();
  const s = await measure(page);
  await page.mouse.up();
  checkMax('A10: pointerdown outside the rail closed it at once', s.railW, 190);
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const after = await measure(page);
  checkRange('A10: rail settled closed', after.railW, [70, 74]);
  await context.close();
}

/* --- A11: one behaviour at every rail width; strip tier untouched --------- */
{
  for (const width of [900, 1440]) {
    const { context, page } = await open(width);
    const before = await measure(page);
    checkRange(`A11@${width}: rail at rest`, before.railW, [70, 74]);
    check(`A11@${width}: no labels at rest`, before.visibleLabels, 0);
    await hoverRail(page);
    const openState = await measure(page);
    check('A11: overlay fixed', openState.position, 'fixed');
    checkRange(`A11@${width}: overlay width`, openState.railW, [190, 194]);
    check(`A11@${width}: seven labels`, openState.visibleLabels, 7);
    check(
      `A11@${width}: content column zero displacement`,
      Math.abs(openState.mainX - before.mainX) <= 2
        ? 0
        : Math.abs(openState.mainX - before.mainX),
      0,
    );
    await context.close();
  }

  // 620px: the strip tier. The rail is display:contents (no box), so there is nothing
  // for hover() to target - move the mouse across the strip instead and prove no
  // overlay appears.
  const { context, page } = await open(620);
  await page.mouse.move(400, 24);
  await page.waitForTimeout(OPEN_WAIT_MS);
  const strip = await measure(page);
  check('A11@620: no fixed overlay', strip.position === 'fixed', false);
  check('A11@620: all seven labels visible', strip.visibleLabels, 7);
  check('A11@620: seven nav buttons', strip.navButtons, 7);
  await context.close();
}

/* --- A12: reduced motion covers the new transition ------------------------ */
{
  const { context, page } = await open(1440);
  const effects = await page.evaluate(() => {
    const pick = (sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return { transition: cs.transitionDuration, animation: cs.animationName };
    };
    return { rail: pick('.app-rail'), shell: pick('.app-shell') };
  });
  check(
    'A12: rail transition none under reduced motion',
    effects.rail.transition,
    '0s',
  );
  check(
    'A12: rail animation none under reduced motion',
    effects.rail.animation,
    'none',
  );
  check(
    'A12: shell transition none under reduced motion',
    effects.shell.transition,
    '0s',
  );
  check(
    'A12: shell animation none under reduced motion',
    effects.shell.animation,
    'none',
  );

  await page.hover('.app-rail');
  await page.waitForTimeout(150);
  const s = await measure(page);
  checkRange(
    'A12: overlay at full width 150ms after hover',
    s.railW,
    [190, 194],
  );
  await context.close();
}

/* --- A13: the legacy key is cleaned before first paint -------------------- */
{
  const { context, page } = await open(1440, { seedLegacyKey: true });
  const s = await measure(page);
  check('A13: minechronicle.rail removed', s.stored, null);
  check('A13: no data-rail attribute', s.dataRail, null);
  checkRange('A13: resting rail is still 72px', s.railW, [70, 74]);
  await context.close();
}

/* --- A14: the full cycle writes no preference ----------------------------- */
{
  const { context, page } = await open(1440);
  await hoverRail(page);
  await page.locator('.app-nav button').nth(1).click();
  await page.waitForTimeout(CLOSE_WAIT_MS);
  await page.hover('.main-column');
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const s = await measure(page);
  check('A14: no preference written by the cycle', s.stored, null);
  // Control: prove this context can write storage at all, so the null above is
  // meaningful rather than a dead store.
  const themeStored = await page.evaluate(() =>
    window.localStorage.getItem('minechronicle.theme'),
  );
  check('A14: control - theme key is present', themeStored, 'light');
  await context.close();
}

/* --- A15: the nav is seven buttons in every state ------------------------- */
{
  const { context, page } = await open(1440);
  const resting = await measure(page);
  check('A15: seven nav buttons at rest', resting.navButtons, 7);
  await hoverRail(page);
  const openState = await measure(page);
  check('A15: seven nav buttons while open', openState.navButtons, 7);
  await context.close();
}

await browser.close();
console.log(
  failures === 0 ? '\nPASS: rail hover model' : `\nFAIL: ${failures} check(s)`,
);
process.exit(failures === 0 ? 0 : 1);
