import type { ScanSummary, WorldSummary } from './scan';
import { pathKey, displayPath } from './path';

/**
 * Total play ticks across a world's readable players.
 *
 * Players whose stats could not be read are skipped rather than counted as zero, so a
 * world with one broken file does not sort as though it had never been played.
 */
export function worldTicks(world: WorldSummary): bigint {
  return world.players
    .filter((p) => p.play_ticks !== null)
    .reduce((sum, player) => sum + BigInt(player.play_ticks as string), 0n);
}

/**
 * Longest play time first.
 *
 * The list used to inherit `worldGroups`' order, which is alphabetical by root name.
 * On a real archive that put a 47-hour world below a two-minute one, so the page
 * could not answer the question it exists to answer. Ties fall back to the name so
 * the order does not reshuffle between reads.
 */
export function byPlayTimeDesc<T extends { world: WorldSummary }>(
  a: T,
  b: T,
): number {
  const delta = worldTicks(b.world) - worldTicks(a.world);
  if (delta !== 0n) return delta > 0n ? 1 : -1;
  return a.world.name.localeCompare(b.world.name, 'zh-CN');
}

/** The same ordering for a bare world, for lists not wrapped in a row object. */
export function byPlayTimeDescWorld(a: WorldSummary, b: WorldSummary): number {
  const delta = worldTicks(b) - worldTicks(a);
  if (delta !== 0n) return delta > 0n ? 1 : -1;
  return a.name.localeCompare(b.name, 'zh-CN');
}

export function worldGroups(report: ScanSummary, query: string) {
  const text = pathKey(query.trim());
  const instances = new Map<string, string[]>();
  for (const instance of report.instances) {
    const key = pathKey(instance.game_root);
    instances.set(key, [...(instances.get(key) ?? []), instance.name]);
  }
  return report.roots
    .map((root) => {
      const names = [...new Set(instances.get(pathKey(root.path)) ?? [])];
      const name = names.length
        ? names.slice(0, 2).join(' / ') +
          (names.length > 2 ? ` 等 ${names.length} 个实例` : '')
        : displayPath(root.path).split(/[\\/]/).filter(Boolean).at(-1) ??
          '手动目录';
      const matches = (world: WorldSummary) =>
        [
          name,
          ...names,
          root.path,
          displayPath(root.path),
          world.name,
          world.path,
          displayPath(world.path),
          ...world.players.flatMap((p) => [p.uuid, p.preferred_name ?? '']),
        ].some((value) => pathKey(value).includes(text));
      return {
        root,
        name,
        shared: names.length > 1,
        worlds: root.worlds.filter(matches),
      };
    })
    .filter((g) => g.worlds.length)
    .map((g) => ({
      ...g,
      // Longest first inside a root as well, so the grouped view reads the same way the
      // flat one does instead of falling back to whatever order the scan produced.
      worlds: [...g.worlds].sort(byPlayTimeDescWorld),
      ticks: g.worlds.reduce((sum, world) => sum + worldTicks(world), 0n),
    }))
    .sort((a, b) => {
      // Longest first, by the root's total. This sorted by name, which on a real
      // archive buried the folders holding the play time under folders holding one
      // world each.
      const delta = b.ticks - a.ticks;
      if (delta !== 0n) return delta > 0n ? 1 : -1;
      return (
        a.name.localeCompare(b.name, 'zh-CN') ||
        a.root.path.localeCompare(b.root.path)
      );
    });
}
