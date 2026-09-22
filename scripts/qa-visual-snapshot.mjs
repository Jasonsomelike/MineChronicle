/**
 * Capture every page of the app for visual regression comparison.
 *
 * Uses the documented mock-IPC approach (real components, stubbed backend) so
 * no real archive is touched. Writes one PNG per page plus a manifest of the
 * SHA-256 of each, so two runs can be compared exactly rather than by eye.
 *
 * Requires `npm run dev` to be running; this script never starts a server.
 *
 *   node scripts/qa-visual-snapshot.mjs <output-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:1420';
const outDir = process.argv[2] ?? path.join('output', 'visual-baseline');

async function reachable() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(base, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await delay(2000);
  }
  return false;
}
if (!(await reachable())) {
  console.error(
    `开发服务器未就绪：请先运行 npm run dev，并确认 ${base} 可访问。`,
  );
  process.exit(2);
}

import { backend } from './qa-fixtures.mjs';

const pages = [
  ['dashboard', '#/dashboard'],
  ['instances', '#/instances'],
  ['worlds', '#/worlds'],
  ['timeline', '#/timeline'],
  ['statistics', '#/statistics'],
  ['observation', '#/observation'],
  ['settings', '#/settings'],
];

const viewports = [
  ['wide', { width: 1280, height: 900 }],
  ['narrow', { width: 620, height: 900 }],
];

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const manifest = {};

for (const [viewportName, viewport] of viewports) {
  // reducedMotion drives the CSS `@media (prefers-reduced-motion)` query, which
  // is what actually gates the motion layer. The matchMedia stub below only
  // affects JavaScript, so without this the app's card and stagger animations run
  // during capture and the last rows are still moving when the screenshot fires -
  // which made 10 of 14 pages differ between runs of identical CSS.
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.addInitScript((backendJson) => {
    const table = JSON.parse(backendJson);
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in table ? table[command] : null),
    };
    // Pin the clock so screenshots are deterministic. ReadStatus renders
    // "最近更新：<time>" from the moment a request settled, so two runs a second
    // apart produce different pixels on any page that shows it - measured: 10 of
    // 14 pages differed run to run for this reason alone, with no CSS change
    // between the runs. The counter still advances per call, so the text looks
    // live, but it starts from a fixed instant.
    let tick = 0;
    const fixed = new Date('2026-09-20T12:00:00').getTime();
    const RealDate = Date;
    class PinnedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed + tick++ * 1000);
        else super(...args);
      }
      static now() {
        return fixed;
      }
    }
    window.Date = PinnedDate;
    // Pin animation so screenshots are deterministic.
    window.matchMedia = (query) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    });
  }, JSON.stringify(backend));

  for (const [name, hash] of pages) {
    // Hash-only goto can race the SPA: the previous page stays mounted under
    // SessionPage and `aria-current` can lag, so a screenshot named for one page
    // captured another. Force the route, click the matching nav chip, then wait
    // until that chip is the current page before capturing.
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-nav button', { timeout: 30000 });
    await page.evaluate((h) => {
      if (window.location.hash !== h) {
        window.location.hash = h;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }, hash);
    const labels = {
      dashboard: '生涯概览',
      instances: '游戏实例',
      worlds: '世界与玩家',
      timeline: '时间线',
      statistics: '更多统计',
      observation: '实例观测',
      settings: '导入与设置',
    };
    const navButton = page
      .locator('.app-nav button')
      .filter({ hasText: labels[name] })
      .first();
    await navButton.click();
    await page.waitForFunction(
      (label) => {
        const current = document.querySelector(
          '.app-nav button[aria-current="page"]',
        );
        return !!current && (current.textContent || '').includes(label);
      },
      labels[name],
      { timeout: 10000 },
    );
    // Wait for the page to stop changing rather than for a fixed delay: the
    // settings page in particular keeps settling for longer than 2.5 s, and a
    // screenshot taken mid-settle differs between runs of identical CSS.
    await page.waitForLoadState('networkidle').catch(() => {});
    // Wait until the full document height stops changing. Watching only
    // `.scan-panel` was not enough: the settings page resolves several async IPC
    // calls (PCL status, tracking, runtime info) that can change the layout
    // after the panel itself has settled, which made that one page differ
    // between runs of identical CSS.
    await page
      .waitForFunction(
        () => {
          const height = document.documentElement.scrollHeight;
          const previous = window.__qaHeight;
          window.__qaHeight = height;
          return previous === height;
        },
        { timeout: 20000, polling: 500 },
      )
      .catch(() => {});
    await delay(1200);
    // Freeze animations before capturing. The theme layer animates page reveals
    // and the dashboard illustration, so a screenshot taken mid-animation
    // differs run to run and would mask (or fake) a real CSS regression.
    //
    // This runs early as well as late. Applying it only after the settle delay
    // left animations that had not finished yet - the staggered card entrance has
    // per-item delays, so the last rows were still moving when the first capture
    // fired, and 10 of 14 pages came out different run to run. Injecting the same
    // rule at document start means nothing ever begins animating.
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    await delay(400);
    const file = path.join(outDir, `${viewportName}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const bytes = fs.readFileSync(file);
    manifest[`${viewportName}-${name}`] = crypto
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    console.log(`${viewportName}/${name}: ${bytes.length} bytes`);
  }
  await context.close();
}

await browser.close();
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);
console.log(`\nwrote ${Object.keys(manifest).length} snapshots to ${outDir}`);
