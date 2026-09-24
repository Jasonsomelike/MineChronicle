/* global window, localStorage */
/**
 * Capture empty and one-row screenshots for the three short pages, plus the overview's
 * no-player state.
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-list-states.mjs
 *
 * Writes PNGs under output/list-states/. Every case also asserts its own empty/count
 * shape, and the no-player case asserts what the review asked of it: the career figure
 * is `—` (not a zero), the ruler is gone, and there is exactly one clickable way to
 * choose a player.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const BASE = 'http://127.0.0.1:1420';
const outDir = path.join('output', 'list-states');
fs.mkdirSync(outDir, { recursive: true });

const clone = (obj) => JSON.parse(JSON.stringify(obj));

function withInstances(count) {
  const table = clone(backend);
  const lib = table.load_library;
  const root = lib.report.roots[0];
  const all = lib.report.instances.slice();
  lib.report.instances = all.slice(0, count);
  if (count <= 0) {
    root.worlds = [];
    lib.report.roots = [{ ...root, worlds: [] }];
  } else if (count === 1) {
    root.worlds = root.worlds.slice(0, 1);
    lib.report.roots = [{ ...root, worlds: root.worlds.slice(0, 1) }];
  }
  return table;
}

function withWorlds(count) {
  const table = clone(backend);
  const lib = table.load_library;
  lib.report.roots = lib.report.roots.map((r, i) =>
    i === 0
      ? {
          ...r,
          worlds: count <= 0 ? [] : r.worlds.slice(0, count),
        }
      : { ...r, worlds: count <= 0 ? [] : r.worlds.slice(0, count) },
  );
  return table;
}

function withTimeline(count) {
  const table = clone(backend);
  const events = table.timeline?.events ?? [];
  table.timeline = {
    ...(table.timeline ?? {}),
    events: count <= 0 ? [] : events.slice(0, count),
    total: count <= 0 ? 0 : count,
  };
  return table;
}

/* `[name, route, table, options]`. `playersNone` boots the app with the persisted
   "no player selected" preference, which is the state the overview has to answer for;
   `expectEmpty` is only needed when the name does not already end in `-empty`, and
   `checkCount: false` skips the footer assertion for pages that have a footer of their
   own to show. */
const cases = [
  ['instances-empty', '#/instances', withInstances(0)],
  ['instances-one-row', '#/instances', withInstances(1)],
  ['worlds-empty', '#/worlds', withWorlds(0)],
  ['worlds-one-row', '#/worlds', withWorlds(1)],
  ['timeline-empty', '#/timeline', withTimeline(0)],
  ['timeline-one-row', '#/timeline', withTimeline(1)],
  [
    'dashboard-no-player',
    '#/dashboard',
    backend,
    { playersNone: true, expectEmpty: true, checkCount: false },
  ],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const [name, route, table, options = {}] of cases) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    ({ backendJson, playersNone }) => {
      const t = JSON.parse(backendJson);
      window.isTauri = true;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (cb) => cb,
        invoke: async (command) => (command in t ? t[command] : null),
      };
      // Boots the shell the way a restart with that filter would.
      if (playersNone)
        localStorage.setItem('minechronicle.players-none', 'true');
    },
    { backendJson: JSON.stringify(table), playersNone: !!options.playersNone },
  );
  await context.addInitScript(installObservationFixture, table);
  const page = await context.newPage();
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const empty = await page.locator('.list-empty:visible').count();
  const count = await page.locator('.list-result-count:visible').count();
  const expectEmpty = options.expectEmpty ?? name.endsWith('-empty');
  // The overview page carries a footer of its own - the compact timeline's row count -
  // so its case asserts the empty block alone.
  let ok = expectEmpty ? empty === 1 : empty === 0;
  if (ok && options.checkCount !== false)
    ok = expectEmpty ? count === 0 : count >= 1;
  if (!ok) {
    console.error(
      `FAIL: ${name} expected empty=${expectEmpty ? 1 : 0} count=${
        expectEmpty ? 0 : '>=1'
      }, got empty=${empty} count=${count}`,
    );
    await browser.close();
    process.exit(1);
  }
  let extra = '';
  if (options.playersNone) {
    /* C2, asserted rather than photographed: no player chosen is not "no data". */
    const career = (
      await page.locator('.career-total strong').first().innerText()
    ).trim();
    const entry = await page
      .locator('.career-copy .list-empty button:visible')
      .count();
    const ruler = await page.locator('.playtime-ruler').count();
    ok = career === '—' && entry === 1 && ruler === 0;
    extra = ` career=${career} chooseEntry=${entry} ruler=${ruler}`;
    if (!ok) {
      console.error(
        `FAIL: ${name} expected career=— chooseEntry=1 ruler=0, got career=${career} chooseEntry=${entry} ruler=${ruler}`,
      );
      await browser.close();
      process.exit(1);
    }
  }
  console.log(
    `${name}: empty=${empty} countFooter=${count}${extra} -> ${file}`,
  );
  await context.close();
}

await browser.close();
console.log('PASS: list-state screenshots');
