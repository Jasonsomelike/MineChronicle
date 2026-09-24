/* global window, document, getComputedStyle, localStorage */
/**
 * Measure the three surfaces this batch touches, before and after.
 *
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-flourish-measure.mjs before|after
 *
 * Reports, per width (1175 = the user's window, 2048 = the old measuring width,
 * 620 = the small breakpoint) and per theme:
 *
 *   pagination  every arrow's box, fill, opacity, border and glyph, split into
 *               enabled and disabled, so "one control in two states" can be
 *               checked rather than eyeballed.
 *   worldRow    the mini bar's track and fill width per world, and the largest
 *               gap between the row's metadata and its duration.
 *   dashboard   the two hero cards' heights and the right card's dead space.
 *
 * Writes output/flourish/<phase>/<width>-<theme>.png
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
const PHASE = process.argv[2] === 'after' ? 'after' : 'before';
const WIDTHS = [1175, 2048, 620];
const THEMES = ['light', 'dark'];
const HEIGHT = 1000;

/**
 * 96 worlds with a real spread of play times. The shipped fixture has three
 * worlds, which cannot show whether the mini bar ranks anything; this one can.
 * Play times run from 1.4M ticks to 104M in a deliberately uneven curve so a
 * linear share and a capped share look different.
 */
function wideBackend() {
  const copy = structuredClone(backend);
  const root = copy.load_library.report.roots[0];
  const players = root.worlds[0].players;
  root.worlds = Array.from({ length: 96 }, (_, i) => {
    const ticks = String(
      Math.round(1_400_000 + 102_600_000 * Math.pow((95 - i) / 95, 2.4)),
    );
    return {
      path: `D:\\QA\\root\\saves\\World ${String(i + 1).padStart(2, '0')}`,
      name: `World ${String(i + 1).padStart(2, '0')}`,
      status: i === 2 ? 'Missing' : 'Present',
      data_version: 3465,
      minecraft_version: '1.21',
      players: [{ ...players[0], play_ticks: ticks }],
    };
  });
  return copy;
}

