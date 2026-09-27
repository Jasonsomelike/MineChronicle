/* global window, document, getComputedStyle, localStorage, HTMLElement */
/**
 * Design-scale and contrast check.
 *
 * The check that has caught the most real defects on this project, so it lives in the
 * repo rather than in a scratch file. It found: a token that shadowed a colour and
 * pushed 130 elements one size up; three hardcoded `color: white` rules measuring
 * 1.92:1 on the dark accent; and a 9px/10px regression that reading the CSS did not
 * reveal.
 *
 * Two sampling gaps were closed after this check passed a Missing row whose text
 * measured 4.17:1 and an input measuring 1.205:1:
 *
 *   - `opacity` on an ancestor fades the text under it too, so the ratio is computed
 *     on the composited colour rather than on the raw `color`.
 *   - a field carries no text node, so the whole `<input>` was previously unsampled.
 *     Empty fields are measured on their placeholder colour instead.
 *
 * The whitelist pass at the bottom of this file is the second half of the contract the
 * scale is written against: colour and spacing are defined in `tokens.css` / `warmth.css`
 * and nowhere else. It reads the five component sheets statically - including `warmth.css`,
 * whose component rules count even though its `:root` palettes do not - because the pages
 * above only measure what happens to be rendered, and a literal colour in a rule no page
 * reaches was exactly what the dark-mode input (`background: white`) was before it was
 * rendered. It works on declarations rather than lines, so a colour named in a comment or a
 * hex-shaped id selector is not reported, and it recognises `rgb()`/`hsl()`/named colours
 * as well as hex.
 *
 * Requires the dev server on :1420 (`npm run dev`).
 *
 *   node scripts/qa-design-check.mjs
 *
 * Exits non-zero if any page-theme combination shows an off-scale font size, a size
 * below the floor, a below-AA text node or a request leaving the origin, if a component
 * sheet carries a literal colour or one of the named off-grid spacing values, or if the
 * number of off-grid spacing declarations grows past `OFF_GRID_SPACING_BUDGET`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { installObservationFixture } from './qa-observation-fixture.mjs';
import { backend } from './qa-fixtures.mjs';

/** The five steps. A size outside this set is off the scale. */
export const TYPE_SCALE = [12, 14, 16, 20, 28];
/** Nothing may render below this. See `--type-caption`. */
export const TYPE_FLOOR = 12;

/**
 * The component layer. `tokens.css` holds the scales, and `warmth.css` holds the palette -
 * but `warmth.css` also carries component rules (the theme selector, the dark tints), so it
 * is scanned as well, with its `:root` blocks blanked out. Those blocks are where a colour is
 * *defined*; anywhere else in that file it is a literal like any other, which is exactly how
 * the light half of one surface ended up written out while its dark half was a token.
 */
const COMPONENT_SHEETS = [
  'src/styles.css',
  'src/styles/pages.css',
  'src/styles/shell.css',
  'src/motion.css',
  'src/warmth.css',
];

/* Declarations, not lines. Scanning raw text counted two things that are not literals: a
   colour quoted in a comment (documentation) and a hex-shaped id selector such as
   `#fade { … }` (a name). Both are excluded by reading `property: value` pairs only. */
const DECLARATION =
  /(?:^|[\s;{}])(--[-a-zA-Z0-9]+|[-a-zA-Z]+)\s*:\s*([^;{}]*)/g;

/* Properties that take a colour. Custom properties are in the list on purpose: a token
   defined in a component sheet is a literal with a nicer name. */
const COLOUR_PROP =
  /^(?:--.+|color|background|background-color|accent-color|caret-color|fill|stroke|outline|outline-color|box-shadow|text-shadow|text-decoration-color|column-rule|column-rule-color|border|border-color|border-(?:top|right|bottom|left)|border-(?:top|right|bottom|left)-color)$/;

