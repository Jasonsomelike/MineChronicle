import { expect, it } from 'vitest';
import {
  worldGroups,
  worldTicks,
  byPlayTimeDesc,
  byPlayTimeDescWorld,
} from './worlds';
import type { ScanSummary, WorldSummary } from './scan';

const root = String.raw`\\?\D:\Games\.minecraft`;
const report: ScanSummary = {
  instances: ['First', 'Second', 'Third Pack'].map((name) => ({
    name,
    launcher_path: 'D:/PCL',
    instance_path: `D:/Games/versions/${name}`,
    game_root: 'd:/games/.minecraft/',
    minecraft_version: null,
    mod_loader: null,
    isolation: 'shared',
  })),
  roots: [
    {
      path: root,
      requested_paths: [],
      enumeration_complete: true,
      worlds: [
        {
          path: `${root}\\saves\\World`,
          name: 'World',
          status: 'Present',
          data_version: null,
          minecraft_version: null,
          players: [
            {
              uuid: 'player-uuid',
              preferred_name: 'Jasonsomelike',
              name_source: 'manual',
              play_ticks: '1200',
              initial_play_ticks: '1200',
              source_paths: [],
              conflicting: false,
            },
          ],
        },
      ],
    },
  ],
  issues: [],
  cancelled: false,
  saved: true,
  database_path: null,
  last_scan: null,
  historical_ticks: '1200',
};
it('groups instances sharing a canonical Windows root without duplicating worlds', () => {
  const groups = worldGroups(report, '');
  expect(groups).toHaveLength(1);
  expect(groups[0].shared).toBe(true);
  expect(groups[0].worlds).toHaveLength(1);
});
it.each([
  'third pack',
  'Jasonsomelike',
  'PLAYER-UUID',
  'D:/Games/.minecraft/saves/World/',
])(
  'finds worlds by all instance names, players and normalized paths: %s',
  (query) => {
    expect(worldGroups(report, query)).toHaveLength(1);
  },
);
it('does not return unrelated worlds', () => {
  expect(worldGroups(report, 'unrelated')).toHaveLength(0);
});

/**
 * A world with the given per-player tick counts. `null` marks a stats file that could
 * not be read.
 */
const world = (name: string, ticks: (string | null)[]): WorldSummary => ({
  path: `\\?\\D:\\Games\\.minecraft\\saves\\${name}`,
  name,
  status: 'Present',
  data_version: null,
  minecraft_version: null,
  players: ticks.map((play_ticks, index) => ({
    uuid: `uuid-${name}-${index}`,
    preferred_name: null,
    name_source: null,
    play_ticks,
    initial_play_ticks: null,
    source_paths: [],
    conflicting: false,
  })),
});

it('sums only the readable players of a world', () => {
  expect(worldTicks(world('A', ['100', null, '250']))).toBe(350n);
});

it('reads a world whose stats are all unreadable as zero, not as unknown', () => {
  // The caller distinguishes "no readable player" from "zero ticks" by checking
  // `players` itself; the total is 0 so sorting places it last rather than throwing.
  expect(worldTicks(world('A', [null, null]))).toBe(0n);
});

it('orders worlds by play time, longest first', () => {
  // Deliberately unsorted, and named so alphabetical order would give the reverse.
  const aaa = world('AAA', ['20']); // 1s
  const mmm = world('MMM', ['9400']); // 7m 50s
  const zzz = world('ZZZ', ['4000']); // 3m 20s
  const rows = [aaa, mmm, zzz].map((w) => ({ world: w, instanceName: 'x' }));

  expect(rows.sort(byPlayTimeDesc).map((r) => r.world.name)).toEqual([
    'MMM',
    'ZZZ',
    'AAA',
  ]);
});

it('ranks a world with one broken file by what is still readable', () => {
  const broken = world('Broken', [null, '8000']); // 6m 40s readable
  const whole = world('Whole', ['6000']); // 5m
  const rows = [whole, broken].map((w) => ({ world: w, instanceName: 'x' }));

  // Counting the unreadable player as zero would still put Broken first here, so the
  // assertion is on the total, which is what the order is derived from.
  expect(worldTicks(broken)).toBe(8000n);
  expect(rows.sort(byPlayTimeDesc).map((r) => r.world.name)).toEqual([
    'Broken',
    'Whole',
  ]);
});

it('breaks ties by name so the order is stable between reads', () => {
  const b = world('B', ['100']);
  const a = world('A', ['100']);
  const rows = [b, a].map((w) => ({ world: w, instanceName: 'x' }));
  expect(rows.sort(byPlayTimeDesc).map((r) => r.world.name)).toEqual([
    'A',
    'B',
  ]);
});

const plugin = (path: string, ticks: string): WorldSummary => ({
  path,
  name: path.split('\\').pop() ?? path,
  status: 'Present',
  data_version: null,
  minecraft_version: null,
  players: [
    {
      uuid: `uuid-${path}`,
      preferred_name: null,
      name_source: null,
      play_ticks: ticks,
      initial_play_ticks: null,
      source_paths: [],
      conflicting: false,
    },
  ],
});

/** Two roots whose name order is the reverse of their play order. */
const twoRoots = (): ScanSummary => ({
  instances: [],
  roots: [
    {
      path: String.raw`\?\D:\Games\aaa`,
      requested_paths: [],
      enumeration_complete: true,
      worlds: [plugin(String.raw`\?\D:\Games\aaa\saves\one`, '60')],
    },
    {
      path: String.raw`\?\D:\Games\zzz`,
      requested_paths: [],
      enumeration_complete: true,
      worlds: [
        plugin(String.raw`\?\D:\Games\zzz\saves\big`, '90000'),
        plugin(String.raw`\?\D:\Games\zzz\saves\small`, '20'),
      ],
    },
  ],
  issues: [],
  cancelled: false,
  saved: false,
  database_path: null,
  last_scan: null,
  historical_ticks: '0',
});

it('orders folder groups by play time, longest first', () => {
  const groups = worldGroups(twoRoots(), '');
  // "zzz" holds 90000 ticks and "aaa" holds 60. Alphabetically aaa came first, which
  // is what the grouped view used to show.
  expect(groups.map((g) => g.root.path.endsWith('zzz'))).toEqual([true, false]);
});

it('orders the worlds inside a root by play time too', () => {
  const groups = worldGroups(twoRoots(), '');
  const zzz = groups.find((g) => g.root.path.endsWith('zzz'));
  expect(zzz?.worlds.map((w) => w.name)).toEqual(['big', 'small']);
});

it('orders bare worlds the same way the wrapped comparator does', () => {
  const big = plugin(String.raw`\\?\\D:\\zw\\big`, '90000');
  const small = plugin(String.raw`\\?\\D:\\zw\\small`, '20');
  expect([small, big].sort(byPlayTimeDescWorld).map((w) => w.name)).toEqual([
    'big',
    'small',
  ]);
});
