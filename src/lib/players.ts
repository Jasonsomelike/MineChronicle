import type { ScanSummary } from './scan';

export type PlayerSelection = string | readonly string[] | null;
export function selectedPlayer(uuid: string, selection: PlayerSelection) {
  return selection === null
    ? false
    : typeof selection === 'string'
    ? !selection || selection === uuid
    : !selection.length || selection.includes(uuid);
}
export function playerOptions(report: ScanSummary) {
  const names = new Map<string, string>();
  for (const root of report.roots)
    for (const world of root.worlds)
      for (const player of world.players)
        if (player.preferred_name || !names.has(player.uuid))
          names.set(player.uuid, player.preferred_name ?? player.uuid);
  return [...names].sort((a, b) => a[1].localeCompare(b[1]));
}
export function initialPlayers(): string[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem('minechronicle.players') ?? 'null',
    );
    if (
      Array.isArray(saved) &&
      saved.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
    )
      return [...new Set(saved)];
  } catch {
    /* A unavailable local preference must not prevent opening the archive. */
  }
  return [];
}
export function initialPlayersNone() {
  try {
    return localStorage.getItem('minechronicle.players-none') === 'true';
  } catch {
    return false;
  }
}
export function savePlayers(ids: string[], none = false) {
  try {
    localStorage.setItem('minechronicle.players', JSON.stringify(ids));
    localStorage.setItem('minechronicle.players-none', JSON.stringify(none));
  } catch {
    /* Optional preference storage. */
  }
}
