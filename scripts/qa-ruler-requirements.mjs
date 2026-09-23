/** §9.5 ruler requirements. Requires dev server. */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = 'http://127.0.0.1:1420';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
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
await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const data = await page.evaluate(() => {
  const fills = [...document.querySelectorAll('.ruler-fill')].map((el) => ({
    width: el.style.width,
    animationName: getComputedStyle(el).animationName,
  }));
  const buttons = [...document.querySelectorAll('.ruler-name')].map((el) => ({
    tag: el.tagName,
    text: el.textContent?.trim(),
  }));
  const scale = [...document.querySelectorAll('.ruler-scale span')].map(
    (el) => el.textContent?.trim(),
  );
  return { fills, buttons, scale };
});

// Tab reachability
await page.keyboard.press('Tab');
const seen = [];
for (let i = 0; i < 40; i += 1) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName,
      cls: el?.className,
      text: el?.textContent?.trim().slice(0, 20),
    };
  });
  seen.push(info);
  if (info.cls?.includes?.('ruler-name')) break;
  await page.keyboard.press('Tab');
}

const tabHitRuler = seen.some((s) => String(s.cls).includes('ruler-name'));
const animNone = data.fills.every((f) => f.animationName === 'none');
const rowsAreButtons = data.buttons.every((b) => b.tag === 'BUTTON');
const fillWidths = data.fills.map((f) => f.width);

console.log(
  JSON.stringify(
    {
      rows: data.buttons.length,
      maxVisibleWanted: 7,
      scale: data.scale,
      fillWidths,
      rowsAreButtons,
      animationNameNone: animNone,
      tabHitRuler,
      tabStopsSampled: seen.length,
    },
    null,
    2,
  ),
);

const pass = rowsAreButtons && animNone && tabHitRuler && data.buttons.length > 0;
console.log(pass ? 'PASS: ruler requirements' : 'FAIL: ruler requirements');
await browser.close();
process.exit(pass ? 0 : 1);
