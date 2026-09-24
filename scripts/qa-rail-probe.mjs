/* global window, document, getComputedStyle, localStorage */
/**
 * Where is the rail toggle actually painted, and is it on top?
 *
 *   node scripts/qa-rail-probe.mjs [width] [collapsed|expanded|auto]
 */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
const WIDTH = Number(process.argv[2] ?? 2048);
const PREF = process.argv[3] ?? 'collapsed';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 1200 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
await context.addInitScript((payload) => {
  const { table, pref } = JSON.parse(payload);
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: async (command) => (command in table ? table[command] : null),
  };
  localStorage.setItem('minechronicle.theme', 'light');
  if (pref === 'auto') localStorage.removeItem('minechronicle.rail');
  else localStorage.setItem('minechronicle.rail', pref);
}, JSON.stringify({ table: backend, pref: PREF }));
await context.addInitScript(installObservationFixture, backend);
const page = await context.newPage();
await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
await page.waitForSelector('.rail-toggle', { timeout: 30000 });
await page.waitForTimeout(1500);

const out = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
      right: Math.round(b.right),
      bottom: Math.round(b.bottom),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      zIndex: cs.zIndex,
      position: cs.position,
      color: cs.color,
      background: cs.backgroundColor,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      clipPath: cs.clipPath,
    };
  };
  const rail = document.querySelector('.app-rail');
  const rcs = getComputedStyle(rail);
  // What is actually painted at the toggle's centre?
  const t = document.querySelector('.rail-toggle').getBoundingClientRect();
  const hit = document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2);
  return {
    rail: {
      w: Math.round(rail.getBoundingClientRect().width),
      h: Math.round(rail.getBoundingClientRect().height),
      top: Math.round(rail.getBoundingClientRect().top),
      position: rcs.position,
      overflow: rcs.overflow,
      paddingRight: rcs.paddingRight,
      zIndex: rcs.zIndex,
      transform: rcs.transform,
    },
    toggle: box('.rail-toggle'),
    wordmark: box('.wordmark'),
    nav: box('.app-nav'),
    tools: box('.header-tools'),
    elementAtToggleCentre: hit
      ? `${hit.tagName}.${hit.className || ''}`.slice(0, 80)
      : null,
    scrollY: window.scrollY,
    docScrollHeight: document.documentElement.scrollHeight,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
