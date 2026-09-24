/* global window, document, getComputedStyle, localStorage */
/**
 * Where does the settings page's two-column layout actually die?
 *
 * `styles.css: .settings-layout { columns: 2 640px }`. The handoff says the compact rail's
 * 1100px breakpoint was chosen because "the settings page is a two-column layout from
 * 1400px down to 1332px, and below that a labelled rail would start eating the width the
 * two columns need". Before moving that breakpoint, check whether the claim holds: the
 * rail has already taken 192px out of the window, so the content column is a different
 * number from the window width.
 *
 *   node scripts/qa-settings-columns.mjs
 */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
const WIDTHS = [2048, 1600, 1563, 1440, 1400, 1332, 1280, 1175, 1100];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 1200 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((payload) => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in payload ? payload[command] : null),
    };
    localStorage.setItem('minechronicle.theme', 'light');
  }, JSON.stringify(backend));
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.settings-layout', { timeout: 30000 });
  await page.waitForTimeout(1200);

  const row = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), w: Math.round(b.width) };
    };
    const layout = document.querySelector('.settings-layout');
    const cards = [...document.querySelectorAll('.settings-section')].map(
      (el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), w: Math.round(b.width) };
      },
    );
    const distinctLeftEdges = [...new Set(cards.map((c) => c.x))].sort(
      (a, b) => a - b,
    );
    return {
      shellW: Math.round(
        document.querySelector('.app-shell').getBoundingClientRect().width,
      ),
      railW: Math.round(
        document.querySelector('.app-rail').getBoundingClientRect().width,
      ),
      mainW: Math.round(
        document.querySelector('.main-column').getBoundingClientRect().width,
      ),
      layoutW: layout ? Math.round(layout.getBoundingClientRect().width) : null,
      columnCount: layout ? getComputedStyle(layout).columnCount : null,
      distinctLeftEdges,
      columns: distinctLeftEdges.length,
      sectionW: cards.length ? Math.round(cards[0].w) : null,
      layoutRect: rect('.settings-layout'),
    };
  });

  console.log(
    [
      `w=${String(width).padEnd(5)}`,
      `rail=${String(row.railW).padStart(4)}`,
      `main=${String(row.mainW).padStart(4)}`,
      `layout=${String(row.layoutW).padStart(4)}`,
      `columnCount=${String(row.columnCount).padEnd(5)}`,
      `renderedColumns=${row.columns}`,
      `sectionW=${String(row.sectionW).padStart(4)}`,
      `leftEdges=${row.distinctLeftEdges.join('/')}`,
    ].join(' '),
  );
  await context.close();
}

await browser.close();
