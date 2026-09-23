import { describe, it, expect } from 'vitest';
import {
  summarize,
  rankingPanel,
  RANKING_TABS,
  RANKING_TITLES,
} from './dashboard';
import type { Ranking } from './dashboard';
import type { ScanSummary, PlayerSummary } from './scan';
const player = (uuid: string, ticks: string): PlayerSummary => ({
  uuid,
  preferred_name: uuid === 'one' ? 'Builder' : null,
  name_source: null,
  initial_play_ticks: ticks,
  play_ticks: ticks,
  conflicting: false,
  source_paths: [],
});
function fixture(): ScanSummary {
  return {
    instances: ['A', 'B'].map((name) => ({
      name,
      instance_path: `D:/game/versions/${name}`,
      game_root: 'D:/game',
      launcher_path: 'D:/launcher',
      minecraft_version: null,
      mod_loader: null,
      isolation: 'shared',
    })),
    roots: [
      {
        path: 'D:/game',
        requested_paths: [],
        enumeration_complete: true,
        worlds: [
          {
            path: 'D:/game/saves/world',
            name: 'Same name',
            status: 'Present',
            data_version: null,
            minecraft_version: null,
            players: [
              player('one', '9223372036854775807'),
              player('two', '364'),
            ],
          },
        ],
      },
    ],
    issues: [],
    saved: true,
    cancelled: false,
    database_path: null,
    last_scan: null,
    historical_ticks: '9223372036854776171',
  };
}
describe('career dashboard aggregation', () => {
  it('preserves large tick totals and combines shared instances once', () => {
    const result = summarize(fixture());
    expect(result.historical).toBe(9223372036854776171n);
    expect(result.current).toBe(result.historical);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].shared).toBe(2);
    expect(result.worlds).toHaveLength(1);
  });
  it('filters by UUID while preserving the full player selector', () => {
    const result = summarize(fixture(), 'two');
    expect(result.historical).toBe(364n);
    expect(result.players).toHaveLength(2);
    expect(summarize(fixture(), 'missing').worlds).toHaveLength(0);
  });
  it('keeps missing history but excludes missing and unreadable current counters', () => {
    const report = fixture();
    report.roots[0].worlds[0].status = 'Missing';
    const result = summarize(report);
    expect(result.current).toBe(0n);
    expect(result.historical).toBe(9223372036854776171n);
    expect(result.missing).toBe(1);
    report.roots[0].worlds[0].status = 'Present';
    report.roots[0].worlds[0].players[0].play_ticks = null;
    expect(summarize(report).current).toBe(364n);
    expect(summarize(report).unreadable).toBe(1);
  });
  it('deduplicates canonical path aliases but keeps same-named different worlds', () => {
    const report = fixture();
    const other = structuredClone(report.roots[0]);
    other.worlds[0].path = '\\\\?\\d:\\GAME\\saves\\world';
    report.roots.push(other);
    expect(summarize(report).worlds).toHaveLength(1);
    other.worlds[0].path = 'D:/game/saves/another';
    expect(summarize(report).worlds).toHaveLength(2);
  });
  it('handles empty archives without inventing records', () => {
    const report = fixture();
    report.roots = [];
    report.instances = [];
    expect(summarize(report)).toMatchObject({
      historical: 0n,
      current: 0n,
      worlds: [],
      roots: [],
      players: [],
    });
  });
  it('ranks by current values and combines selected UUIDs only once', () => {
    const report = fixture();
    report.roots[0].worlds[0].players[0].play_ticks = '20';
    const result = summarize(report, ['one', 'two', 'one']);
    expect(result.current).toBe(384n);
    expect(result.worlds[0].ticks).toBe(384n);
    expect(result.roots[0].ticks).toBe(384n);
    expect(result.historical).toBe(9223372036854776171n);
  });
  it('keeps every world and instance ranking beyond the first two pages', () => {
    const report = fixture();
    report.roots = Array.from({ length: 13 }, (_, index) => {
      const path = `D:/instances/instance-${index}`;
      return {
        ...report.roots[0],
        path,
        worlds: [
          {
            ...report.roots[0].worlds[0],
            path: `${path}/saves/world`,
            name: `World ${index}`,
            players: [player('one', String((index + 1) * 20))],
          },
        ],
      };
    });
    report.instances = report.roots.map((root, index) => ({
      ...report.instances[0],
      game_root: root.path,
      instance_path: root.path,
      name: `Instance ${index}`,
    }));
    const result = summarize(report, ['one']);
    for (const ranking of [result.worlds, result.roots]) {
      expect(ranking).toHaveLength(13);
      expect(ranking.map((entry) => entry.ticks)).toEqual(
        Array.from({ length: 13 }, (_, index) => BigInt((13 - index) * 20)),
      );
      expect(new Set(ranking.map((entry) => entry.path)).size).toBe(13);
    }
  });
});

/**
 * The dashboard's ranking switch shipped crossed: the 世界排行 pill was lit while
 * the panel beneath it was headed 实例排行 · 按根目录汇总 and listed instances.
 * These lock the three together.
 */
describe('ranking panel wiring', () => {
  const rows = (name: string): Ranking[] => [
    { name, path: `D:/x/${name}`, ticks: 1n, shared: 0, missing: false },
  ];
  const data = { worlds: rows('a world'), roots: rows('an instance') };

  it('gives the selected tab the list that matches its label', () => {
    for (const dimension of ['worlds', 'instances'] as const) {
      const panels = rankingPanel(dimension, data);
      const selected = panels.filter((panel) => panel.active);
      expect(selected).toHaveLength(1);
      expect(selected[0].dimension).toBe(dimension);
      expect(selected[0].title).toBe(RANKING_TITLES[dimension]);
      expect(selected[0].rows).toBe(
        dimension === 'worlds' ? data.worlds : data.roots,
      );
    }
  });

  it('leaves exactly one panel active, and never the other one', () => {
    for (const dimension of ['worlds', 'instances'] as const) {
      const panels = rankingPanel(dimension, data);
      expect(panels.map((panel) => panel.active)).toEqual(
        panels.map((panel) => panel.dimension === dimension),
      );
    }
  });

  it('never heads the worlds list with the instance title, or the reverse', () => {
    const worlds = rankingPanel('worlds', data).find((panel) => panel.active)!;
    const instances = rankingPanel('instances', data).find(
      (panel) => panel.active,
    )!;
    expect(worlds.title).not.toBe(RANKING_TITLES.instances);
    expect(instances.title).not.toBe(RANKING_TITLES.worlds);
    expect(worlds.rows[0].name).toBe('a world');
    expect(instances.rows[0].name).toBe('an instance');
  });

  it('heads each panel with its own tab label, extended but not contradicted', () => {
    for (const dimension of ['worlds', 'instances'] as const) {
      expect(
        RANKING_TITLES[dimension].startsWith(RANKING_TABS[dimension]),
      ).toBe(true);
    }
  });
});
