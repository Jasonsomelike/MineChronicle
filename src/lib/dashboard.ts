import type { ScanSummary } from './scan';
import { displayPath } from './path';
import { selectedPlayer } from './players';
import type { PlayerSelection } from './players';

export type Ranking = {
  name: string;
  path: string;
  ticks: bigint;
  shared: number;
  missing: boolean;
};

/** The two slices the ranking panel can show. */
export type RankingDimension = 'worlds' | 'instances';

/**
 * The switch's two labels.
 *
 * Each tab label is a prefix of the heading of the list it opens: 「世界排行」
 * opens a list headed 「世界排行」, 「实例排行」 opens one headed
 * 「实例排行 · 按根目录汇总」. The panel heading is allowed to say more than the
 * tab; it is not allowed to say something else.
 */
export const RANKING_TABS: Record<RankingDimension, string> = {
  worlds: '世界排行',
  instances: '实例排行',
};

/** Panel headings for the list under each tab. */
export const RANKING_TITLES: Record<RankingDimension, string> = {
  worlds: RANKING_TABS.worlds,
  instances: `${RANKING_TABS.instances} · 按根目录汇总`,
};

/**
 * Which list belongs under which tab.
 *
 * The dashboard's ranking switch and the panel under it used to be wired by
 * hand, and the two sides were crossed: choosing 世界排行 lit the worlds pill
 * but rendered the root/instance list, while the panel heading disagreed with
 * both. A single mapping is the only thing that can keep the three in step, so
 * the tab and the panel are now read from the same value.
 *
 * The panel whose `dimension` matches is the selected one, and it is also the
 * slice the playtime ruler plots: the ruler is the chosen dimension, and the
 * list below is that same dimension spelled out.
 */
export function rankingPanel(
  dimension: RankingDimension,
  data: { worlds: Ranking[]; roots: Ranking[] },
): Array<{
  dimension: RankingDimension;
  active: boolean;
  title: string;
  rows: Ranking[];
}> {
  const rowsOf = (d: RankingDimension) =>
    d === 'worlds' ? data.worlds : data.roots;
  return (['worlds', 'instances'] as const).map((d) => ({
    dimension: d,
    active: d === dimension,
    title: RANKING_TITLES[d],
    rows: rowsOf(d),
  }));
}

export function pathKey(path: string) {
  return displayPath(path).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}
export function summarize(report: ScanSummary, uuid: PlayerSelection = '') {
  const players = new Map<string, string>();
  const worlds: Ranking[] = [];
  const roots: Ranking[] = [];
  let historical = 0n,
    current = 0n,
    unreadable = 0,
    missing = 0;
  const seenWorlds = new Set<string>();
  for (const root of report.roots) {
    let rootTicks = 0n;
    const instances = report.instances.filter(
      (i) => pathKey(i.game_root) === pathKey(root.path),
    );
    for (const world of root.worlds) {
      if (seenWorlds.has(pathKey(world.path))) continue;
      seenWorlds.add(pathKey(world.path));
      let ticks = 0n;
      let matched = false;
      const seenPlayers = new Set<string>();
      for (const player of world.players) {
        players.set(player.uuid, player.preferred_name ?? player.uuid);
        if (!selectedPlayer(player.uuid, uuid) || seenPlayers.has(player.uuid))
          continue;
        seenPlayers.add(player.uuid);
        matched = true;
        if (player.initial_play_ticks !== null)
          historical += BigInt(player.initial_play_ticks);
        if (player.play_ticks !== null && world.status !== 'Missing') {
          current += BigInt(player.play_ticks);
          ticks += BigInt(player.play_ticks);
        } else unreadable++;
      }
      if (
        !matched &&
        (uuid === null || (typeof uuid === 'string' ? !!uuid : uuid.length > 0))
      )
        continue;
      rootTicks += ticks;
      if (world.status === 'Missing') missing++;
      worlds.push({
        name: world.name,
        path: world.path,
        ticks,
        shared: 0,
        missing: world.status === 'Missing',
      });
    }
    if (rootTicks > 0n)
      roots.push({
        name: instances.length
          ? instances.map((i) => i.name).join(' / ')
          : displayPath(root.path).split(/[\\/]/).pop() ?? root.path,
        path: root.path,
        ticks: rootTicks,
        shared: instances.length,
        missing: false,
      });
  }
  const sort = (a: Ranking, b: Ranking) =>
    a.ticks === b.ticks
      ? a.path.localeCompare(b.path)
      : a.ticks > b.ticks
      ? -1
      : 1;
  return {
    historical,
    current,
    unreadable,
    missing,
    players: [...players].sort((a, b) => a[1].localeCompare(b[1])),
    worlds: worlds.sort(sort),
    roots: roots.sort(sort),
  };
}
