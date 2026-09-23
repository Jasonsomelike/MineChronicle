/* global window, document, getComputedStyle, localStorage */
/**
 * Measure the shell's top-chrome budget, prove the sticky contract, and capture proof
 * screenshots.
 *
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-chrome-measure.mjs before|after
 *
 * Reports, per width and theme:
 *   - the height of every top band and the y where real page content starts
 *   - the top chrome the window actually pays for, measured twice: with the document at
 *     scrollTop 0, and with it scrolled, because the bands are sticky and a scrolled
 *     reading is the one that says how much of the window they hold permanently
 *   - overlap between the sticky bands, which must be <= 0
 *   - the sidebar's width and the content column's width
 *
 * Writes output/chrome/<phase>/<width>-<theme>.png
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

/* Overridable so the same script can be pointed at a worktree server of an older commit,
   which is how the before/after pair in the report was produced from one tool rather than
   two that might have drifted. */
const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
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
    await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.app-nav button', { timeout: 30000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(250);

    const row = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          sel,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          position: s.position,
        };
      };
      const bands = [
        box('.wordmark'),
        box('.app-nav'),
        box('.app-header'),
        box('.settings-jump'),
      ].filter(Boolean);

      // Real content: the first thing inside the content column that is not a status
      // strip or a nav. Read at scrollTop 0, so `y` is the viewport offset a reader pays
      // once, and the document offset before anything moves.
      const contentColumn =
        document.querySelector('.main-column') ??
        document.querySelector('main');
      const firstContent = contentColumn?.querySelector(
        '.settings-layout, h1, .dashboard-heading, .library-heading',
      );
      const contentRect = firstContent?.getBoundingClientRect();

      // Overlap between the sticky bands, in document order, as they stack at scroll 0.
      const sticky = bands.filter((b) => b.position === 'sticky');
      const overlaps = [];
      for (let i = 0; i < sticky.length - 1; i += 1) {
        overlaps.push({
          pair: `${sticky[i].sel} -> ${sticky[i + 1].sel}`,
          overlap: sticky[i].y + sticky[i].h - sticky[i + 1].y,
        });
      }

      const rail = document.querySelector('.app-rail');
      const main =
        document.querySelector('.main-column') ??
        document.querySelector('main');

      /* Where the page's own content begins. `.status-center` is the anchor for the
         before/after comparison rather than `main`, because in the horizontal-bar layout
         the primary nav lived INSIDE `main`: measuring `main.top` there reports 72px and
         silently omits the 55px of nav below it. The status strip is the first page-level
         element in both layouts, so its offset is the one number the two can share. */
      const status = box('.status-center');
      const statusTop = status ? status.y : null;

      /* The bands that sit ACROSS the top of the content column, which is what the
         report is about. The primary nav only counts when it is above the content
         (the horizontal-bar layout); in the rail it is beside the content, so its
         height is not chrome the vertical budget pays for. */
      const header = box('.app-header');
      const nav = box('.app-nav');
      const navIsAboveContent =
        nav !== null && statusTop !== null && nav.y + nav.h <= statusTop;
      const topChromeBands =
        (header ? header.h : 0) + (navIsAboveContent ? nav.h : 0);

      return {
        bands,
        overlaps,
        statusTop,
        navIsAboveContent,
        topChromeBands,
        contentTop: contentRect ? Math.round(contentRect.top) : null,
        firstBandAtZero: bands.find((b) => Math.abs(b.y) < 1)?.sel ?? null,
        /* The rail's own box, which is the width the layout trades away. Below 860px the
           rail is `display: contents` and has no box, so this reports 0 and `stacked`
           says the tier is the strip one. */
        railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
        stacked: !!rail && getComputedStyle(rail).display === 'contents',
        mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
        mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        logoAtTop: box('.wordmark')?.y ?? null,
        labelsAtFootOfRail: box('.header-tools')?.y ?? null,
      };
    });

    // The sticky reading: how much of the window the chrome holds once scrolled, which
    // is the number that matters if anything is pinned.
    await page.evaluate(() =>
      window.scrollTo({ top: 400, behavior: 'instant' }),
    );
    await page.waitForTimeout(250);
    const sticky = await page.evaluate(() => {
      const stuck = [];
      for (const sel of [
        '.wordmark',
        '.app-nav',
        '.app-header',
        '.settings-jump',
      ]) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const s = getComputedStyle(el);
        if (s.position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        stuck.push({ sel, y: Math.round(r.y), h: Math.round(r.height) });
      }
      const occupied = stuck.reduce(
        (sum, item) => Math.max(sum, item.y + item.h),
        0,
      );
      return { stuck, occupiedFromTop: Math.round(occupied) };
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(200);

    const topChromeAtRest = row.bands
      .filter((b) => b.position === 'sticky' || b.sel === '.app-header')
      .reduce((sum, b) => sum + b.h, 0);

    await mkdir(`output/chrome/${PHASE}`, { recursive: true });
    await page.screenshot({
      path: `output/chrome/${PHASE}/${width}-${theme}.png`,
    });

    console.log(
      JSON.stringify({
        phase: PHASE,
        width,
        theme,
        /* The headline pair. `topChromeBands` is the app chrome stacked across the top of
           the content column, which is the 149px in the report (this counts the header
           and the horizontal nav; the settings section nav is page-scoped and is counted
           separately as `pinnedChromeHeight`). `pageContentTop` is where the page's own
           content actually begins, and is the one number both layouts can share. */
        topChromeBands: row.topChromeBands,
        topChromeBandsPct: `${((row.topChromeBands / HEIGHT) * 100).toFixed(
          1,
        )}%`,
        navIsAboveContent: row.navIsAboveContent,
        pageContentTop: row.statusTop,
        pageContentTopPct: `${(((row.statusTop ?? 0) / HEIGHT) * 100).toFixed(
          1,
        )}%`,
        pinnedChromeHeight: topChromeAtRest,
        restBelowBands: row.contentTop,
        railWidth: row.railWidth,
        mainWidth: row.mainWidth,
        firstBandAtZero: row.firstBandAtZero,
        overlaps: row.overlaps,
        stuckWhenScrolled: sticky,
        overflow: row.scrollWidth - row.clientWidth,
        scrollHeight: row.scrollHeight,
      }),
    );
    await context.close();
  }
}

await browser.close();
