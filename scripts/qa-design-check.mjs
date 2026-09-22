/* global window, document, getComputedStyle, localStorage */
/**
 * Design-scale and contrast check.
 *
 * The check that has caught the most real defects on this project, so it lives in the
 * repo rather than in a scratch file. It found: a token that shadowed a colour and
 * pushed 130 elements one size up; three hardcoded `color: white` rules measuring
 * 1.92:1 on the dark accent; and a 9px/10px regression that reading the CSS did not
 * reveal.
 *
 * Requires the dev server on :1420 (`npm run dev`).
 *
 *   node scripts/qa-design-check.mjs
 *
 * Exits non-zero if any page-theme combination shows an off-scale font size, a size
 * below the floor, a below-AA text node, or a request leaving the origin.
 */
import { chromium } from 'playwright-core';
import { installObservationFixture } from './qa-observation-fixture.mjs';
import { backend } from './qa-fixtures.mjs';

/** The seven steps. A size outside this set is off the scale. */
export const TYPE_SCALE = [11, 12, 13, 15, 18, 22, 28];
/** Nothing may render below this. See `--type-micro`. */
export const TYPE_FLOOR = 11;

const ROUTES = [
  'dashboard',
  'instances',
  'worlds',
  'timeline',
  'statistics',
  'observation',
  'settings',
];
const BASE = 'http://127.0.0.1:1420';

/** Runs inside the page. Kept as one function so it is serialised once, and takes a
 *  single object because `page.evaluate` passes exactly one argument. */
function auditPage({ scale, floor }) {
  const parse = (value) => {
    const match = String(value).match(
      /(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/,
    );
    return match ? [+match[1], +match[2], +match[3]] : null;
  };
  const luminance = ([r, g, b]) => {
    const channel = (x) => {
      x /= 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** Walk up for the first genuinely opaque background. */
  const background = (el) => {
    let node = el;
    while (node) {
      const colour = getComputedStyle(node).backgroundColor;
      if (
        colour &&
        !colour.includes('rgba(0, 0, 0, 0)') &&
        !/,\s*0\)$/.test(colour)
      ) {
        return colour;
      }
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };

  const offScale = new Set();
  const belowFloor = new Set();
  const failing = [];

  for (const el of document.querySelectorAll('*')) {
    if (!el.checkVisibility()) continue;
    const style = getComputedStyle(el);
    const size = Math.round(parseFloat(style.fontSize) * 10) / 10;
    if (!scale.includes(size)) offScale.add(size);
    if (size < floor) belowFloor.add(size);

    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (!ownText) continue;

    const fg = parse(style.color);
    const bg = background(el);
    const parsedBg = parse(bg);
    if (!fg || !parsedBg) continue;

    const weight = parseInt(style.fontWeight, 10) || 400;
    // WCAG AA: 3:1 counts as large at >=18.66px, or >=14px when bold.
    const large = size >= 18.66 || (size >= 14 && weight >= 700);
    const need = large ? 3 : 4.5;
    const value = ratio(fg, parsedBg);
    if (value < need) {
      failing.push({
        text: ownText.slice(0, 24),
        cls: (el.className || '').toString().slice(0, 30),
        ratio: value.toFixed(2),
        need,
        color: style.color,
        bg,
      });
    }
  }
  return {
    offScale: [...offScale].sort((a, b) => a - b),
    belowFloor: [...belowFloor].sort((a, b) => a - b),
    // De-duplicate by colour pair; one bad pairing shows up on many nodes.
    failing: failing.filter(
      (item, index, all) =>
        all.findIndex((o) => o.color === item.color && o.bg === item.bg) ===
        index,
    ),
    height: document.documentElement.scrollHeight,
  };
}

const browser = await chromium.launch();
const failures = [];
let combinations = 0;

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(installObservationFixture, backend);
  await context.addInitScript((value) => {
    localStorage.setItem('minechronicle.theme', value);
  }, theme);
  const page = await context.newPage();
  const remote = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      !url.startsWith(BASE) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
    ) {
      remote.push(url);
    }
  });

  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  for (const route of ROUTES) {
    await page.evaluate((r) => {
      window.location.hash = `#/${r}`;
    }, route);
    await page.waitForTimeout(650);
    // Open disclosures so hidden content is measured too. The filter drawer is left
    // closed because it covers the list underneath rather than adding to it.
    await page.evaluate(() => {
      document.querySelectorAll('details:not([open])').forEach((node) => {
        if (node.classList.contains('filter-drawer')) return;
        node.setAttribute('open', '');
      });
    });
    await page.waitForTimeout(200);

    combinations += 1;
    const result = await page.evaluate(auditPage, {
      scale: TYPE_SCALE,
      floor: TYPE_FLOOR,
    });
    const where = `${theme}/${route}`;
    if (result.offScale.length) {
      failures.push(
        `${where}: off-scale font sizes ${JSON.stringify(result.offScale)}`,
      );
    }
    if (result.belowFloor.length) {
      failures.push(
        `${where}: below the ${TYPE_FLOOR}px floor ${JSON.stringify(
          result.belowFloor,
        )}`,
      );
    }
    for (const item of result.failing) {
      failures.push(
        `${where}: ${item.ratio}:1 (need ${item.need}) "${item.text}" .${item.cls} ${item.color} on ${item.bg}`,
      );
    }
    console.log(
      `  ${where.padEnd(20)} h=${String(result.height).padStart(5)}  ` +
        `off-scale=${result.offScale.length}  below-floor=${result.belowFloor.length}  ` +
        `below-AA=${result.failing.length}`,
    );
  }

  if (remote.length) {
    failures.push(
      `${theme}: ${remote.length} request(s) left the origin: ${remote[0]}`,
    );
  }
  await context.close();
}

await browser.close();

console.log();
console.log(`page-theme combinations checked: ${combinations}`);
if (failures.length) {
  console.log(`FAIL: ${failures.length} issue(s)`);
  for (const line of failures) console.log(`  ${line}`);
  process.exit(1);
}
console.log(
  'PASS: no off-scale sizes, nothing below the floor, no below-AA text, no external requests',
);