const TABLE = wideBackend();

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = {};

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
    }, JSON.stringify({ table: TABLE, theme }));
    await context.addInitScript(installObservationFixture, TABLE);
    const page = await context.newPage();
    // The dev server shares this machine with cargo/clippy runs; its first
    // request after a rebuild can take tens of seconds, and the 30s default
    // would read that as a breakage.
    page.setDefaultTimeout(120000);
    const key = `${width}-${theme}`;

    // ---- /worlds -----------------------------------------------------------
    await page.goto(`${BASE}/#/worlds`, { waitUntil: 'load' });
    await page.waitForSelector('.pagination button', { timeout: 30000 });
    // Vite HMR lags; a stale stylesheet would be measured as "the fix did nothing".
    await page.waitForTimeout(1500);

    const worlds = await page.evaluate(() => {
      const r2 = (n) => Math.round(n * 100) / 100;
      const arrows = [...document.querySelectorAll('.pagination button')].map(
        (b) => {
          const s = getComputedStyle(b);
          const g = document.createRange();
          g.selectNodeContents(b);
          const glyph = g.getBoundingClientRect();
          return {
            label: b.getAttribute('aria-label'),
            disabled: b.disabled,
            ...{
              w: r2(b.getBoundingClientRect().width),
              h: r2(b.getBoundingClientRect().height),
            },
            bg: s.backgroundColor,
            color: s.color,
            opacity: s.opacity,
            border: s.borderTopWidth + ' ' + s.borderTopStyle,
            borderColor: s.borderTopColor,
            borderRadius: s.borderRadius,
            cursor: s.cursor,
            fontSize: s.fontSize,
            glyphW: r2(glyph.width),
            glyphH: r2(glyph.height),
            glyphLeft: r2(glyph.left),
            boxLeft: r2(b.getBoundingClientRect().left),
          };
        },
      );
      const pageLabel = document.querySelector('.pagination > span');
      const rows = [...document.querySelectorAll('.world-result')].map((d) => {
        const bar = d.querySelector('.world-mini-bar');
        const fill = bar?.querySelector('i');
        const summary = d.querySelector('summary');
        const total = d.querySelector('.world-total');
        const name = summary.querySelector('strong');
        const inst = summary.querySelector('.world-instance');
        const mono = getComputedStyle(total);
        const barBox = bar?.getBoundingClientRect() ?? null;
        const fillBox = fill?.getBoundingClientRect() ?? null;
        // The dead middle: the right edge of the last metadata item to the left
        // edge of the duration that closes the row.
        const metaRight = inst
          ? inst.getBoundingClientRect().right
          : name.getBoundingClientRect().right;
        return {
          name: name.textContent,
          rowW: r2(d.getBoundingClientRect().width),
          barTrackW: barBox ? r2(barBox.width) : null,
          barTrackH: barBox ? r2(barBox.height) : null,
          barFillW: fillBox ? r2(fillBox.width) : null,
          barFillColor: fill ? getComputedStyle(fill).backgroundColor : null,
          barTrackColor: bar ? getComputedStyle(bar).backgroundColor : null,
          totalW: r2(total.getBoundingClientRect().width),
          totalFont: mono.fontFamily,
          deadMiddle: r2(total.getBoundingClientRect().left - metaRight),
        };
      });
      const fills = rows
        .map((r) => r.barFillW)
        .filter((n) => n !== null && n > 0);
      return {
        arrows,
        pageLabel: pageLabel?.textContent.trim() ?? null,
        paginationBox: (() => {
          const p = document.querySelector('.pagination');
          const r = p.getBoundingClientRect();
          return {
            w: r2(r.width),
            h: r2(r.height),
            left: r2(r.left),
            right: r2(r.right),
          };
        })(),
        contentColumnW: r2(
          document.querySelector('main').getBoundingClientRect().width,
        ),
        rowCount: rows.length,
        rows: rows.slice(0, 6),
        barTrackW: rows[0]?.barTrackW ?? null,
        barTrackH: rows[0]?.barTrackH ?? null,
        fillMin: fills.length ? Math.min(...fills) : null,
        fillMax: fills.length ? Math.max(...fills) : null,
        fillSpread: fills.length
          ? r2(Math.max(...fills) - Math.min(...fills))
          : null,
        deadMiddleMax: r2(
          Math.max(...rows.map((r) => r.deadMiddle).filter(Number.isFinite)),
        ),
        overflowX: r2(
          document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      };
    });

    await mkdir(`output/flourish/${PHASE}`, { recursive: true });
    await page.screenshot({
      path: `output/flourish/${PHASE}/${width}-${theme}-worlds.png`,
    });

    // ---- /dashboard --------------------------------------------------------
    await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'load' });
    await page.waitForSelector('.overview-grid', { timeout: 30000 });
    await page.waitForTimeout(1200);

    const dash = await page.evaluate(() => {
      const r2 = (n) => Math.round(n * 100) / 100;
      const grid = document.querySelector('.overview-grid');
      const cards = [...grid.children].map((c) => ({
        tag: c.className,
        ...(() => {
          const r = c.getBoundingClientRect();
          return { w: r2(r.width), h: r2(r.height), top: r2(r.top) };
        })(),
      }));
      const ruler = document.querySelector('.ruler');
      return {
        gridH: r2(grid.getBoundingClientRect().height),
        cards,
        rulerRows: document.querySelectorAll(
          '.ruler li, .ruler-row, .ruler button',
        ).length,
        rulerH: ruler ? r2(ruler.getBoundingClientRect().height) : null,
        pageH: r2(document.documentElement.scrollHeight),
      };
    });

    await page.screenshot({
      path: `output/flourish/${PHASE}/${width}-${theme}-dashboard.png`,
      fullPage: true,
    });

    // ---- whole-app disabled audit -----------------------------------------
    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    await page.waitForTimeout(1200);
    const disabledAudit = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button:disabled')) {
        const s = getComputedStyle(el);
        const on = el.cloneNode(true);
        on.removeAttribute('disabled');
        el.parentElement.appendChild(on);
        const ss = getComputedStyle(on);
        const same = {
          bg: ss.backgroundColor === s.backgroundColor,
          color: ss.color === s.color,
          border: ss.borderTopWidth === s.borderTopWidth,
          size:
            Math.abs(
              on.getBoundingClientRect().width -
                el.getBoundingClientRect().width,
            ) < 0.5,
        };
        on.remove();
        out.push({
          text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 16),
          cls: el.className,
          disabledOpacity: s.opacity,
          cursor: s.cursor,
          bgDisabled: s.backgroundColor,
          bgEnabledClone: ss.backgroundColor,
          stateDiffersBy: same,
        });
      }
      return out;
    });

    report[key] = { worlds, dash, disabledAudit };
    await context.close();
  }
}

await mkdir('output/flourish', { recursive: true });
await writeFile(
  `output/flourish/${PHASE}.json`,
  JSON.stringify(report, null, 1),
);
console.log(JSON.stringify(report['1175-light'], null, 1));
console.log('\n--- disabled audit (1175-light) ---');
console.log(JSON.stringify(report['1175-light'].disabledAudit, null, 1));
await browser.close();
