/**
 * Re-measure brief §4.A: page height, card count, shadowed-card count, type sizes.
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-remeasure-baseline.mjs
 */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = 'http://127.0.0.1:1420';
const ROUTES = [
  'dashboard',
  'instances',
  'worlds',
  'timeline',
  'statistics',
  'observation',
  'settings',
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
await context.addInitScript((backendJson) => {
  const table = JSON.parse(backendJson);
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: async (command) => (command in table ? table[command] : null),
  };
}, JSON.stringify(backend));
await context.addInitScript(installObservationFixture, backend);
const page = await context.newPage();

const results = [];
for (const route of ROUTES) {
  await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  const row = await page.evaluate(() => {
    const typeSizes = new Set();
    for (const el of document.querySelectorAll('*')) {
      if (!el.checkVisibility()) continue;
      const size = Math.round(parseFloat(getComputedStyle(el).fontSize));
      if (!Number.isNaN(size)) typeSizes.add(size);
    }
    let cards = 0;
    let shadowed = 0;
    const sel =
      'section, article, .settings-card, .career-total, .tracking-state, .ranking, .metric-grid > *, .overview-grid > *';
    for (const el of document.querySelectorAll(sel)) {
      if (!el.checkVisibility()) continue;
      const s = getComputedStyle(el);
      const radius = parseFloat(s.borderTopLeftRadius) || 0;
      const border = parseFloat(s.borderTopWidth) || 0;
      const pad = parseFloat(s.paddingTop) || 0;
      const isCard =
        radius >= 8 &&
        border >= 1 &&
        pad >= 12 &&
        el.getBoundingClientRect().height > 60;
      if (!isCard) continue;
      cards += 1;
      const shadow = s.boxShadow;
      if (shadow && shadow !== 'none') {
        const layers = shadow.split(/,(?![^(]*\))/);
        const hasElevation = layers.some((layer) => {
          const t = layer.trim();
          return t && !t.startsWith('inset') && /\d/.test(t);
        });
        if (hasElevation) shadowed += 1;
      }
    }
    return {
      height: document.documentElement.scrollHeight,
      cards,
      shadowed,
      typeSizes: [...typeSizes].sort((a, b) => a - b),
    };
  });
  results.push({ route, ...row });
  console.log(JSON.stringify({ route, ...row }));
}

console.log('\n--- table ---');
console.log('| Route | Height | Cards | Shadowed | Type sizes |');
console.log('| --- | --- | --- | --- | --- |');
for (const r of results) {
  console.log(
    `| \`#/${r.route}\` | ${r.height}px | ${r.cards} | ${r.shadowed} | ${r.typeSizes.join(',')} |`,
  );
}

await browser.close();
