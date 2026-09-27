/* global window, document, localStorage, getComputedStyle */
/**
 * Measure the rail's two shapes against the content column.
 *
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-rail-measure.mjs before|after [extraWidths]
 *
 * The hover model has no collapsed/expanded preference any more, so the two passes are:
 *   compact  the resting shape - the 72px icon rail that is also the grid's first column
 *   open     the hover-expanded overlay - page.hover('.app-rail'), 192px, position fixed
 *
 * Reports, per width and pass:
 *   - the rail's width and, when open, how far it covers the content's left edge
 *   - the content column's width and x, and the x displacement between the two passes
 *     (the hover model's headline number: zero)
 *   - the visible label count in each pass
 *
 * Writes output/rail/<phase>/<width>-<theme>.png and .-open.png
 * (the 620px strip tier has no open pass - the rail is display:contents there and
 * cannot be hovered).
 */
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
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
/** 100ms intent + 180ms transition + margin. */
const OPEN_WAIT_MS = 600;

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

/** Both themes x both widths; the open pass only where a rail box exists. */
async function shot({ width, theme, open }) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((table) => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in table ? table[command] : null),
    };
    localStorage.setItem('minechronicle.theme', theme);
  }, backend);
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-nav button', { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(250);

  const tag = open ? 'open' : 'compact';
  if (open) {
    await page.hover('.app-rail');
    await page.waitForTimeout(OPEN_WAIT_MS);
  }

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
      };
    };
    const railEl = document.querySelector('.app-rail');
    const rail = railEl
      ? {
          ...r('.app-rail'),
          mode: railEl.offsetParent === null ? 'display-contents' : 'box',
          position: getComputedStyle(railEl).position,
          zIndex: getComputedStyle(railEl).zIndex,
        }
      : null;
    return {
      rail,
      main: r('.main-column'),
      navCount: document.querySelectorAll('.app-nav button').length,
      anyOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
          ? document.documentElement.scrollWidth -
            document.documentElement.clientWidth
          : 0,
      visibleLabels: [...document.querySelectorAll('.app-nav-label')].filter(
        (el) => el.getBoundingClientRect().width > 0,
      ).length,
      storedPref: window.localStorage.getItem('minechronicle.rail'),
    };
  });

  const w = row.rail ? row.rail.w : 0;
  const pct =
    row.rail && row.rail.mode === 'box'
      ? ((w / width) * 100).toFixed(1)
      : 'n/a';
  console.log(
    [
      `w=${String(width).padEnd(5)}`,
      theme.padEnd(5),
      tag.padEnd(8),
      `rail=${String(w).padStart(4)} (${String(pct).padStart(4)}%)`,
      `pos=${row.rail ? row.rail.position : '-'}`,
      `z=${row.rail ? row.rail.zIndex : '-'}`,
      `main=${String(row.main ? row.main.w : 0).padStart(4)}`,
      `mainX=${String(row.main ? row.main.x : 0).padStart(4)}`,
      `nav=${row.navCount}`,
      `labels=${row.visibleLabels}`,
      row.overflow ? `OVERFLOW=${row.overflow}` : '',
      row.storedPref !== null ? `PREF=${row.storedPref}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  const dirOut = `output/rail/${PHASE}`;
  await mkdir(dirOut, { recursive: true });
  await page.screenshot({
    path: `${dirOut}/${width}-${theme}${open ? '-open' : ''}.png`,
    fullPage: false,
  });
  await context.close();
  return row;
}

/* The compact pass runs FIRST, and there is a settle delay before the whole run. Vite's
   HMR lag is documented on this project: the first capture after an edit can still be
   the previous stylesheet, and reading the compact pass off a stale sheet once made the
   whole run's numbers look like the change had not landed. */
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    await shot({ width, theme, open: false });
  }
}

for (const theme of THEMES) {
  // The strip tier has no rail box to hover; its labels are permanently visible.
  for (const width of WIDTHS.filter((n) => n > 860)) {
    await shot({ width, theme, open: true });
  }
}

await browser.close();
