/* global window, document, localStorage, getComputedStyle, innerWidth, innerHeight, Node, Element */
/**
 * Interaction forensics for the hover-expansion rail (design spec acceptance A1-A19
 * plus the interaction core list). Real browser, real pointer and keyboard: the rail
 * is opened with page.hover / mouse.move / mouse.down / keyboard.press, never by
 * flipping classes, and every geometry claim is a getBoundingClientRect reading.
 *
 * Fixture injection follows output/visual-accept.mjs: the repo's own
 * scripts/qa-fixtures.mjs backend table + scripts/qa-observation-fixture.mjs installed
 * via addInitScript, mock Tauri IPC, theme seeded through localStorage. No dev server
 * is started here - it must already run on :1420 (qa-error-boundary.mjs convention).
 *
 *   node scripts/qa-rail-forensics.mjs
 *
 * Writes 18 named PNGs + evidence.json into output/visual-accept/interaction/ and
 * prints the criteria as JSON on stdout. Nothing outside output/ is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:1420';
const outDir = path.join('output', 'visual-accept', 'interaction');
fs.mkdirSync(outDir, { recursive: true });

/** 100ms intent + 180ms transition + margin. */
const OPEN_WAIT_MS = 600;
/** 200ms leave-grace + transition + margin. */
const CLOSE_WAIT_MS = 600;

const clone = (value) => JSON.parse(JSON.stringify(value));

let browser;

async function reachable() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(BASE, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return true;
    } catch {
      /* retry below */
    }
    await delay(2000);
  }
  return false;
}
if (!(await reachable())) {
  console.error(`dev server not reachable on ${BASE}`);
  process.exit(2);
}

browser = await chromium.launch({ channel: 'msedge', headless: true });

const evidence = {
  base: BASE,
  fixture:
    'scripts/qa-fixtures.mjs + scripts/qa-observation-fixture.mjs (visual-accept.mjs pattern)',
  criteria: [],
  shots: [],
  consoleErrors: [],
  notes: [],
};
const flush = () =>
  fs.writeFileSync(
    path.join(outDir, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  );

function criterion(name, expected, actual, pass, detail) {
  evidence.criteria.push({ criterion: name, expected, actual, pass, detail });
  console.log(
    `${
      pass ? 'PASS' : 'FAIL'
    } ${name}\n     expected: ${expected}\n     actual:   ${actual}`,
  );
  return pass;
}

/* --------------------------------------------------------------------------
   Page setup. msedge headless, mock Tauri IPC over the fixture backend table,
   theme via localStorage, reducedMotion through the context option (the app's
   own styles.css @media (prefers-reduced-motion: reduce) block then zeroes every
   transition/animation, which makes the geometry land instantly and keeps the
   measurements deterministic). NO matchMedia stub and NO transition-killing
   style tag: canOpen() reads window.matchMedia('(min-width: 860px)') for real.
   -------------------------------------------------------------------------- */
async function openPage({
  width,
  height = 900,
  route = '#/dashboard',
  theme = 'light',
  reducedMotion = 'reduce',
  seedLegacyKey = false,
}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion,
  });
  const table = clone(backend);
  await context.addInitScript(
    ({ tableValue, themeValue, seedLegacyKeyValue }) => {
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (cb) => cb,
        invoke: async (command) =>
          command in tableValue ? tableValue[command] : null,
      };
      localStorage.setItem('minechronicle.theme', themeValue);
      if (seedLegacyKeyValue)
        localStorage.setItem('minechronicle.rail', 'collapsed');
    },
    { tableValue: table, themeValue: theme, seedLegacyKeyValue: seedLegacyKey },
  );
  await context.addInitScript(installObservationFixture, table);

  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) =>
    errors.push(`pageerror: ${error.message}\n${error.stack ?? ''}`),
  );

  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
  // .rail-toggle no longer exists; the nav buttons are the render gate.
  await page.waitForSelector('.app-nav button', { timeout: 30000 });
  await page
    .waitForFunction(() => !document.body.innerText.includes('正在读取'), {
      timeout: 20000,
    })
    .catch(() => {});
  await page
    .waitForFunction(
      () => {
        const value = document.querySelector('.foundation');
        return !!value && value.getBoundingClientRect().height > 0;
      },
      { timeout: 20000 },
    )
    .catch(() => {});
  // Two height-stability rounds, then a final settle - the visual-accept.mjs lesson.
  for (let round = 0; round < 2; round += 1) {
    await delay(600);
    await page
      .waitForFunction(
        () => {
          const height = document.documentElement.scrollHeight;
          const previous = window.__qaForensicHeight;
          window.__qaForensicHeight = height;
          return previous === height;
        },
        { timeout: 15000, polling: 500 },
      )
      .catch(() => {});
  }
  await delay(300);
  return { context, page, errors };
}

