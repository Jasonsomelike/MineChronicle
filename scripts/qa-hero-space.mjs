/* global window, document, getComputedStyle */
/** Measure dashboard hero dead space. Requires dev server. */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = 'http://127.0.0.1:1420';
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
await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const m = await page.evaluate(() => {
  const card = document.querySelector('.career-total');
  const copy = document.querySelector('.career-copy');
  const ruler = document.querySelector('.playtime-ruler');
  const side = document.querySelector('.tracking-state');
  const grid = document.querySelector('.overview-grid');
  const rows = document.querySelectorAll('.ruler-name');
  const r = (el) =>
    el
      ? {
          h: Math.round(el.getBoundingClientRect().height),
          w: Math.round(el.getBoundingClientRect().width),
        }
      : null;
  const copyBottom = copy ? copy.getBoundingClientRect().bottom : 0;
  const cardBottom = card ? card.getBoundingClientRect().bottom : 0;
  const padBottom = card ? parseFloat(getComputedStyle(card).paddingBottom) : 0;
  const dead = Math.max(0, Math.round(cardBottom - padBottom - copyBottom));
  return {
    card: r(card),
    copy: r(copy),
    ruler: r(ruler),
    side: r(side),
    grid: r(grid),
    rows: rows.length,
    dead,
    pageH: document.documentElement.scrollHeight,
    align: grid ? getComputedStyle(grid).alignItems : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
