/* global window, document, getComputedStyle, localStorage */
/**
 * Measure the rail against the two complaints and the third one added later.
 *
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-rail-measure.mjs before|after [extraWidths]
 *
 * Reports, per width:
 *   - the rail's width and its share of the window (the number the user is reacting to)
 *   - the content column's width
 *   - the vertical gaps inside the rail: the void above the nav and the void above the
 *     residency labels. The complaint is "one gap, not two", so BOTH are reported and
 *     the pair is the acceptance figure.
 *   - the rail's content fill, i.e. how much of 100vh is actually occupied
 *
 * Writes output/rail/<phase>/<width>-<theme>[-collapsed].png
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
const PHASE = process.argv[2] === 'after' ? 'after' : 'before';
const WIDTHS = process.argv[3]
  ? process.argv[3].split(',').map(Number)
  : [2048, 1280, 1175, 620];
const THEMES = ['light', 'dark'];
const HEIGHT = 1200;
/** Vite HMR on this project has been measured lagging a stylesheet change by tens of
 *  seconds. One agent concluded a correct fix did nothing and reverted it; another found
 *  the dev server serving stale CSS for 40s. Waiting is cheaper than being wrong twice. */
const SETTLE_MS = Number(process.env.QA_SETTLE_MS ?? 8000);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

/** Both themes x both widths, expanded always; collapsed only where a toggle exists. */
async function shot({ width, theme, collapsed, tag }) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((payload) => {
    const {
      table,
      theme: wantTheme,
      collapsed: wantCollapsed,
    } = JSON.parse(payload);
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in table ? table[command] : null),
    };
    localStorage.setItem('minechronicle.theme', wantTheme);
    if (wantCollapsed !== null) {
      localStorage.setItem(
        'minechronicle.rail',
        wantCollapsed ? 'collapsed' : 'expanded',
      );
    }
  }, JSON.stringify({ table: backend, theme, collapsed }));
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-nav button', { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(250);

  const row = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
        bottom: Math.round(b.bottom),
      };
    };
    const railEl = document.querySelector('.app-rail');
    const railBox = railEl
      ? {
          ...r('.app-rail'),
          mode: railEl.offsetParent === null ? 'display-contents' : 'box',
          justify: getComputedStyle(railEl).justifyContent,
          overflowY: getComputedStyle(railEl).overflowY,
        }
      : null;
    const wordmark = r('.wordmark');
    const nav = r('.app-nav');
    const tools = r('.header-tools');
    const toggle = r('.rail-toggle');
    const main = r('.main-column');
    // Content fill: last rail child's bottom minus the rail's top, over the rail height.
    const fill =
      railBox && railBox.mode === 'box' && tools
        ? tools.bottom - railBox.y
        : null;
    const navCount = document.querySelectorAll('.app-nav button').length;
    const anyOverflow =
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
        ? document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        : 0;
    return {
      rail: railBox,
      wordmark,
      nav,
      tools,
      toggle,
      main,
      fill,
      navCount,
      overflow: anyOverflow,
      labelCount: document.querySelectorAll('.app-nav-label').length,
      visibleLabels: [...document.querySelectorAll('.app-nav-label')].filter(
        (el) => el.getBoundingClientRect().width > 0,
      ).length,
      collapsedAttr: document.documentElement.getAttribute('data-rail'),
      storedPref: window.localStorage.getItem('minechronicle.rail'),
      toggleTitle: document
        .querySelector('.rail-toggle')
        ?.getAttribute('title'),
      toggleExpanded: document
        .querySelector('.rail-toggle')
        ?.getAttribute('aria-expanded'),
    };
  });

  const w = row.rail ? row.rail.w : 0;
  const pct =
    row.rail && row.rail.mode === 'box'
      ? ((w / width) * 100).toFixed(1)
      : 'n/a';
  /* The acceptance figure. `gapTop` is brand -> nav and `gapBottom` is nav -> residency
     labels. The complaint is that these were equal at 404px each, i.e. two voids that
     read as a broken layout; one of them at 0 and the other taking the remainder reads as
     a single deliberate gap. */
  const gapTop =
    row.wordmark && row.nav && row.rail && row.rail.mode === 'box'
      ? row.nav.y - (row.wordmark.y + row.wordmark.h)
      : null;
  const gapBottom =
    row.nav && row.tools && row.rail && row.rail.mode === 'box'
      ? row.tools.y - (row.nav.y + row.nav.h)
      : null;
  const voidTotal =
    row.rail && row.rail.mode === 'box' && row.wordmark && row.tools
      ? row.tools.y - (row.wordmark.y + row.wordmark.h) - (row.nav.h ?? 0)
      : null;
  console.log(
    [
      `w=${String(width).padEnd(5)}`,
      theme.padEnd(5),
      tag.padEnd(10),
      `rail=${String(w).padStart(4)} (${String(pct).padStart(4)}%)`,
      `main=${String(row.main ? row.main.w : 0).padStart(4)}`,
      `gapBrandNav=${String(gapTop).padStart(4)}`,
      `gapNavFoot=${String(gapBottom).padStart(5)}`,
      `voids=${voidTotal === null ? '-' : voidTotal}`,
      `fill=${String(row.fill).padStart(4)}/${HEIGHT}`,
      `nav=${row.navCount}`,
      `labels=${row.visibleLabels}`,
      `toggle=${
        row.toggle
          ? `${row.toggle.w}x${row.toggle.h}@${row.toggle.x},${row.toggle.y}`
          : 'none'
      }`,
      `data-rail=${row.collapsedAttr ?? 'unset'}`,
      `pref=${row.storedPref ?? 'unset'}`,
      `title=${row.toggleTitle ?? '-'}`,
      `aria-expanded=${row.toggleExpanded ?? '-'}`,
      row.overflow ? `OVERFLOW=${row.overflow}` : '',
      `sheathX=${row.rail ? row.rail.x : '-'}`,
      `cropX=${row.rail ? row.rail.x - 22 : '-'}`,
    ]
      .filter(Boolean)
      .join(' '),
  );

  const dirOut = `output/rail/${PHASE}`;
  await mkdir(dirOut, { recursive: true });
  await page.screenshot({
    path: `${dirOut}/${width}-${theme}${
      tag === 'expanded' ? '' : `-${tag}`
    }.png`,
    fullPage: false,
  });
  await context.close();
  return row;
}

/* The collapsed pass runs FIRST on purpose, and there is a settle delay before the whole
   run. Vite's HMR lag is documented on this project: the first capture after an edit can
   still be the previous stylesheet, and taking the expanded pass first once left the
   `-collapsed` files a full run behind - the pictures showed the old toggle position and
   read as "the change did not work". */
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
for (const theme of THEMES) {
  for (const width of WIDTHS.filter((n) => n > 860)) {
    const row = await shot({ width, theme, collapsed: true, tag: 'collapsed' });
    if (row.collapsedAttr !== 'collapsed') {
      throw new Error(
        `width ${width}: the collapsed preference did not reach <html data-rail> (got ${row.collapsedAttr})`,
      );
    }
  }
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    await shot({ width, theme, collapsed: null, tag: 'expanded' });
  }
}

await browser.close();
