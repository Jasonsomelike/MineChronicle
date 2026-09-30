/**
 * One-off capture at 800x900: the 701-900px hero-padding breakpoint band has
 * no coverage in qa-visual-snapshot (1280 and 620 only), and the regression
 * that put the career-total figure 1px off the panel edge lived exactly there.
 * Requires `npm run dev`; writes output/ui-breakpoint-800/dashboard.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';

const base = 'http://127.0.0.1:1420';
const outDir = path.join('output', 'ui-breakpoint-800');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 800, height: 900 },
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
}, JSON.stringify(backend));

await page.goto(`${base}/#/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.career-total strong', { timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'dashboard.png') });
await browser.close();
console.log('wrote', path.join(outDir, 'dashboard.png'));