/* A colour written out rather than referenced. `var(...)` is how a token is used, and
   `transparent` / `currentColor` / `inherit` / `none` are not colours of their own, so they
   are not in this pattern. */
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}(?![-\w])|\brgba?\(|\bhsla?\(|\boklch\(|\blab\(|\blch\(|\b(?:white|black|silver|gray|grey|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|orange|pink|brown|gold|beige|ivory|khaki|indigo|violet|plum|orchid|crimson|tomato|salmon|coral|azure|tan|linen|snow)(?![-\w])/i;

/** The spacing properties the 4px grid applies to. */
const SPACING_PROP =
  /^(?:padding|margin|gap|row-gap|column-gap|scroll-margin)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/;

/* The value classes the review named, which must be gone outright: `padding`/`gap` of 14,
   15 or 17px, and `padding`/`margin` of 22px. */
const NAMED_OFF_GRID = new Set(['14', '15', '17']);

/* The rest of the grid is a budget rather than a zero, and the wider reading of the
   checklist is right that it should be zero: these sheets still carry this many spacing
   declarations with an off-grid value, mostly icon-to-label gaps (`gap: 10px` and
   `gap: 6px` are over half of it) that no batch has swept yet. The number is pinned rather
   than ignored: it may only go down, it is printed on every run, and a new off-grid value
   in a new declaration fails immediately. Measured 2026-09-24, after this batch moved the
   14/15/17/22px values it found. */
export const OFF_GRID_SPACING_BUDGET = 156;

/** Comment bodies out, line structure kept, so a finding can still be reported by line. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
}

/**
 * Blank out a sheet's palette blocks. Colours are defined in `:root` and
 * `:root[data-theme=…]`; a rule anywhere else in the sheet is a component rule and has to
 * reference a token. Selectors that merely start with `:root[` (shell.css's
 * `.app-rail.is-open` overlay, a component-scoped interaction state) are component rules
 * and are left in place.
 */
function blankPaletteBlocks(text) {
  const chars = [...text];
  const isPalette = (selector) => /^\s*:root(\[[^\]]*\])?\s*$/.test(selector);
  let depth = 0;
  let selectorStart = 0;
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (char === '{') {
      if (
        depth === 0 &&
        isPalette(chars.slice(selectorStart, index).join(''))
      ) {
        chars[index] = ' ';
        let level = 1;
        let end = index + 1;
        while (end < chars.length && level > 0) {
          if (chars[end] === '{') level += 1;
          else if (chars[end] === '}') level -= 1;
          if (chars[end] !== '\n') chars[end] = ' ';
          end += 1;
        }
        index = end;
        selectorStart = end;
        continue;
      }
      depth += 1;
      selectorStart = index + 1;
    } else if (char === '}') {
      depth -= 1;
      selectorStart = index + 1;
    } else if (char === ';' && depth === 0) {
      selectorStart = index + 1;
    }
    index += 1;
  }
  return chars.join('');
}

/**
 * Static pass over the component sheets. Returns the findings, and the number of off-grid
 * spacing declarations it saw, so the budget above can be reported and enforced.
 */
function auditStylesheets() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = [];
  let offGrid = 0;
  for (const sheet of COMPONENT_SHEETS) {
    const text = blankPaletteBlocks(
      stripComments(readFileSync(join(root, sheet), 'utf8')),
    );
    const lineAt = (index) => text.slice(0, index).split('\n').length;
    for (const match of text.matchAll(DECLARATION)) {
      const [, property, value] = match;
      const where = `${sheet}:${lineAt(match.index)}`;
      if (COLOUR_PROP.test(property) && !value.includes('var(')) {
        const literal = value.match(COLOUR_LITERAL);
        if (literal) {
          findings.push(`${where}: literal colour "${literal[0]}"`);
        }
      }
      if (SPACING_PROP.test(property)) {
        const values = value.match(/-?\d+(?:\.\d+)?px/g) ?? [];
        const off = values.filter((v) => Number.parseFloat(v) % 4 !== 0);
        if (!off.length) continue;
        offGrid += 1;
        const base =
          property.startsWith('gap') || property.endsWith('gap')
            ? 'gap'
            : property.split('-')[0];
        const named = off.filter((v) => {
          const size = String(Number.parseFloat(v));
          if (size === '22') return base === 'padding' || base === 'margin';
          return (
            NAMED_OFF_GRID.has(size) && (base === 'padding' || base === 'gap')
          );
        });
        if (named.length) {
          findings.push(`${where}: off-grid ${property} ${named.join(', ')}`);
        }
      }
    }
  }
  return { findings, offGrid };
}

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
  /** Alpha of a computed rgb()/rgba() colour. */
  const colourAlpha = (colour) => {
    const parts = String(colour)
      .match(/^rgba?\(([^)]+)\)$/)?.[1]
      .split(/,|\//);
    return parts && parts.length > 3 ? Number(parts[3]) : 1;
  };
  /* `opacity` fades a whole subtree, so the text under a 55% row is 55% text. The
     product runs to the root because nested elements multiply. Ignoring this is how
     the Missing row measured 4.17:1 while the check reported it clean. */
  const opacity = new Map();
  const treeAlpha = (el) => {
    if (opacity.has(el)) return opacity.get(el);
    const own = Number.parseFloat(getComputedStyle(el).opacity);
    const value =
      (Number.isNaN(own) ? 1 : own) *
      (el.parentElement ? treeAlpha(el.parentElement) : 1);
    opacity.set(el, value);
    return value;
  };
  const composite = (fg, bg, alpha) =>
    alpha >= 1
      ? fg
      : [
          fg[0] * alpha + bg[0] * (1 - alpha),
          fg[1] * alpha + bg[1] * (1 - alpha),
          fg[2] * alpha + bg[2] * (1 - alpha),
        ];

  const offScale = new Set();
  const belowFloor = new Set();
  const failing = [];

  /** One text measurement. `text` only labels the finding in the report. */
  const measure = (el, colour, bg, text) => {
    const fg = parse(colour);
    const parsedBg = parse(bg);
    if (!fg || !parsedBg) return;
    const style = getComputedStyle(el);
    const size = Math.round(parseFloat(style.fontSize) * 10) / 10;
    const weight = parseInt(style.fontWeight, 10) || 400;
    // WCAG AA: 3:1 counts as large at >=18.66px, or >=14px when bold.
    const large = size >= 18.66 || (size >= 14 && weight >= 700);
    const need = large ? 3 : 4.5;
    const value = ratio(
      composite(fg, parsedBg, treeAlpha(el) * colourAlpha(colour)),
      parsedBg,
    );
    if (value < need) {
      failing.push({
        text,
        cls: (el.className || '').toString().slice(0, 30),
        ratio: value.toFixed(2),
        need,
        color: colour,
        bg,
      });
    }
  };

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

    measure(el, style.color, background(el), ownText.slice(0, 24));
  }

  /* A field draws its text into a shadow slot, so it has no text node for the walk
     above to find and it went unchecked entirely. An empty field is measured on the
     colour its placeholder actually renders with, which is all the text there is
     until someone types. */
  const FIELDS =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]), textarea, select';
  for (const el of document.querySelectorAll(FIELDS)) {
    if (!el.checkVisibility()) continue;
    const style = getComputedStyle(el);
    const bg = background(el);
    if (el.value) {
      measure(el, style.color, bg, '<已填写输入框>');
      continue;
    }
    const placeholder = getComputedStyle(el, '::placeholder').color;
    measure(
      el,
      placeholder || style.color,
      bg,
      placeholder ? '<空输入框 占位符>' : '<空输入框>',
    );
  }
  /* B4②, and the one assertion in here that is about a cascade rather than a ratio: a
     degraded world's status line must resolve to `--warning`. It needed a rule in
     pages.css that a `.world-status { color: … !important }` was silently beating, so
     it is the kind of thing a later flag for another reason brings back. The row comes
     from the run's own payload (`degradeOneWorld` below); the token is resolved through
     a throwaway element so both sides of the comparison are computed colours. */
  const worldStatus = (() => {
    const row = document.querySelector(
      ".world-result[data-status='Degraded'] .world-status",
    );
    const probe = document.createElement('span');
    probe.style.color = 'var(--warning)';
    document.body.append(probe);
    const warning = getComputedStyle(probe).color;
    probe.remove();
    return row
      ? { got: getComputedStyle(row).color, warning }
      : { got: null, warning };
  })();

  return {
    offScale: [...offScale].sort((a, b) => a - b),
    belowFloor: [...belowFloor].sort((a, b) => a - b),
    worldStatus,
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

/* The whitelist pass first, so a stylesheet regression is reported even if the browser
   half below never finishes. */
const sheetAudit = auditStylesheets();
for (const finding of sheetAudit.findings)
  failures.push(`stylesheets: ${finding}`);
if (sheetAudit.offGrid > OFF_GRID_SPACING_BUDGET) {
  failures.push(
    `stylesheets: ${sheetAudit.offGrid} spacing declarations off the 4px grid, ` +
      `over the ${OFF_GRID_SPACING_BUDGET} this batch left behind`,
  );
}
console.log(
  `component sheets: ${COMPONENT_SHEETS.length}  ` +
    `whitelist findings: ${sheetAudit.findings.length}  ` +
    `off-grid spacing: ${sheetAudit.offGrid} / budget ${OFF_GRID_SPACING_BUDGET}`,
);

/** One world in the payload is marked Degraded, so the status-colour assertion below has
 *  a row to measure. The repo fixture has none: with every world Present, the status line
 *  is the muted one everywhere and the rule that paints a degraded world could be deleted
 *  without this check noticing. */
function degradeOneWorld() {
  const inner = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    const answer = await inner(command, args);
    if (command === 'load_library') {
      for (const root of answer?.report?.roots ?? []) {
        if (root.worlds?.length > 1)
          root.worlds[1] = { ...root.worlds[1], status: 'Degraded' };
      }
    }
    return answer;
  };
}

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(installObservationFixture, backend);
  // After `installObservationFixture`, which installs `__TAURI_INTERNALS__` itself.
  await context.addInitScript(degradeOneWorld);
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
      // The antd migration moved some disclosures from <details> to Collapse
      // (DataHealth's evidence list was the first). Their hidden panels are
      // display:none and would silently drop out of the walk below, so the same
      // coverage is restored by expanding every collapsed panel - the exact
      // equivalent of the details loop above, gated to not re-close open ones.
      document
        .querySelectorAll(
          '.ant-collapse-item:not(.ant-collapse-item-active) > .ant-collapse-header',
        )
        .forEach((node) => {
          if (node instanceof HTMLElement) node.click();
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
    /* The degraded-world status colour, on the page that carries those rows. A missing
       row is a failure rather than a skip: `degradeOneWorld` puts one there on purpose,
       so its absence means the payload or the markup changed shape. */
    if (route === 'worlds') {
      if (!result.worldStatus?.got) {
        failures.push(
          `${where}: no .world-result[data-status='Degraded'] .world-status to measure`,
        );
      } else if (result.worldStatus.got !== result.worldStatus.warning) {
        failures.push(
          `${where}: degraded world status is ${result.worldStatus.got}, ` +
            `--warning is ${result.worldStatus.warning}`,
        );
      }
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
  'PASS: no off-scale sizes, nothing below the floor, no below-AA text, no external ' +
    'requests, no literal colours, no named off-grid spacing, and off-grid spacing no ' +
    `worse than the ${OFF_GRID_SPACING_BUDGET} declarations this batch left behind`,
);
