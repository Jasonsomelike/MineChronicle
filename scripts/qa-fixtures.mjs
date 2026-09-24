// Synthetic local fixtures for Playwright. No user archive is read.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The version the frontend expects, read from package.json rather than copied.
 *
 * `runtimeInfo()` in src/lib/scan.ts throws when the backend reports a different
 * version than FRONTEND_VERSION, which is correct behaviour - it catches a stale
 * binary. A literal here breaks that on every release: bumping the app to 0.10.16
 * left this fixture reporting 0.10.15, so the settings page rendered an error
 * instead of the archive block and qa-reliability-flow failed on an element that
 * could never appear. Reading the real value removes the whole failure mode.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const APP_VERSION = JSON.parse(
  readFileSync(join(here, '..', 'package.json'), 'utf8'),
).version;

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
      // A merged, mixed span: the shape the backend returns when a session opening
      // (an import and a rollback) joins the increments that follow it. Without one
      // in the fixture the mixed-row UI is never rendered, so a regression in the
      // composition line, the span or the expansion would go unseen.
      id: 4,
      kind: 'mixed',
      observed_at: '2026-09-17T12:04:25.000Z',
      first_observed_at: '2026-09-17T11:18:18.000Z',
      world_path: 'D:\\QA\\root\\saves\\QA World',
      world_name: 'QA World',
      uuid: UUID_A,
      player_name: 'Jasonsomelike',
      play_ticks: '104340000',
      delta_ticks: '55340',
      old_ticks: null,
      merged_count: 4,
      kinds: [
        { kind: 'increment', count: 2 },
        { kind: 'rollback', count: 1 },
        { kind: 'initial_import', count: 1 },
      ],
      parts: [
        {
          observed_at: '2026-09-17T11:18:18.000Z',
          delta_ticks: '0',
          kind: 'initial_import',
        },
        {
          observed_at: '2026-09-17T11:20:18.000Z',
          delta_ticks: '0',
          kind: 'rollback',
          old_ticks: '60',
        },
        {
          observed_at: '2026-09-17T11:23:18.000Z',
          delta_ticks: '27670',
          kind: 'increment',
        },
        {
          observed_at: '2026-09-17T12:04:25.000Z',
          delta_ticks: '27670',
          kind: 'increment',
        },
      ],
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
  total: 4,
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
      pseudo_seconds: '8100',
    },
    {
      id: 2,
      game_root: 'D:\\QA\\server',
      instance_name: '香草纪元：食旅纪行',
      started_at: '2026-09-17T10:17:48.000Z',
      ended_at: '2026-09-17T12:37:00.000Z',
      status: 'closed',
      pseudo_seconds: '8352',
    },
    {
      // No observed end: the row must show a dash rather than a number, and the
      // total line must say the duration could not be measured.
      id: 3,
      game_root: 'D:\\QA\\server',
      instance_name: '香草纪元：食旅纪行',
      started_at: '2026-09-18T04:39:43.000Z',
      ended_at: null,
      status: 'interrupted',
      pseudo_seconds: '0',
    },
    {
      // Filled in by hand: must carry the 手动 marker and offer an undo, so the
      // value cannot be mistaken for one the observer recorded.
      id: 4,
      game_root: 'D:\\QA\\server',
      instance_name: '香草纪元：食旅纪行',
      started_at: '2026-09-18T21:52:20.000Z',
      ended_at: '2026-09-18T23:07:49.000Z',
      status: 'closed',
      pseudo_seconds: '4530',
      ended_source: 'manual',
      edited_at: '2026-09-19T08:00:00.000Z',
    },
    {
      // A live session: the observer owns its end, so the row offers no edit.
      id: 5,
      game_root: 'D:\\QA\\live',
      instance_name: '正在运行的实例',
      started_at: '2026-09-19T23:10:00.000Z',
      ended_at: null,
      status: 'running',
      pseudo_seconds: '0',
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
  pseudo: [
    {
      game_root: 'D:\\QA\\server',
      instance_name: '香草纪元：食旅纪行',
      seconds: '16452',
      week_seconds: '8352',
      month_seconds: '16452',
      sessions: 2,
      unknown_sessions: 1,
    },
    {
      game_root: 'D:\\QA\\root',
      instance_name: 'QA Instance',
      seconds: '8100',
      week_seconds: '0',
      month_seconds: '8100',
      sessions: 1,
      unknown_sessions: 0,
    },
  ],
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

export const backend = {
  load_library: library,
  runtime_info: {
    version: APP_VERSION,
    executable: 'D:\\QA\\minechronicle.exe',
    database_path: 'D:\\QA\\archive.sqlite3',
    embedded_assets: true,
    pcl_instances: 1,
  },
  tracking_status: trackingStatus,
  tracking_summary: trackingSummary,
  observed_sessions: trackingSummary.sessions,
  observed_sessions_page: {
    sessions: trackingSummary.sessions,
    // Derived from the rows above so the summary and the table cannot disagree
    // in the fixture, which would hide a real mismatch in the UI.
    total: trackingSummary.sessions.length,
    page: 1,
    page_size: 20,
    total_seconds: String(
      trackingSummary.sessions.reduce(
        (sum, s) => sum + Number(s.pseudo_seconds ?? 0),
        0,
      ),
    ),
    unknown_sessions: trackingSummary.sessions.filter((s) => !s.ended_at)
      .length,
    baseline_sessions: 0,
    running_sessions: trackingSummary.sessions.filter(
      (s) => s.status === 'running',
    ).length,
  },
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

/**
 * The same backend with enough worlds to paginate the world library.
 *
 * `WorldLibrary` shows 12 rows a page, and the shared fixture holds three worlds,
 * so `<Pagination>` never renders there and the pager's two states cannot be
 * measured on the route the user actually reported. This is the shared fixture
 * plus 21 synthetic worlds, and nothing else: `backend` itself is left alone, so
 * a suite that does not ask for pages keeps seeing three worlds.
 */
export const pagedBackend = (() => {
  const rows = backend.load_library.report.roots[0];
  const template = rows.worlds[0];
  const worlds = Array.from({ length: 21 }, (_, i) => ({
    ...template,
    path: `D:\\QA\\root\\saves\\Page World ${i + 1}`,
    name: `Page World ${i + 1}`,
    status: 'Present',
    players: template.players.map((p, index) => ({
      ...p,
      play_ticks: String(40_000_000 - i * 1_500_000 - index * 1000),
      initial_play_ticks: String(40_000_000 - i * 1_500_000 - index * 1000),
    })),
  }));
  return {
    ...backend,
    load_library: {
      ...backend.load_library,
      report: {
        ...backend.load_library.report,
        roots: [{ ...rows, worlds: [...rows.worlds, ...worlds] }],
      },
    },
  };
})();
