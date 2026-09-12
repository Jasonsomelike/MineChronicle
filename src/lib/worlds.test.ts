import { expect, it } from 'vitest';
import { worldGroups } from './worlds';
import type { ScanSummary } from './scan';

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
