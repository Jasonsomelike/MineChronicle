/**
 * Capture every page of the app for visual regression comparison.
 *
 * Uses the documented mock-IPC approach (real components, stubbed backend) so
 * no real archive is touched. Writes one PNG per page plus a manifest of the
 * SHA-256 of each, so two runs can be compared exactly rather than by eye.
 *
 * Requires `npm run dev` to be running; this script never starts a server.
 *
 *   node scripts/qa-visual-snapshot.mjs <output-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:1420';
const outDir = process.argv[2] ?? path.join('output', 'visual-baseline');

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

const player = (uuid, name, ticks) => ({
  uuid,
  preferred_name: name,
  name_source: 'usercache',
  initial_play_ticks: ticks,
  play_ticks: ticks,
  source_paths: ['D:\\QA\\root\\saves\\world\\stats'],
  conflicting: false,
});

const world = (name, index, players) => ({
  path: `D:\\QA\\root\\saves\\${name}`,
  name,
  status: index === 2 ? 'Missing' : 'Present',
  data_version: 3465,
  minecraft_version: '1.21',
  players,
});

const library = {
  report: {
    instances: [
      {
        launcher_path: 'D:\\QA\\PCL',
        instance_path: 'D:\\QA\\root',
        name: 'QA Instance',
        game_root: 'D:\\QA\\root',
        minecraft_version: '1.21',
        mod_loader: { name: 'NeoForge', version: '21.1.0' },
        isolation: 'isolated',
      },
    ],
    roots: [
      {
        path: 'D:\\QA\\root',
        requested_paths: ['D:\\QA\\root'],
        enumeration_complete: true,
        worlds: [
          world('QA World', 0, [
            player(UUID_A, 'Jasonsomelike', '104326476'),
            player(UUID_B, 'jr', '8200'),
          ]),
          world('Second World', 1, [player(UUID_A, 'Jasonsomelike', '41000')]),
          world('Removed World', 2, [player(UUID_B, 'jr', '1200')]),
        ],
      },
    ],
    issues: [
      {
        kind: 'CORRUPTED_STATS',
        path: 'D:\\QA\\root\\saves\\x\\stats\\a.json',
        message: '统计文件损坏',
      },
      {
        kind: 'EMPTY_STATS',
        path: 'D:\\QA\\root\\saves\\y\\stats\\b.json',
        message: '空统计文件',
      },
    ],
    cancelled: false,
    saved: true,
    database_path: 'D:\\QA\\archive.sqlite3',
    last_scan: '2026-09-17T10:00:00.000Z',
    historical_ticks: '104375676',
  },
  inputs: ['D:\\QA\\root'],
};

const statisticsRows = [
  ['minecraft:mined', 'minecraft:diamond_ore', '钻石矿石', 'blocks', '128'],
  ['minecraft:mined', 'minecraft:stone', '石头', 'blocks', '18422'],
  ['minecraft:crafted', 'minecraft:crafting_table', '工作台', 'items', '12'],
  ['minecraft:used', 'minecraft:bowl', '碗', 'times', '31'],
  ['minecraft:killed', 'minecraft:zombie', '僵尸', 'times', '204'],
  ['minecraft:custom', 'minecraft:jump', '跳跃', 'times', '9012'],
  ['minecraft:custom', 'minecraft:play_time', '游戏时长', 'ticks', '104326476'],
  [
    'minecraft:custom',
    'minecraft:walk_one_cm',
    '步行距离',
    'centimeters',
    '480233',
  ],
];

const statisticsPage = {
  counters: {
    play_ticks: '104326476',
    deaths: '17',
    jumps: '9012',
    mob_kills: '204',
    leave_game_count: '44',
    walk_cm: '480233',
    sprint_cm: '120044',
    fly_cm: '8100',
  },
  categories: [
    { id: 'mined', label: '摧毁', count: 2 },
    { id: 'crafted', label: '合成', count: 1 },
    { id: 'used', label: '使用', count: 1 },
    { id: 'killed', label: '杀死', count: 1 },
    { id: 'custom', label: '常规', count: 3 },
  ],
  rows: statisticsRows.map(([category, key, label, unit, value]) => ({
    category,
    key,
    category_label: category.replace('minecraft:', ''),
    label,
    unit,
    source_packs: ['QA Pack'],
    resource_roots: ['D:\\QA\\root'],
    resources: [
      {
        packs: ['QA Pack'],
        label,
        english: key.split(':')[1],
        origin: 'local',
        translation_source: 'qa.jar > zh_cn.json',
        icon: null,
      },
    ],
    value,
    sources: 1,
    samples: [],
  })),
  total: 8,
  page_size: 100,
  sources: 3,
  unavailable: 0,
};

const timelinePage = {
  events: [
    {
      id: 1,
      kind: 'initial_import',
      observed_at: '2026-09-01T09:00:00.000Z',
      world_path: 'D:\\QA\\root\\saves\\QA World',
      world_name: 'QA World',
      uuid: UUID_A,
      player_name: 'Jasonsomelike',
      play_ticks: '104326476',
      delta_ticks: '0',
      old_ticks: null,
    },
    {
      id: 2,
      kind: 'increment',
      observed_at: '2026-09-15T12:30:00.000Z',
      world_path: 'D:\\QA\\root\\saves\\QA World',
      world_name: 'QA World',
      uuid: UUID_A,
      player_name: 'Jasonsomelike',
      play_ticks: '104330000',
      delta_ticks: '3524',
      old_ticks: null,
    },
    {
      id: 3,
      kind: 'rollback',
      observed_at: '2026-09-16T18:00:00.000Z',
      world_path: 'D:\\QA\\root\\saves\\Second World',
      world_name: 'Second World',
      uuid: UUID_B,
      player_name: 'jr',
      play_ticks: '8200',
      delta_ticks: '0',
      old_ticks: '9000',
    },
  ],
  total: 3,
  page_size: 50,
};

const health = {
  items: [
    {
      key: 'a'.repeat(64),
      kind: 'CORRUPTED_STATS',
      path: 'D:\\QA\\root\\saves\\x\\stats\\a.json',
      detail: '统计文件损坏，已保留历史。',
      reviewed: false,
      target: 'D:\\QA\\root',
    },
    {
      key: 'b'.repeat(64),
      kind: 'UNRESOLVED_PLAYER',
      path: '',
      detail: `${UUID_B} 尚无本地名称，涉及 2 个世界。`,
      reviewed: true,
      target: UUID_B,
    },
  ],
  candidates: [
    {
      id: 1,
      status: 'pending',
      world_a: {
        id: 1,
        path: 'D:\\QA\\root\\saves\\QA World',
        name: 'QA World',
      },
      world_b: {
        id: 2,
        path: 'D:\\QA\\root\\saves\\Second World',
        name: 'Second World',
      },
      evidence: [
        {
          uuid: UUID_A,
          ticks: '41000',
          stats_hash: 'c'.repeat(64),
          metadata_fingerprint: 'fp',
        },
      ],
      detected_at: '2026-09-16T10:00:00.000Z',
      parent_world_id: null,
      inherited_confidence: null,
    },
  ],
  pending_count: 2,
  confirmed_lineages: 0,
  analysis_limited: false,
};

const trackingStatus = {
  enabled: true,
  running: false,
  watched_directories: 6,
  finalizing_instances: 0,
  revision: 7,
  error: null,
  active_instances: [],
};

const trackingSummary = {
  sessions: [
    {
      id: 1,
      game_root: 'D:\\QA\\root',
      instance_name: 'QA Instance',
      started_at: '2026-09-16T20:00:00.000Z',
      ended_at: '2026-09-16T22:15:00.000Z',
      status: 'closed',
    },
  ],
  players: [
    { uuid: UUID_A, ticks: '3524', week_ticks: '3524', month_ticks: '3524' },
    { uuid: UUID_B, ticks: '0', week_ticks: '0', month_ticks: '0' },
  ],
  rollbacks: [
    {
      world_path: 'D:\\QA\\root\\saves\\Second World',
      world_name: 'Second World',
      uuid: UUID_B,
      old_ticks: '9000',
      new_ticks: '8200',
      detected_at: '2026-09-16T18:00:00.000Z',
    },
  ],
  rollback_count: 1,
  observations: 12,
  started_at: '2026-09-01T09:00:00.000Z',
};

const pclStatus = {
  enabled: true,
  running: false,
  pcl_running: false,
  source: '已保存的 PCL 配置',
  launcher: 'D:\\QA\\PCL',
  link: {
    folders: [{ name: 'QA 文件夹', path: 'D:\\QA\\root', available: true }],
    launchers: ['D:\\QA\\PCL'],
    issues: [],
  },
  last_checked: '2026-09-17T09:00:00.000Z',
  last_synced: '2026-09-17T08:00:00.000Z',
  revision: 3,
  added: 0,
  changed: 1,
  current_instances: ['D:\\QA\\root'],
  issues: [],
};

const backend = {
  load_library: library,
  runtime_info: {
    version: '0.10.12',
    executable: 'D:\\QA\\minechronicle.exe',
    database_path: 'D:\\QA\\archive.sqlite3',
    embedded_assets: true,
    pcl_instances: 1,
  },
  tracking_status: trackingStatus,
  tracking_summary: trackingSummary,
  observed_sessions: trackingSummary.sessions,
  statistics: statisticsPage,
  timeline: timelinePage,
  health_summary: health,
  pcl_sync_status: pclStatus,
  self_player_identity: UUID_A,
  discover_pcl_folders: pclStatus.link,
  startup_status: {
    supported: true,
    enabled: false,
    executable: 'D:\\QA\\minechronicle.exe',
  },
  resolve_stat_icons: {},
  acknowledge_view: null,
  phase_status: { phase: 10, offline: true, scanning_available: true },
};

const pages = [
  ['dashboard', '#/dashboard'],
  ['instances', '#/instances'],
  ['worlds', '#/worlds'],
  ['timeline', '#/timeline'],
  ['statistics', '#/statistics'],
  ['observation', '#/observation'],
  ['settings', '#/settings'],
];

const viewports = [
  ['wide', { width: 1280, height: 900 }],
  ['narrow', { width: 620, height: 900 }],
];

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const manifest = {};

for (const [viewportName, viewport] of viewports) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript((backendJson) => {
    const table = JSON.parse(backendJson);
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: async (command) => (command in table ? table[command] : null),
    };
    // Pin animation so screenshots are deterministic.
    window.matchMedia = (query) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    });
  }, JSON.stringify(backend));

  for (const [name, hash] of pages) {
    await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-nav button', { timeout: 30000 });
    // Wait for the page to stop changing rather than for a fixed delay: the
    // settings page in particular keeps settling for longer than 2.5 s, and a
    // screenshot taken mid-settle differs between runs of identical CSS.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page
      .waitForFunction(
        () => {
          const root = document.querySelector('.scan-panel');
          if (!root) return true;
          const height = root.getBoundingClientRect().height;
          const previous = window.__qaHeight;
          window.__qaHeight = height;
          return previous === height;
        },
        { timeout: 15000, polling: 400 },
      )
      .catch(() => {});
    await delay(1200);
    // Freeze animations before capturing. The theme layer animates page reveals
    // and the dashboard illustration, so a screenshot taken mid-animation
    // differs run to run and would mask (or fake) a real CSS regression.
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    await delay(400);
    const file = path.join(outDir, `${viewportName}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const bytes = fs.readFileSync(file);
    manifest[`${viewportName}-${name}`] = crypto
      .createHash('sha256')
      .update(bytes)
      .digest('hex');
    console.log(`${viewportName}/${name}: ${bytes.length} bytes`);
  }
  await context.close();
}

await browser.close();
fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);
console.log(`\nwrote ${Object.keys(manifest).length} snapshots to ${outDir}`);