/* One probe, serialised once per state: geometry, computed styles, labels,
   status dots, focus, storage. Everything the criteria cite comes from here. */
const probe = () => {
  const rail = document.querySelector('.app-rail');
  const main = document.querySelector('.main-column');
  const cs = rail ? getComputedStyle(rail) : null;
  const visibleCount = (selector) =>
    [...document.querySelectorAll(selector)].filter(
      (el) => el.getBoundingClientRect().width > 0,
    ).length;
  const active = document.activeElement;
  const railStatus = document.querySelector('.rail-status');
  const railDot = railStatus?.querySelector('.watch-dot') ?? null;
  const railDotStyle = railDot ? getComputedStyle(railDot) : null;
  const statusDot = document.querySelector('.status-center .watch-dot');
  const groupTitles = [...document.querySelectorAll('.app-nav-group-title')];
  const firstGroup = document.querySelector('.app-nav-group');
  const firstGroupFirstButton = firstGroup?.querySelector('button');
  const visibleRect = (el) => {
    const b = el.getBoundingClientRect();
    return { w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  };
  return {
    railPresent: !!rail,
    railW: rail ? +rail.getBoundingClientRect().width.toFixed(1) : null,
    railX: rail ? +rail.getBoundingClientRect().x.toFixed(1) : null,
    position: cs?.position ?? null,
    zIndex: cs?.zIndex ?? null,
    transitionDuration: cs?.transitionDuration ?? null,
    transitionProperty: cs?.transitionProperty ?? null,
    animationName: cs?.animationName ?? null,
    mainX: main ? +main.getBoundingClientRect().x.toFixed(1) : null,
    mainW: main ? +main.getBoundingClientRect().width.toFixed(1) : null,
    gridCols: getComputedStyle(document.querySelector('.app-shell'))
      .gridTemplateColumns,
    visibleLabels: visibleCount('.app-nav-label'),
    visibleGroupTitles: visibleCount('.app-nav-group-title'),
    groupTitleTexts: groupTitles.map((el) => el.textContent.trim()),
    navGroups: document.querySelectorAll('.app-nav-group').length,
    navButtons: document.querySelectorAll('.app-shell .app-nav button').length,
    firstGroupFirstButtonLabel:
      firstGroupFirstButton?.querySelector('.app-nav-label')?.textContent ??
      null,
    toggleCount: document.querySelectorAll('.rail-toggle').length,
    railStatusPresent: !!railStatus,
    railStatusAriaHidden: railStatus?.getAttribute('aria-hidden') ?? null,
    railDotClass: railDot?.className ?? null,
    railDotVisible: railDot
      ? railDot.getBoundingClientRect().width > 0 &&
        getComputedStyle(railDot).visibility !== 'hidden' &&
        getComputedStyle(railDot).display !== 'none'
      : false,
    railDotBox: railDot ? visibleRect(railDot) : null,
    railDotBackground: railDotStyle?.backgroundColor ?? null,
    railStatusLabel: railStatus
      ? railStatus.querySelector('.rail-status-label')?.textContent ?? null
      : null,
    railStatusLabelVisible: railStatus
      ? (railStatus.querySelector('.rail-status-label')?.getBoundingClientRect()
          .width ?? 0) > 0
      : null,
    statusDotClass: statusDot?.className ?? null,
    activeTag: active ? active.tagName.toLowerCase() : '',
    activeClass: active instanceof Element ? active.className : '',
    activeInsideRail: !!(
      active instanceof Node &&
      rail &&
      rail.contains(active)
    ),
    activeIsVisibleSessionPage:
      active instanceof Element &&
      active.classList.contains('session-page') &&
      !active.hidden &&
      !!active.closest('.main-column'),
    firstVisibleSessionPageClass:
      document.querySelector('.main-column .session-page:not([hidden])')
        ?.className ?? null,
    stored: window.localStorage.getItem('minechronicle.rail'),
    themeStored: window.localStorage.getItem('minechronicle.theme'),
    dataRail: document.documentElement.getAttribute('data-rail'),
    hash: window.location.hash,
    viewport: [innerWidth, innerHeight],
  };
};

async function shot(name, page, { fullPage = true, selector = null } = {}) {
  const file = path.join(outDir, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage });
  const bytes = fs.statSync(file).size;
  evidence.shots.push({
    file: path.posix.join('output/visual-accept/interaction', `${name}.png`),
    bytes,
  });
  return file;
}

