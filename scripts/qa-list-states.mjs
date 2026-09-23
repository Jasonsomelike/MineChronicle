/* global window */
/**
 * Capture empty and one-row screenshots for the three short pages.
 * Requires `npm run dev` on :1420.
 *
 *   node scripts/qa-list-states.mjs
 *
 * Writes PNGs under output/list-states/.
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

const cases = [
  ['instances-empty', '#/instances', withInstances(0)],
  ['instances-one-row', '#/instances', withInstances(1)],
  ['worlds-empty', '#/worlds', withWorlds(0)],
  ['worlds-one-row', '#/worlds', withWorlds(1)],
  ['timeline-empty', '#/timeline', withTimeline(0)],
  ['timeline-one-row', '#/timeline', withTimeline(1)],
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const [name, route, table] of cases) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((backendJson) => {
    const t = JSON.parse(backendJson);
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in t ? t[command] : null),
    };
  }, JSON.stringify(table));
  await context.addInitScript(installObservationFixture, table);
  const page = await context.newPage();
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const empty = await page.locator('.list-empty:visible').count();
  const count = await page.locator('.list-result-count:visible').count();
  const expectEmpty = name.endsWith('-empty');
  const ok = expectEmpty
    ? empty === 1 && count === 0
    : empty === 0 && count >= 1;
  if (!ok) {
    console.error(
      `FAIL: ${name} expected empty=${expectEmpty ? 1 : 0} count=${
        expectEmpty ? 0 : '>=1'
      }, got empty=${empty} count=${count}`,
    );
    await browser.close();
    process.exit(1);
  }
  console.log(`${name}: empty=${empty} countFooter=${count} -> ${file}`);
  await context.close();
}

await browser.close();
console.log('PASS: list-state screenshots');
