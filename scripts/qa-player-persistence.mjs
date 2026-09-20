/**
 * Focused QA: verify the player selection actually persists across a reload.
 *
 * Regression check for the missing savePlayers() call: before the fix, the
 * selection was read on start but never written, so a reload always lost it.
 *
 * Uses the documented mock-IPC approach (real components, stubbed backend) so
 * no real archive is touched. Requires `npm run dev` to be running.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
// Reads the app version from package.json; a literal here goes stale on every
// release and makes runtime_info look like a version mismatch.
import { APP_VERSION } from './qa-fixtures.mjs';

const base = 'http://127.0.0.1:1420';

async function reachable() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(base, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return true;
    } catch {
      /* retry */
    }
    await delay(2000);
  }
  return false;
}
if (!(await reachable())) {
  console.error(
    `开发服务器未就绪：请先运行 npm run dev，并确认 ${base} 可访问。`,
  );
  process.exit(2);
}

const UUID_A = 'b0e9bd79-52ec-45c0-ad53-d92995098e1d';
const UUID_B = '00000000-0000-4000-8000-000000000001';

const player = (uuid, name) => ({
  uuid,
  preferred_name: name,
  name_source: 'usercache',
  initial_play_ticks: '1000',
  play_ticks: '2000',
  source_paths: [],
  conflicting: false,
});

const library = {
  report: {
    instances: [],
    roots: [
      {
        path: 'D:\\QA\\root',
        requested_paths: ['D:\\QA\\root'],
        enumeration_complete: true,
        worlds: [
          {
            path: 'D:\\QA\\root\\saves\\world',
            name: 'QA World',
            status: 'Present',
            data_version: 3465,
            minecraft_version: '1.21',
            players: [player(UUID_A, 'Jasonsomelike'), player(UUID_B, 'jr')],
          },
        ],
      },
    ],
    issues: [],
    cancelled: false,
    saved: true,
    database_path: 'D:\\QA\\archive.sqlite3',
    last_scan: '2026-09-17T00:00:00.000Z',
    historical_ticks: '3000',
  },
  inputs: ['D:\\QA\\root'],
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();

// Stub the Tauri IPC surface the app touches on this path.
await page.addInitScript(
  ([libraryJson, uuidA, uuidB, appVersion]) => {
    const library = JSON.parse(libraryJson);
    // isTauri() tests window.isTauri, not __TAURI_INTERNALS__ alone.
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => {
        switch (command) {
          case 'load_library':
            return library;
          case 'runtime_info':
            return {
              version: appVersion,
              executable: 'D:\\QA\\minechronicle.exe',
              database_path: 'D:\\QA\\archive.sqlite3',
              embedded_assets: true,
              pcl_instances: 0,
            };
          case 'tracking_status':
            return {
              enabled: true,
              running: false,
              watched_directories: 1,
              finalizing_instances: 0,
              revision: 1,
              error: null,
              active_instances: [],
            };
          case 'tracking_summary':
            return {
              sessions: [],
              players: [],
              rollbacks: [],
              rollback_count: 0,
              observations: 0,
              started_at: null,
            };
          case 'pcl_sync_status':
            return null;
          case 'self_player_identity':
            return uuidA;
          case 'statistics':
            return {
              counters: {},
              categories: [],
              rows: [],
              total: 0,
              page_size: 100,
              sources: 0,
              unavailable: 0,
            };
          case 'timeline':
            return { events: [], total: 0, page_size: 50 };
          case 'health_summary':
            return {
              items: [],
              candidates: [],
              pending_count: 0,
              confirmed_lineages: 0,
              analysis_limited: false,
            };
          case 'acknowledge_view':
            return null;
          case 'discover_pcl_folders':
            return { folders: [], launchers: [], issues: [] };
          default:
            void uuidB;
            return null;
        }
      },
    };
  },
  [JSON.stringify(library), UUID_A, UUID_B, APP_VERSION],
);

await page.goto(`${base}/#/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app-nav button', { timeout: 30000 });
await delay(2500);

// Open the player picker and choose exactly one player.
const trigger = page.locator('.combination-picker .player-trigger').first();
await trigger.click();
await delay(600);
const options = page.locator('.combination-popover .picker-options label');
const optionCount = await options.count();
console.log(`picker options=${optionCount}`);

// Use the "clear then pick one" path so the stored set is unambiguous.
await page
  .locator('.combination-popover .picker-actions button', { hasText: '清空' })
  .click();
await delay(400);
await options.nth(0).click();
await delay(600);

const stored = await page.evaluate(() =>
  localStorage.getItem('minechronicle.players'),
);
console.log(`after selecting one: stored=${stored}`);
const storedIds = JSON.parse(stored ?? 'null');
const wroteSelection = Array.isArray(storedIds) && storedIds.length === 1;

// Reload and confirm the selection is restored from storage.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app-nav button', { timeout: 30000 });
await delay(2500);
const restored = await page.evaluate(() =>
  localStorage.getItem('minechronicle.players'),
);
const restoredIds = JSON.parse(restored ?? 'null');
const survived = JSON.stringify(restoredIds) === JSON.stringify(storedIds);
console.log(`after reload: restored=${restored} survived=${survived}`);

await browser.close();

const pass = wroteSelection && survived;
console.log(
  pass
    ? 'PASS: selection written on change and restored after reload'
    : 'FAIL: selection was not persisted',
);
process.exitCode = pass ? 0 : 1;