const hoverRail = async (page) => {
  await page.hover('.app-rail');
  await page.waitForTimeout(OPEN_WAIT_MS);
};

/* Wrap each group so one broken step cannot take the rest of the run down. */
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    criterion(
      `${name}（执行异常）`,
      '组内全部断言执行完毕',
      `异常: ${error?.message ?? error}`,
      false,
      { stack: error?.stack ?? null },
    );
  }
  flush();
};

/* --- A1: the collapse button is gone, in the DOM and in the sources --------- */
await step('A1 无折叠按钮', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  const s = await page.evaluate(probe);
  criterion(
    'A1 DOM 中不存在 .rail-toggle 折叠按钮',
    'document.querySelectorAll(".rail-toggle").length === 0',
    `toggleCount=${s.toggleCount}`,
    s.toggleCount === 0,
    s,
  );
  const srcRoot = join(process.cwd(), 'src');
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const hits = walk(srcRoot)
    .filter((file) => /.(css|tsx?|mjs|html)$/.test(file))
    .filter((file) => readFileSync(file, 'utf8').includes('rail-toggle'))
    .map((file) => file.replace(srcRoot, 'src'));
  criterion(
    'A1 src 源码中 grep "rail-toggle" 零命中',
    '[]',
    JSON.stringify(hits),
    hits.length === 0,
    { hits },
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A2 + A3 + A15 + A18 + A17(compact): the resting shape ------------------ */
await step('A2/A3 默认收敛态', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  const s = await page.evaluate(probe);
  criterion(
    'A2 收敛态 rail 宽度 ∈ [70,74]',
    '70 ≤ .app-rail width ≤ 74',
    `railW=${s.railW}`,
    s.railW >= 70 && s.railW <= 74,
    s,
  );
  criterion(
    'A2 收敛态导航标签不可见',
    '可见 .app-nav-label 数 = 0',
    `visibleLabels=${s.visibleLabels}`,
    s.visibleLabels === 0,
  );
  criterion(
    'A2 收敛态分组标题不可见',
    '可见 .app-nav-group-title 数 = 0',
    `visibleGroupTitles=${s.visibleGroupTitles}`,
    s.visibleGroupTitles === 0,
  );
  criterion(
    'A2 grid 第一列以 72px 开头',
    'grid-template-columns 以 "72px" 开头',
    `gridCols="${s.gridCols}"`,
    s.gridCols.startsWith('72px'),
  );
  criterion(
    'A3 内容列基准 x（规格估算约 88 = 72+16，未计 .app-shell 自身 padding）',
    '.main-column x = shell padding(28, styles.css:51) + 72 + 16 = 116；记录该基准供 A5 对比',
    `mainX=${s.mainX}（mainW=${s.mainW}，rail x=28 w=72，即 28+72+16=116）`,
    Math.abs(s.mainX - 116) <= 2,
  );
  criterion(
    'A15 收敛态导航按钮数 = 7（单副本不变量）',
    '.app-shell .app-nav button === 7',
    `navButtons=${s.navButtons}`,
    s.navButtons === 7,
  );
  criterion(
    'A18 导航组数 = 2',
    '.app-nav-group === 2',
    `navGroups=${s.navGroups} 组标题=${JSON.stringify(s.groupTitleTexts)}`,
    s.navGroups === 2,
  );
  criterion(
    'A16 首次加载焦点不被抢占',
    'document.activeElement 为 body（.session-page 未被聚焦）',
    `activeTag=${s.activeTag} activeIsVisibleSessionPage=${s.activeIsVisibleSessionPage}`,
    s.activeTag === 'body' && !s.activeIsVisibleSessionPage,
  );
  criterion(
    'A17 收敛态栏脚状态点存在且可见、aria-hidden、与状态条圆点同类',
    '.rail-status .watch-dot 可见；aria-hidden="true"；类名与 .status-center .watch-dot 一致；短标签隐藏',
    `railDotVisible=${s.railDotVisible} railDotClass="${
      s.railDotClass
    }" statusDotClass="${s.statusDotClass}" ariaHidden=${
      s.railStatusAriaHidden
    } labelVisible=${s.railStatusLabelVisible} label="${
      s.railStatusLabel
    }" 点尺寸=${JSON.stringify(s.railDotBox)}`,
    s.railDotVisible &&
      s.railStatusAriaHidden === 'true' &&
      s.railDotClass === s.statusDotClass &&
      s.railStatusLabelVisible === false,
  );
  await shot('rail-compact-light', page, {
    selector: '.app-rail',
    fullPage: false,
  });
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A4 + A5 + A17(open) + screenshots: hover expands the rail -------------- */
await step('A4/A5 悬停展开', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  const before = await page.evaluate(probe);
  await hoverRail(page);
  const s = await page.evaluate(probe);
  criterion(
    'A4 悬停后展开栏 position === sticky（原位推挤，不悬浮）',
    'computed position === "sticky"',
    `position=${s.position}`,
    s.position === 'sticky',
  );
  criterion(
    'A4 展开层 z-index === 25',
    'computed z-index === "25"',
    `zIndex=${s.zIndex}`,
    s.zIndex === '25',
  );
  criterion(
    'A4 展开层宽度 ∈ [190,194]',
    '70*2+… → .app-rail width ∈ [190,194]（--sidebar-w=192px）',
    `railW=${s.railW}`,
    s.railW >= 190 && s.railW <= 194,
  );
  criterion(
    'A4 展开后 7 个标签全部可见',
    '可见 .app-nav-label 数 = 7',
    `visibleLabels=${s.visibleLabels}`,
    s.visibleLabels === 7,
  );
  criterion(
    'A4 展开后 2 个分组标题可见',
    '可见 .app-nav-group-title 数 = 2',
    `visibleGroupTitles=${s.visibleGroupTitles}`,
    s.visibleGroupTitles === 2,
  );
  const displacement = Math.abs(s.mainX - before.mainX);
  criterion(
    'A5 悬停展开内容列推挤位移 === +120±2px（推挤，不覆盖）',
    '|mainX_after - mainX_before| ∈ [118,122]px（= 展开宽 192 - 收纳宽 72）',
    `位移=${displacement}px（before=${before.mainX} after=${s.mainX}）`,
    displacement >= 118 && displacement <= 122,
  );
  criterion(
    'A15 展开态导航按钮数仍 = 7',
    '.app-shell .app-nav button === 7',
    `navButtons=${s.navButtons}`,
    s.navButtons === 7,
  );
  criterion(
    'A17 展开态栏脚状态点可见且短标签显示',
    '.rail-status .watch-dot 可见；.rail-status-label 可见（≤3 字短标签）',
    `railDotVisible=${s.railDotVisible} labelVisible=${s.railStatusLabelVisible} label="${s.railStatusLabel}"`,
    s.railDotVisible && s.railStatusLabelVisible === true,
  );
  await shot('rail-hover-light', page, {
    selector: '.app-rail',
    fullPage: false,
  });
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A9 + A16 + A14: click navigation keeps the rail open, focus follows ----
   The rail is a hover surface, not a click destination: a nav click lands under a
   pointer that is still resting on the rail, and collapsing there would yank the
   expanded overlay out from under the cursor (the click-collapse regression the
   spec bans). The assertions therefore expect the rail to STAY at full width across
   the click and the pointer's dwell, and to close only when the pointer leaves -
   exercised at the end of this step, in the same context, because clicks no longer
   touch the close path at all. */
await step('A9/A16/A14 点击导航', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  await hoverRail(page);
  // 游戏实例 is the second button, i.e. not the current page.
  await page.locator('.app-nav button').nth(1).click();
  const s = await page.evaluate(probe);
  criterion(
    'A9 点击导航立即切页',
    'location.hash === "#/instances"',
    `hash=${s.hash}`,
    s.hash === '#/instances',
  );
  criterion(
    'A9 点击导航不收起（指针仍停在栏上，<100ms 内量得 ≥190）',
    '点击后立即量 rail width ≥ 190：悬停展开不因点击收回',
    `railW=${s.railW}`,
    s.railW >= 190,
  );
  // Focus follows the navigation (C1) - give the render + layout effect a beat first.
  await page.waitForTimeout(500);
  const focused = await page.evaluate(probe);
  criterion(
    'A16 切到「游戏实例」后焦点落在 .main-column 内第一个可见 .session-page',
    'activeElement 是 .main-column 内 :not([hidden]) 的 .session-page',
    `activeTag=${focused.activeTag} activeClass="${focused.activeClass}" activeIsVisibleSessionPage=${focused.activeIsVisibleSessionPage} 可见 .session-page="${focused.firstVisibleSessionPageClass}"`,
    focused.activeIsVisibleSessionPage,
  );
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const still = await page.evaluate(probe);
  criterion(
    'A9 指针停留期间保持全宽 ∈ [190,194]',
    '指针仍停在栏上：rail width ∈ [190,194]',
    `railW=${still.railW}`,
    still.railW >= 190 && still.railW <= 194,
  );
  // The close path is the pointer leaving (150ms grace), never the click itself.
  await page.mouse.move(720, 400);
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const settled = await page.evaluate(probe);
  criterion(
    'A9 指针离开后收回落定 ∈ [70,74]',
    'rail width ∈ [70,74]',
    `railW=${settled.railW}`,
    settled.railW >= 70 && settled.railW <= 74,
  );
  criterion(
    'A14 完整悬停→点击→收回周期不写入偏好',
    'localStorage["minechronicle.rail"] 仍为 null（对照组 theme 键存在）',
    `stored=${JSON.stringify(settled.stored)}（对照 theme=${JSON.stringify(
      settled.themeStored,
    )}）`,
    settled.stored === null && settled.themeStored === 'light',
  );
  evidence.consoleErrors.push(...errors);
  await context.close();

  // Control: the same click path onto a page whose container IS a SessionPage (世界与玩家).
  const ctl = await openPage({ width: 1440 });
  await hoverRail(ctl.page);
  await ctl.page.locator('.app-nav button').nth(2).click();
  await ctl.page.waitForTimeout(500);
  const worlds = await ctl.page.evaluate(probe);
  criterion(
    'A16 对照组：切到「世界与玩家」（SessionPage 容器）后焦点落在 .session-page',
    'activeElement 是 .main-column 内 :not([hidden]) 的 .session-page',
    `hash=${worlds.hash} activeTag=${worlds.activeTag} activeClass="${worlds.activeClass}" activeIsVisibleSessionPage=${worlds.activeIsVisibleSessionPage}`,
    worlds.activeIsVisibleSessionPage,
  );
  evidence.consoleErrors.push(...ctl.errors);
  await ctl.context.close();
});

/* --- A6: leaving closes it again -------------------------------------------- */
await step('A6 移出收回', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  await hoverRail(page);
  await page.hover('.main-column');
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const s = await page.evaluate(probe);
  criterion(
    'A6 鼠标移入内容列后收回至 ∈ [70,74]',
    'rail width ∈ [70,74]',
    `railW=${s.railW}`,
    s.railW >= 70 && s.railW <= 74,
  );
  criterion(
    'A6 移出后标签不可见',
    '可见标签 = 0',
    `visibleLabels=${s.visibleLabels}`,
    s.visibleLabels === 0,
  );
  criterion(
    'A6 position 回到 sticky',
    'computed position === "sticky"',
    `position=${s.position}`,
    s.position === 'sticky',
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A7 + A8: keyboard in, Escape out --------------------------------------- */
await step('A7/A8 键盘展开与 Esc', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  // First Tab lands on the first nav button (wordmark/residency are spans): focusin
  // opens the rail on the spot, no 100ms intent delay.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(50);
  const s = await page.evaluate(probe);
  criterion(
    'A7 Tab 聚焦导航按钮后 ≤50ms rail 已展开（≥190，无 100ms 意图延迟）',
    'railW ≥ 190 且焦点在 rail 内',
    `railW=${s.railW} activeInsideRail=${s.activeInsideRail} activeClass="${s.activeClass}"`,
    s.railW >= 190 && s.activeInsideRail,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = await page.evaluate(probe);
  criterion(
    'A8 Esc 收回 rail ∈ [70,74]',
    'rail width ∈ [70,74]',
    `railW=${after.railW}`,
    after.railW >= 70 && after.railW <= 74,
  );
  criterion(
    'A8 Esc 后焦点不在 .app-rail 内',
    'document.activeElement 不在 .app-rail 内',
    `activeInsideRail=${after.activeInsideRail} activeTag=${after.activeTag} activeClass="${after.activeClass}"`,
    after.activeInsideRail === false,
  );
  criterion(
    'A8 焦点落到 .main-column',
    'activeElement 是 .main-column（tabIndex=-1 的容器）',
    `"${after.activeTag}.${after.activeClass}".includes("main-column")`,
    `${after.activeTag}.${after.activeClass}`.includes('main-column'),
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A10: light dismiss ------------------------------------------------------ */
await step('A10 轻量关闭', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  await hoverRail(page);
  const main = await page.locator('.main-column').boundingBox();
  /* The open overlay spans x 0..192 and covers the content column's left edge
     (main.x=116), so a point 40px into .main-column is still ON the rail and a
     press there is rail.contains(target) - not a dismiss. Press 200px in, past
     the overlay's right edge, the way a user pressing on content would. */
  await page.mouse.move(main.x + 200, main.y + 40);
  await page.mouse.down();
  const s = await page.evaluate(probe);
  await page.mouse.up();
  criterion(
    'A10 展开态在 .main-column 上 pointerdown 立即收回',
    'pointerdown 后立即量 rail width < 190；600ms 后 ∈ [70,74]',
    `立即 railW=${s.railW}`,
    s.railW < 190,
  );
  await page.waitForTimeout(CLOSE_WAIT_MS);
  const after = await page.evaluate(probe);
  criterion(
    'A10 落定后 rail ∈ [70,74]',
    'rail width ∈ [70,74]',
    `railW=${after.railW}`,
    after.railW >= 70 && after.railW <= 74,
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A11: identical at 900 and 1440; the 620 strip stays a strip ------------- */
await step('A11 宽度一致性', async () => {
  for (const width of [900, 1440]) {
    const { context, page, errors } = await openPage({ width });
    const before = await page.evaluate(probe);
    await hoverRail(page);
    const openState = await page.evaluate(probe);
    criterion(
      `A11@${width} 收敛态 72px、零标签`,
      'railW ∈ [70,74] 且 visibleLabels = 0',
      `railW=${before.railW} visibleLabels=${before.visibleLabels}`,
      before.railW >= 70 && before.railW <= 74 && before.visibleLabels === 0,
    );
    criterion(
      `A11@${width} 悬停态 sticky、192px、7 标签`,
      'position=sticky；railW ∈ [190,194]；visibleLabels = 7',
      `position=${openState.position} railW=${openState.railW} visibleLabels=${openState.visibleLabels}`,
      openState.position === 'sticky' &&
        openState.railW >= 190 &&
        openState.railW <= 194 &&
        openState.visibleLabels === 7,
    );
    const displacement = Math.abs(openState.mainX - before.mainX);
    criterion(
      `A11@${width} 内容列推挤位移 === +120±2px`,
      '|ΔmainX| ∈ [118,122]px（内容列被推向右，不被覆盖）',
      `位移=${displacement}px（before=${before.mainX} after=${openState.mainX}）`,
      displacement >= 118 && displacement <= 122,
    );
    evidence.consoleErrors.push(...errors);
    await context.close();
  }

  // 620px strip tier: .app-rail is display:contents (no box), so there is nothing for
  // hover() to target - sweep the mouse across the strip instead.
  const { context, page, errors } = await openPage({ width: 620, height: 900 });
  await page.mouse.move(400, 24);
  await page.waitForTimeout(OPEN_WAIT_MS);
  const strip = await page.evaluate(probe);
  criterion(
    'A11@620 顶条档不产生 fixed 层',
    'position 非 fixed',
    `position=${strip.position} railW=${strip.railW}`,
    strip.position !== 'fixed',
  );
  criterion(
    'A11@620 顶条档 7 个标签常驻可见',
    'visibleLabels = 7',
    `visibleLabels=${strip.visibleLabels}`,
    strip.visibleLabels === 7,
  );
  criterion(
    'A11@620 顶条档导航按钮 = 7',
    '.app-shell .app-nav button === 7',
    `navButtons=${strip.navButtons}`,
    strip.navButtons === 7,
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A12: reduced motion zeroes the new transition --------------------------- */
await step('A12 reduced-motion', async () => {
  const { context, page, errors } = await openPage({ width: 1440 });
  const s = await page.evaluate(probe);
  criterion(
    'A12 reduced-motion 下 .app-rail transitionDuration === "0s"',
    'transitionDuration === "0s"',
    `transitionDuration="${s.transitionDuration}"`,
    s.transitionDuration === '0s',
  );
  criterion(
    'A12 reduced-motion 下 .app-rail animationName === "none"',
    'animationName === "none"',
    `animationName="${s.animationName}"`,
    s.animationName === 'none',
  );
  const shell = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.app-shell'));
    return { transition: cs.transitionDuration, animation: cs.animationName };
  });
  criterion(
    'A12 reduced-motion 下 .app-shell transition/animation 均归零',
    'transitionDuration === "0s" 且 animationName === "none"',
    `transition="${shell.transition}" animation="${shell.animation}"`,
    shell.transition === '0s' && shell.animation === 'none',
  );
  await page.hover('.app-rail');
  await page.waitForTimeout(150);
  const openState = await page.evaluate(probe);
  criterion(
    'A12 悬停后 150ms 即达全宽 ∈ [190,194]（无过渡直达终态）',
    'railW ∈ [190,194]',
    `railW=${openState.railW}`,
    openState.railW >= 190 && openState.railW <= 194,
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- A13: the legacy key never survives first paint -------------------------- */
await step('A13 旧键清理', async () => {
  const { context, page, errors } = await openPage({
    width: 1440,
    seedLegacyKey: true,
  });
  const s = await page.evaluate(probe);
  criterion(
    'A13 预置 localStorage["minechronicle.rail"]="collapsed" 后加载即被清除',
    'localStorage.getItem("minechronicle.rail") === null',
    `stored=${JSON.stringify(s.stored)}`,
    s.stored === null,
  );
  criterion(
    'A13 <html> 无 data-rail 属性',
    'document.documentElement.hasAttribute("data-rail") === false',
    `dataRail=${JSON.stringify(s.dataRail)}`,
    s.dataRail === null,
  );
  criterion(
    'A13 清理后收敛态仍为 72px',
    'railW ∈ [70,74]',
    `railW=${s.railW}`,
    s.railW >= 70 && s.railW <= 74,
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- S7 补充：正常动效下的过渡值（非 reduce 上下文，不注入任何 style tag）---- */
await step('S7 正常动效过渡值', async () => {
  const { context, page, errors } = await openPage({
    width: 1440,
    reducedMotion: 'no-preference',
  });
  const s = await page.evaluate(probe);
  criterion(
    'S7 正常动效下 .app-rail 声明 width/box-shadow 过渡，时长落在 160-200ms（--motion-base=180ms）',
    'transitionProperty 含 width 与 box-shadow；transitionDuration 含 "0.18s"',
    `transitionProperty="${s.transitionProperty}" transitionDuration="${s.transitionDuration}"`,
    s.transitionProperty.includes('width') &&
      s.transitionProperty.includes('box-shadow') &&
      s.transitionDuration.includes('0.18s'),
  );
  await hoverRail(page);
  const openState = await page.evaluate(probe);
  criterion(
    'S7 正常动效下悬停 600ms 后到达全宽 ∈ [190,194]',
    'railW ∈ [190,194]',
    `railW=${openState.railW} position=${openState.position}`,
    openState.railW >= 190 && openState.railW <= 194,
  );
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- 深色主题两态截图 + 快速复核 --------------------------------------------- */
await step('深色主题 rail 两态', async () => {
  const { context, page, errors } = await openPage({
    width: 1440,
    theme: 'dark',
  });
  const compact = await page.evaluate(probe);
  criterion(
    '深色主题收敛态：72px、零标签',
    'railW ∈ [70,74] 且 visibleLabels = 0',
    `railW=${compact.railW} visibleLabels=${
      compact.visibleLabels
    } themeStored=${JSON.stringify(compact.themeStored)}`,
    compact.railW >= 70 && compact.railW <= 74 && compact.visibleLabels === 0,
  );
  await shot('rail-compact-dark', page, {
    selector: '.app-rail',
    fullPage: false,
  });
  await hoverRail(page);
  const openState = await page.evaluate(probe);
  {
    const darkShift = Math.abs(openState.mainX - compact.mainX);
    criterion(
      '深色主题悬停态：sticky、192px、7 标签、推挤 +120±2px',
      'position=sticky；railW ∈ [190,194]；visibleLabels = 7；|ΔmainX| ∈ [118,122]',
      `position=${openState.position} railW=${openState.railW} visibleLabels=${openState.visibleLabels} 位移=${darkShift}px`,
      openState.position === 'sticky' &&
        openState.railW >= 190 &&
        openState.railW <= 194 &&
        openState.visibleLabels === 7 &&
        darkShift >= 118 &&
        darkShift <= 122,
    );
  }
  await shot('rail-hover-dark', page, {
    selector: '.app-rail',
    fullPage: false,
  });
  evidence.consoleErrors.push(...errors);
  await context.close();
});

/* --- 七页 × 明暗全页截图 ------------------------------------------------------ */
const PAGES = [
  ['dashboard', '#/dashboard', '.app-nav button'],
  ['instances', '#/instances', '.list-result-count, .list-empty'],
  ['worlds', '#/worlds', '.app-nav button'],
  ['timeline', '#/timeline', '.app-nav button'],
  ['statistics', '#/statistics', '.statistics-table'],
  ['observation', '#/observation', '.app-nav button'],
  ['settings', '#/settings', '.settings-card'],
];
for (const theme of ['light', 'dark']) {
  for (const [name, route, waitFor] of PAGES) {
    await step(`截图 ${name}-${theme}`, async () => {
      const { context, page, errors } = await openPage({
        width: 1440,
        route,
        theme,
      });
      await page.waitForSelector(waitFor, { timeout: 20000 }).catch(() => {});
      await delay(300);
      await shot(`${name}-${theme}`, page, { fullPage: true });
      evidence.consoleErrors.push(...errors);
      await context.close();
    });
  }
}

/* A19 的浏览器脚本部分在本脚本之外运行（qa-design-check / qa-rail-hover /
   qa-rail-measure / typecheck + vitest），退出码由运行方记录在报告里。 */

await browser?.close();
flush();

const failed = evidence.criteria.filter((c) => !c.pass);
console.log(
  `\n${evidence.criteria.length - failed.length}/${
    evidence.criteria.length
  } criteria PASS; ` + `${evidence.shots.length} shots → ${outDir}`,
);
if (failed.length) {
  console.log('FAILED:');
  for (const c of failed) console.log(`  - ${c.criterion}: actual=${c.actual}`);
}
process.exit(failed.length === 0 ? 0 : 1);
