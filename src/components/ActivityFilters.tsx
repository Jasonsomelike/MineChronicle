import type { ScanSummary } from '../lib/scan';
import type { ActivityScope } from '../lib/activity';
import { displayPath, pathKey } from '../lib/path';
import PlayerPicker from './PlayerPicker';
import CombinationPicker from './CombinationPicker';
export default function ActivityFilters({
  report,
  scope,
  onChange,
}: {
  report: ScanSummary;
  scope: ActivityScope;
  onChange: (s: ActivityScope) => void;
}) {
  const roots = report.roots.filter((r) => r.worlds.length);
  const selectedRoots =
    scope.game_roots ?? (scope.game_root ? [scope.game_root] : null);
  const instances = report.instances.map((i) => ({
    id: i.instance_path,
    label: i.name,
    detail: displayPath(i.game_root),
    root:
      roots.find((r) => pathKey(r.path) === pathKey(i.game_root))?.path ??
      i.game_root,
  }));
  for (const root of roots)
    if (!instances.some((i) => pathKey(i.root) === pathKey(root.path)))
      instances.push({
        id: root.path,
        label: displayPath(root.path).split(/[\\/]/).at(-1) ?? root.path,
        detail: displayPath(root.path),
        root: root.path,
      });
  const uniqueInstances = instances.filter(
    (i, n) => instances.findIndex((j) => j.id === i.id) === n,
  );
  const selectedInstances =
    scope.instance_paths !== undefined
      ? scope.instance_paths
      : selectedRoots === null
      ? null
      : uniqueInstances
          .filter((i) => selectedRoots.includes(i.root))
          .map((i) => i.id);
  const worlds = roots
    .filter((r) => selectedRoots === null || selectedRoots.includes(r.path))
    .flatMap((r) => r.worlds);
  const selectedWorlds =
    scope.world_paths ?? (scope.world_path ? [scope.world_path] : null);
  return (
    <div className="activity-filters">
      <CombinationPicker
        label="实例"
        options={uniqueInstances}
        value={selectedInstances}
        onChange={(instance_paths) => {
          const game_roots =
            instance_paths === null
              ? null
              : [
                  ...new Set(
                    uniqueInstances
                      .filter((i) => instance_paths.includes(i.id))
                      .map((i) => i.root),
                  ),
                ];
          const available = new Set(
            roots
              .filter((r) => game_roots === null || game_roots.includes(r.path))
              .flatMap((r) => r.worlds.map((w) => w.path)),
          );
          onChange({
            ...scope,
            game_root: '',
            world_path: '',
            game_roots,
            instance_paths,
            world_paths:
              selectedWorlds?.filter((p) => available.has(p)) ?? null,
          });
        }}
      />
      <CombinationPicker
        label="世界"
        options={worlds.map((w) => ({
          id: w.path,
          label: w.name,
          detail: displayPath(w.path),
        }))}
        value={selectedWorlds}
        onChange={(world_paths) =>
          onChange({ ...scope, world_path: '', world_paths })
        }
      />
      <PlayerPicker
        report={report}
        value={scope.uuids}
        none={scope.players_none}
        onChange={(uuids, players_none) =>
          onChange({ ...scope, uuids, players_none })
        }
      />
    </div>
  );
}
