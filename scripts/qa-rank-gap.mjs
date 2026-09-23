/* global window, document, getComputedStyle, localStorage */
/**
 * Measure the world-ranking row: how far the name sits from the duration that
 * belongs to it, and how wide the proportional bar is against the row maximum.
 *
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-rank-gap.mjs before|after
 *
 * Reports, per width:
 *   - row width, and the x where the name button ends
 *   - the x where the duration chip starts, and the gap between them
 *   - the gap as a percentage of the row
 *   - every row's fill width, its percentage of the row maximum, and the
 *     maximum's own percentage (which must be 100)
 *
 * Writes output/rank-gap/<phase>/<width>-<theme>.png
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = 'http://127.0.0.1:1420';
const PHASE = process.argv[2] === 'after' ? 'after' : 'before';
const WIDTHS = [2048, 1280, 620];
const THEMES = ['light', 'dark'];
const HEIGHT = 1200;

const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    await context.addInitScript((payload) => {
      const { table, theme: wantTheme } = JSON.parse(payload);
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (cb) => cb,
        invoke: async (command) => (command in table ? table[command] : null),
      };
      localStorage.setItem('minechronicle.theme', wantTheme);
    }, JSON.stringify({ table: backend, theme }));
    await context.addInitScript(installObservationFixture, backend);

    const page = await context.newPage();
    await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ranking li .rank-duration', {
      timeout: 30000,
    });
    // Vite HMR lags; give injected styles time to land before believing a number.
    await page.waitForTimeout(1500);
    // The ranking list is below the fold at 2048x1200; scroll it into view so
    // the screenshot shows the thing being measured.
    await page.evaluate(() =>
      document.querySelector('.ranking')?.scrollIntoView({ block: 'center' }),
    );
    await page.waitForTimeout(300);

    const data = await page.evaluate(() => {
      const r2 = (n) => Math.round(n * 100) / 100;
      const rows = [...document.querySelectorAll('.ranking li')];
      const out = rows.map((li, index) => {
        const main = li.querySelector('.rank-row-main');
        const duration = li.querySelector('.rank-duration');
        const track = li.querySelector('.rank-track');
        const fill = li.querySelector('.rank-fill');
        const liBox = li.getBoundingClientRect();
        const mainBox = main.getBoundingClientRect();
        const durBox = duration.getBoundingClientRect();
        const trackBox = track?.getBoundingClientRect() ?? null;
        const fillBox = fill?.getBoundingClientRect() ?? null;
        const cs = getComputedStyle(li);
        // What the row actually says its value is.
        const label = duration.textContent.replace(/\s+/g, ' ').trim();
        return {
          index: index + 1,
          label,
          rowLeft: r2(liBox.left),
          rowWidth: r2(liBox.width),
          nameLeft: r2(mainBox.left),
          nameRight: r2(mainBox.right),
          durLeft: r2(durBox.left),
          durRight: r2(durBox.right),
          durWidth: r2(durBox.width),
          // The defect: name's right edge to its own value's left edge.
          gap: r2(durBox.left - mainBox.right),
          gapPctOfRow: r2(((durBox.left - mainBox.right) / liBox.width) * 100),
          trackLeft: trackBox ? r2(trackBox.left) : null,
          trackWidth: trackBox ? r2(trackBox.width) : null,
          fillWidth: fillBox ? r2(fillBox.width) : null,
          fillPctOfTrack: trackBox
            ? r2((fillBox.width / trackBox.width) * 100)
            : null,
          // A name longer than the row must be ellipsised rather than allowed to
          // push the value past the row's right edge.
          nameOverflow:
            main.scrollWidth > Math.ceil(main.clientWidth) + 1
              ? 'ellipsised'
              : 'fits',
          rowPastViewport: liBox.right > window.innerWidth,
          display: cs.display,
          rowHeight: r2(liBox.height),
        };
      });
      const ol = document.querySelector('.ranking ol');
      const panel = document.querySelector('.ranking');
      return {
        rows: out,
        panelCSSWidth: panel ? r2(panel.getBoundingClientRect().width) : null,
        olWidth: ol ? r2(ol.getBoundingClientRect().width) : null,
        panelPadding: panel
          ? {
              l: getComputedStyle(panel).paddingLeft,
              r: getComputedStyle(panel).paddingRight,
            }
          : null,
        overflowX: r2(
          document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    });

    await mkdir(`output/rank-gap/${PHASE}`, { recursive: true });
    await page.screenshot({
      path: `output/rank-gap/${PHASE}/${width}-${theme}.png`,
    });

    // Proportionality is only meaningful against the row maximum.
    const withFill = data.rows.filter((r) => r.fillWidth !== null);
    const maxFill = Math.max(...withFill.map((r) => r.fillPctOfTrack), 0);
    console.log(
      JSON.stringify(
        {
          phase: PHASE,
          width,
          theme,
          viewport: data.viewport,
          panelCSSWidth: data.panelCSSWidth,
          olWidth: data.olWidth,
          panelPadding: data.panelPadding,
          overflowX: data.overflowX,
          trackedRows: withFill.length,
          maxRowFillPct: maxFill,
          largestRowGap: data.rows[0]?.gap ?? null,
          smallestRowGap: data.rows.at(-1)?.gap ?? null,
          rows: data.rows,
        },
        null,
        1,
      ),
    );
    await context.close();
  }
}

await browser.close();
