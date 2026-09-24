/* global window, document, getComputedStyle, localStorage */
/**
 * Measure exactly how much width the rail's labelled state actually needs, instead of
 * guessing a narrower --sidebar-w. Reports per nav item: icon, label text width, the
 * button's own min-content contribution, and the wordmark's.
 *
 *   node scripts/qa-rail-intrinsics.mjs [width]
 */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
const WIDTH = Number(process.argv[2] ?? 2048);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 1200 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
await context.addInitScript((payload) => {
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: async (command) => (command in payload ? payload[command] : null),
  };
  localStorage.setItem('minechronicle.theme', 'light');
}, JSON.stringify(backend));
await context.addInitScript(installObservationFixture, backend);
const page = await context.newPage();
await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
await page.waitForSelector('.app-nav button', { timeout: 30000 });
await page.waitForTimeout(900);

const out = await page.evaluate(() => {
  const rail = document.querySelector('.app-rail');
  const nav = document.querySelector('.app-nav');
  const rs = getComputedStyle(rail);
  const ns = getComputedStyle(nav);
  const cs = getComputedStyle(document.querySelector('.app-nav button'));
  const btn = document.querySelector('.app-nav button');

  // The tool the browser itself uses: ask for the nav's min-content width.
  const clone = nav.cloneNode(true);
  clone.style.cssText =
    'position:absolute;left:-9999px;top:0;width:min-content;visibility:hidden';
  document.body.appendChild(clone);
  const navMinContent = clone.getBoundingClientRect().width;
  clone.remove();

  const items = [...document.querySelectorAll('.app-nav button')].map((b) => {
    const label = b.querySelector('.app-nav-label');
    const icon = b.querySelector('svg');
    const range = document.createRange();
    if (label) range.selectNodeContents(label);
    return {
      text: label ? label.textContent : '',
      labelW: Math.round(label ? label.getBoundingClientRect().width : 0),
      textW: Math.round(label ? range.getBoundingClientRect().width : 0),
      iconW: Math.round(icon ? icon.getBoundingClientRect().width : 0),
      btnContentW: Math.round(
        [...b.children].reduce(
          (sum, c) => sum + c.getBoundingClientRect().width,
          0,
        ),
      ),
      btnW: Math.round(b.getBoundingClientRect().width),
      btnH: Math.round(b.getBoundingClientRect().height),
    };
  });

  const wordmark = document.querySelector('.wordmark');
  const wl = document.querySelector('.wordmark-label');
  const wrange = document.createRange();
  if (wl) wrange.selectNodeContents(wl);

  return {
    railW: Math.round(rail.getBoundingClientRect().width),
    railPaddingRight: rs.paddingRight,
    railBorderRight: rs.borderRightWidth,
    railContentW: Math.round(
      rail.getBoundingClientRect().width -
        parseFloat(rs.paddingRight) -
        parseFloat(rs.borderRightWidth),
    ),
    navMinContent: Math.round(navMinContent),
    btnHeight: Math.round(btn.getBoundingClientRect().height),
    btnPaddingX: `${cs.paddingLeft} / ${cs.paddingRight}`,
    btnGap: cs.gap,
    labelFontSize: getComputedStyle(document.querySelector('.app-nav-label'))
      .fontSize,
    items,
    wordmarkW: Math.round(wordmark.getBoundingClientRect().width),
    wordmarkLabelTextW: wl
      ? Math.round(wrange.getBoundingClientRect().width)
      : 0,
    wordmarkFontSize: wl ? getComputedStyle(wl).fontSize : '',
    brandMarkW: Math.round(
      document.querySelector('.brand-mark').getBoundingClientRect().width,
    ),
    navGap: ns.rowGap,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
