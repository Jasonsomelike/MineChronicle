/* global window, document, localStorage, getComputedStyle */
/**
 * The collapse toggle, as a user would meet it: click it, reload, resize.
 *
 *   node scripts/qa-rail-toggle.mjs
 *
 * Asserts:
 *   1. an untouched install is expanded at 2048 and collapsed at 1175 (the breakpoint
 *      decides, and the attribute stays off the document so it can)
 *   2. clicking collapses at 2048, and the choice survives a reload
 *   3. a user collapsed at 2048 stays collapsed after narrowing to 900 - the explicit
 *      choice and the media query cannot fight
 *   4. a user who explicitly expands at 900 is served the compact rail anyway, because
 *      the breakpoint is the floor: 192px there would leave 809px of content
 *   5. the toggle stays visible, in the rail, and inside the window in every state
 *   6. the reduced-motion reset covers the transition the toggle introduces
 */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
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

async function open(width, reducedMotion = 'reduce') {
  const context = await browser.newContext({
    viewport: { width, height: 1200 },
    deviceScaleFactor: 1,
    reducedMotion,
  });
  await context.addInitScript((table) => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in table ? table[command] : null),
    };
    localStorage.setItem('minechronicle.theme', 'light');
  }, backend);
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  /* `domcontentloaded` rather than `networkidle`: the dev server drops its HMR socket on
     every source edit, and a socket that never settles makes `networkidle` time out on a
     page that is in fact fully rendered. The `waitForSelector` below is the real gate. */
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'domcontentloaded' });
  /* `attached`, not visible: below 860px the control is correctly `display: none` and a
     visibility wait would hang on the one tier that is supposed to hide it. */
  await page.waitForSelector('.rail-toggle', {
    timeout: 30000,
    state: 'attached',
  });
  await page.waitForTimeout(1200);
  return { context, page };
}

const state = (page) =>
  page.evaluate(() => {
    const rail = document.querySelector('.app-rail');
    const toggle = document.querySelector('.rail-toggle');
    const t = toggle.getBoundingClientRect();
    const ids = [...document.querySelectorAll('.app-nav-label')].filter(
      (el) => el.getBoundingClientRect().width > 0,
    ).length;
    return {
      attr: document.documentElement.getAttribute('data-rail'),
      stored: window.localStorage.getItem('minechronicle.rail'),
      railW: Math.round(rail.getBoundingClientRect().width),
      mainW: Math.round(
        document.querySelector('.main-column').getBoundingClientRect().width,
      ),
      visibleLabels: ids,
      toggleW: Math.round(t.width),
      toggleVisible: t.width > 0 && t.height > 0,
      toggleInsideRail:
        t.left >= rail.getBoundingClientRect().left - 14 &&
        t.right <= rail.getBoundingClientRect().right + 14,
      toggleOnScreen: t.left >= 0 && t.right <= window.innerWidth,
      title: toggle.getAttribute('title'),
      expanded: toggle.getAttribute('aria-expanded'),
      navButtons: document.querySelectorAll('.app-shell .app-nav button')
        .length,
    };
  });

/* 1. Untouched install. */
{
  const { context, page } = await open(2048);
  const s = await state(page);
  check('2048 untouched: attribute stays off the document', s.attr, null);
  check('2048 untouched: rail is labelled', s.railW, 192);
  check('2048 untouched: seven labels visible', s.visibleLabels, 7);
  check('2048 untouched: toggle offers 收起', s.title, '收起侧边栏');
  check('2048 untouched: seven nav buttons', s.navButtons, 7);
  await context.close();
}

/* 2. Click collapses, and the choice survives a reload. */
{
  const { context, page } = await open(2048);
  await page.click('.rail-toggle');
  await page.waitForTimeout(700);
  const s = await state(page);
  check('2048 after click: attribute is collapsed', s.attr, 'collapsed');
  check('2048 after click: preference stored', s.stored, 'collapsed');
  check('2048 after click: rail is 72px', s.railW, 72);
  check('2048 after click: labels gone', s.visibleLabels, 0);
  check('2048 after click: toggle now offers 展开', s.title, '展开侧边栏');
  check('2048 after click: aria-expanded false', s.expanded, 'false');
  check('2048 after click: toggle still on screen', s.toggleOnScreen, true);
  check('2048 after click: toggle still in the rail', s.toggleInsideRail, true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rail-toggle', {
    timeout: 30000,
    state: 'attached',
  });
  await page.waitForTimeout(1200);
  const after = await state(page);
  check('2048 after reload: still collapsed', after.railW, 72);
  check('2048 after reload: attribute restored', after.attr, 'collapsed');
  await context.close();
}

/* 3. Collapsed at 2048, then narrowed. The two must not fight. */
{
  const { context, page } = await open(2048);
  await page.click('.rail-toggle');
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.waitForTimeout(700);
  const s = await state(page);
  check('collapsed at 2048, narrowed to 900: still 72px', s.railW, 72);
  check(
    'collapsed at 2048, narrowed to 900: attribute intact',
    s.attr,
    'collapsed',
  );
  check('collapsed at 2048, narrowed to 900: no labels', s.visibleLabels, 0);
  await context.close();
}

/* 4. Expanded at 900. The breakpoint is the floor. */
{
  const { context, page } = await open(900);
  const before = await state(page);
  check('900 untouched: compact', before.railW, 72);
  check('900 untouched: toggle offers 展开 only', before.title, '展开侧边栏');
  await page.click('.rail-toggle');
  await page.waitForTimeout(700);
  const s = await state(page);
  check('900 after click: attribute is expanded', s.attr, 'expanded');
  check('900 after click: breakpoint still wins on width', s.railW, 72);
  check('900 after click: labels still hidden', s.visibleLabels, 0);
  check('900 after click: toggle now offers 收起', s.title, '收起侧边栏');
  await context.close();
}

/* 5. The strip tier has no rail to collapse. */
{
  const { context, page } = await open(620);
  const s = await state(page);
  check('620: no toggle rendered', s.toggleVisible, false);
  check(
    '620: the nav is still a top strip with all seven labels',
    s.visibleLabels,
    7,
  );
  check('620: seven nav buttons', s.navButtons, 7);
  await context.close();
}

/* 6. Reduced motion still cancels the new transition. */
{
  const { context, page } = await open(2048, 'reduce');
  const effects = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      const cs = getComputedStyle(el);
      return {
        transition: cs.transitionDuration,
        animation: cs.animationName,
      };
    };
    return {
      toggle: pick('.rail-toggle'),
      navButton: pick('.app-nav button'),
      shell: pick('.app-shell'),
    };
  });
  check(
    'reduced motion: rail toggle transition none',
    effects.toggle.transition,
    '0s',
  );
  check(
    'reduced motion: rail toggle animation none',
    effects.toggle.animation,
    'none',
  );
  check(
    'reduced motion: nav button transition none',
    effects.navButton.transition,
    '0s',
  );
  check(
    'reduced motion: shell transition none',
    effects.shell.transition,
    '0s',
  );
  await context.close();
}

await browser.close();
console.log(
  failures === 0 ? '\nPASS: rail toggle' : `\nFAIL: ${failures} check(s)`,
);
process.exit(failures === 0 ? 0 : 1);
