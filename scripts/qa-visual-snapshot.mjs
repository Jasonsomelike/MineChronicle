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
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript((backendJson) => {
    const table = JSON.parse(backendJson);
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in table ? table[command] : null),
    };
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
    await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-nav button', { timeout: 30000 });
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
