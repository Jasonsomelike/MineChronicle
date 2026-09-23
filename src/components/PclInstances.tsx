import { useState } from 'react';
import type { PclLink, ScanSummary } from '../lib/scan';
import { displayPath, pathKey } from '../lib/path';
import { worldTicks } from '../lib/worlds';
import { formatPlayTicks } from '../lib/duration';
import { ArrowUpRight } from 'lucide-react';
import type { PclSyncStatus } from '../lib/pclSync';
import type { TrackingSummary } from '../lib/tracking';
import { formatSeconds } from '../lib/duration';

export function folderOf(path: string) {
  return pathKey(path)
    .replace(/\/versions\/[^/]+\/?$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}
export default function PclInstances({
  report,
  link,
  sync,
  tracking,
  onOpen,
}: {
  report: ScanSummary;
  link: PclLink | null;
  sync: PclSyncStatus | null;
  tracking: TrackingSummary | null;
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  /**
   * Which folder groups the reader has opened. The first one starts open on arrival:
   * collapsed, the page showed a heading, a search field and a single grey line, so
   * the worlds inside each folder were invisible and the page read as a form with
   * nothing in it. Measured, opening the first group takes the page from 534px of
   * content to 835px, which is what it actually holds.
   */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const searching = !!query.trim();
  const needle = query.trim().toLowerCase();
  const matchesQuery = (i: ScanSummary['instances'][number]) =>
    `${i.name} ${i.minecraft_version ?? ''} ${i.mod_loader?.name ?? ''}`
      .toLowerCase()
      .includes(needle);
  const groups = new Map<
    string,
    { name: string; path: string; instances: ScanSummary['instances'] }
  >();
  for (const folder of link?.folders ?? [])
    groups.set(folderOf(folder.path), {
      name: folder.name,
      path: folder.path,
      instances: [],
    });
  for (const instance of report.instances) {
    const key = folderOf(instance.instance_path);
    if (!groups.has(key))
      groups.set(key, {
        name:
          displayPath(instance.instance_path)
            .split(/[\\/]/)
            .slice(0, -3)
            .pop() ?? '游戏文件夹',
        path: displayPath(instance.instance_path).replace(
          /[\\/]versions[\\/][^\\/]+$/i,
          '',
        ),
        instances: [],
      });
    groups.get(key)?.instances.push(instance);
  }
  /**
   * Play ticks reachable through a game root. Two instances on the same root share
   * these worlds, so callers dedupe by root before summing rather than adding each
   * instance's figure.
   */
  const ticksForRoot = (gameRoot: string) =>
    (
      report.roots.find((r) => pathKey(r.path) === pathKey(gameRoot))?.worlds ??
      []
    ).reduce((sum, world) => sum + worldTicks(world), 0n);
  const groupTicks = (instances: ScanSummary['instances']) => {
    const seen = new Set<string>();
    let sum = 0n;
    for (const instance of instances) {
      const key = pathKey(instance.game_root);
      if (seen.has(key)) continue;
      seen.add(key);
      sum += ticksForRoot(instance.game_root);
    }
    return sum;
  };
  /** Longest first; ties fall back to the name so the list is stable. */
  const orderedGroups = [...groups.entries()]
    .map(([key, group]) => ({
      key,
      group,
      ticks: groupTicks(group.instances),
      instances: [...group.instances].sort((a, b) => {
        const delta = ticksForRoot(b.game_root) - ticksForRoot(a.game_root);
        if (delta !== 0n) return delta > 0n ? 1 : -1;
        return a.name.localeCompare(b.name, 'zh-CN');
      }),
    }))
    .sort((a, b) => {
      const delta = b.ticks - a.ticks;
      if (delta !== 0n) return delta > 0n ? 1 : -1;
      return a.group.name.localeCompare(b.group.name, 'zh-CN');
    });

  /**
   * Pseudo-server seconds per game root: time an instance was observed running while
   * none of its worlds progressed, which is play whose statistics the archive cannot
   * see. Keyed by normalised root because that is what the instance rows group on.
   */
  const pseudoByRoot = new Map<string, bigint>();
  for (const entry of tracking?.pseudo ?? []) {
    if (!entry.seconds) continue;
    const key = pathKey(entry.game_root);
    pseudoByRoot.set(
      key,
      (pseudoByRoot.get(key) ?? 0n) + BigInt(entry.seconds),
    );
  }
  const pseudoFor = (gameRoot: string) =>
    pseudoByRoot.get(pathKey(gameRoot)) ?? 0n;

  const matchedCount = report.instances.filter(matchesQuery).length;
  const total = report.instances.length;
  return (
    <section className="pcl-instances" aria-label="PCL 实例">
      <h2>PCL 实例 · {report.instances.length} 个</h2>
      <p>
        按游戏文件夹分组。共享同一根目录的实例只统计一次世界；实例列表为最近保存结果。
      </p>
      <label>
        搜索实例
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名称、Minecraft 版本或加载器"
        />
      </label>
      {orderedGroups.map(({ key, group, ticks, instances }, index) => {
        const matches = instances.filter(matchesQuery);
        if (searching && !matches.length) return null;
        return (
          <details
            key={key}
            className="folder-group"
            // Searching forces every group open so a match can never hide behind a
            // closed disclosure; otherwise the reader's own choice wins, defaulting
            // to open for the first group only.
            open={searching || (opened[key] ?? index === 0)}
            onToggle={(event) => {
              if (searching) return;
              const isOpen = (event.currentTarget as HTMLDetailsElement).open;
              setOpened((previous) => ({ ...previous, [key]: isOpen }));
            }}
          >
            <summary>
              {group.name} · {group.instances.length} 个实例
              {ticks > 0n ? (
                <span className="folder-ticks">
                  {formatPlayTicks(ticks.toString())}
                </span>
              ) : null}
            </summary>
            <p className="world-path">{displayPath(group.path)}</p>
            {!group.instances.length ? (
              <p>
                此文件夹尚未完成实例识别。已保存的世界仍保留，可重新扫描同步。
              </p>
            ) : null}
            {matches.map((instance) => {
              const root = report.roots.find(
                (r) => pathKey(r.path) === pathKey(instance.game_root),
              );
              return (
                <article key={instance.instance_path} className="instance-row">
                  <strong>{instance.name}</strong>
                  {(() => {
                    const ticks = ticksForRoot(instance.game_root);
                    return ticks > 0n ? (
                      <span className="instance-ticks">
                        {formatPlayTicks(ticks.toString())}
                      </span>
                    ) : null;
                  })()}
                  {sync?.last_checked &&
                  !sync.issues.length &&
                  !sync.current_instances.some(
                    (p) => pathKey(p) === pathKey(instance.instance_path),
                  ) ? (
                    <span className="scan-note"> · 配置中已移除，历史保留</span>
                  ) : null}
                  <p>
                    Minecraft {instance.minecraft_version ?? '未知'} ·{' '}
                    {instance.mod_loader
                      ? `${instance.mod_loader.name} ${
                          instance.mod_loader.version ?? ''
                        }`
                      : '原版 / 未识别加载器'}{' '}
                    ·{' '}
                    {instance.isolation === 'isolated'
                      ? '独立游戏目录'
                      : instance.isolation === 'shared'
                      ? '共享游戏目录'
                      : '按实例配置'}
                  </p>
                  <p className="world-path">
                    游戏根目录：{displayPath(instance.game_root)}
                  </p>
                  {(() => {
                    const seconds = pseudoFor(instance.game_root);
                    if (seconds <= 0n) return null;
                    // Labelled in full rather than shown as a bare duration: this is
                    // wall-clock time with no world progress, not play time the
                    // statistics recorded, and the two must not be confused.
                    return (
                      <p className="instance-pseudo">
                        伪服务器时长{' '}
                        <span className="instance-pseudo-value">
                          {formatSeconds(seconds.toString())}
                        </span>
                        <span className="scan-note">
                          {' '}
                          · 实例运行但世界无进度，统计不在本档案内
                        </span>
                      </p>
                    );
                  })()}
                  {root?.worlds.length ? (
                    <ul className="instance-worlds">
                      {root.worlds.map((w) => (
                        <li key={w.path}>
                          <span className="instance-world-name">{w.name}</span>
                          {w.status === 'Missing' ? (
                            <span className="scan-note">已缺失</span>
                          ) : w.status === 'Degraded' ? (
                            <span className="scan-note">读取降级</span>
                          ) : (
                            <span className="instance-world-players">
                              {w.players.length} 位玩家
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="scan-note">此根目录下尚未发现世界。</p>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpen(instance.game_root)}
                  >
                    <ArrowUpRight size={14} />
                    查看世界 · {root?.worlds.length ?? 0} 个
                  </button>
                </article>
              );
            })}
          </details>
        );
      })}
      {!searching && !total ? (
        <div className="list-empty" role="status">
          <strong>尚未识别到 PCL 实例</strong>
          <p>
            在「导入与设置」关联 PCL
            文件夹并扫描后，实例会出现在这里。已保存的历史统计不会被删除。
          </p>
        </div>
      ) : searching && !matchedCount ? (
        <div className="list-empty" role="status">
          <strong>没有匹配的实例</strong>
          <p>可清除搜索，或到「导入与设置」重新扫描。</p>
        </div>
      ) : (
        <div className="list-meta">
          <span className="list-result-count">
            共 {searching ? matchedCount : total} 个实例
            {searching ? ` · 档案共 ${total} 个` : ''}
          </span>
          {report.saved && report.database_path ? (
            <p className="world-path">
              档案：{displayPath(report.database_path)}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
