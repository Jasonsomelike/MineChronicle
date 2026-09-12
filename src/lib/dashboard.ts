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
