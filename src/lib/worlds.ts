import type { ScanSummary, WorldSummary } from './scan';
import { pathKey, displayPath } from './path';
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
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'zh-CN') ||
        a.root.path.localeCompare(b.root.path),
    );
}
