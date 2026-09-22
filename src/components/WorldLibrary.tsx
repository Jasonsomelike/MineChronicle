import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, Search, History, BarChart3 } from 'lucide-react';
import type { ScanSummary, WorldSummary } from '../lib/scan';
import { worldGroups } from '../lib/worlds';
import type { PageId } from '../app/routes';
import { displayPath } from '../lib/path';
import { formatPlayTicks } from '../lib/duration';
import PlayerName from './PlayerName';
import { SecondaryButton, TextButton, Tabs, Pagination } from './ui';
function WorldTotal({ world }: { world: WorldSummary }) {
  const readable = world.players.filter((p) => p.play_ticks !== null);
  const total = readable.reduce(
    (sum, player) => sum + BigInt(player.play_ticks as string),
    0n,
  );
  return (
    <span className="world-total">
      {readable.length ? formatPlayTicks(total.toString()) : '—'}
    </span>
  );
}

function World({
  world,
  instanceName,
  search,
  busy,
  saved,
  open: openProp,
  onOpenChange,
  onSaved,
  onActivity,
}: {
  world: WorldSummary;
  instanceName?: string;
  search: boolean;
  busy: boolean;
  saved: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved: (r: ScanSummary) => void;
  onActivity: (page: PageId, path: string) => void;
}) {
  const [expanded, setExpanded] = useState(search);
  const open = openProp ?? expanded;
  return (
    <details
      className="world-result"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (openProp === undefined) setExpanded(next);
        onOpenChange?.(next);
      }}
    >
      <summary>
        <strong>{world.name}</strong>
        {instanceName ? (
          <span className="world-instance" title={instanceName}>
            {instanceName}
          </span>
        ) : null}
        <WorldTotal world={world} />
        <span className="world-status">
          {world.status === 'Missing'
            ? '目录已缺失 · 历史保留'
            : world.status === 'Degraded'
            ? '元数据缺失或损坏'
            : `${world.players.length} 位玩家`}
        </span>
      </summary>
      {open ? (
        <>
          <p className="world-path">{displayPath(world.path)}</p>
          <p>Minecraft {world.minecraft_version ?? '版本未知'}</p>
          <div className="world-detail-actions">
            <button
              className="text-button"
              onClick={() => onActivity('timeline', world.path)}
            >
              <History size={14} />
              时间线与追踪
            </button>
            <button
              className="text-button"
              onClick={() => onActivity('statistics', world.path)}
            >
              <BarChart3 size={14} />
              更多统计
            </button>
          </div>
          {!world.players.length ? <p>此世界尚无可用的玩家统计。</p> : null}
          {world.players.map((player) => (
            <div key={player.uuid} className="player-result">
              <PlayerName
                player={player}
                disabled={busy || !saved}
                onSaved={onSaved}
              />
              <strong
                title={
                  player.play_ticks === null
                    ? undefined
                    : `${player.play_ticks} ticks`
                }
              >
                {player.play_ticks === null
                  ? player.conflicting
                    ? '来源冲突，等待确认'
                    : '本次未读取到统计'
                  : formatPlayTicks(player.play_ticks)}
              </strong>
              <span>
                {player.source_paths.length} 个统计来源 · 最近存档读数
              </span>
              {player.initial_play_ticks !== null ? (
                <span>
                  首次导入历史：{formatPlayTicks(player.initial_play_ticks)}
                </span>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </details>
  );
}
export default function WorldLibrary({
  report,
  query,
  onQuery,
  busy,
  onSaved,
  onActivity,
}: {
  report: ScanSummary;
  query: string;
  onQuery: (q: string) => void;
  busy: boolean;
  onSaved: (r: ScanSummary) => void;
  onActivity: (page: PageId, path: string) => void;
}) {
  const groups = useMemo(() => worldGroups(report, query), [report, query]);
  const [mode, setMode] = useState<'flat' | 'grouped'>('flat');
  const flatWorlds = useMemo(
    () =>
      groups.flatMap((g) =>
        g.worlds.map((world) => ({ world, instanceName: g.name })),
      ),
    [groups],
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const listCount = mode === 'flat' ? flatWorlds.length : groups.length;
  const pages = Math.max(1, Math.ceil(listCount / pageSize));
  const current = Math.min(page, pages - 1);
  const search = !!query.trim();
  const previousQuery = useRef('');
  useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    setOpen(
      new Set(
        query.trim()
          ? mode === 'flat'
            ? flatWorlds.map((w) => w.world.path)
            : groups.map((g) => g.root.path)
          : [],
      ),
    );
    setPage(0);
  }, [query, groups, flatWorlds, mode]);
  return (
    <section className="world-library" aria-label="世界与玩家">
      <div className="library-heading">
        <h2>世界与玩家</h2>
        <span title="档案总量；搜索时显示匹配结果。实例数与根目录数不是同一概念：多个实例可共用一个有世界的目录。">
          {query.trim() ? '搜索结果' : '档案共'}{' '}
          {groups.reduce((n, g) => n + g.worlds.length, 0)} 个世界 ·{' '}
          {groups.length} 个有世界的目录
        </span>
      </div>
      <div className="library-toolbar">
        <Tabs
          label="世界视图"
          value={mode}
          options={[
            ['flat', '世界列表'],
            ['grouped', '按实例分组'],
          ]}
          onChange={(next) => {
            setMode(next);
            setOpen(
              new Set(
                query.trim()
                  ? next === 'flat'
                    ? flatWorlds.map((w) => w.world.path)
                    : groups.map((g) => g.root.path)
                  : [],
              ),
            );
            setPage(0);
          }}
        />
        <label>
          <Search size={16} />
          <input
            aria-label="查找世界或玩家"
            value={query}
            onChange={(e) => {
              onQuery(e.target.value);
              setPage(0);
            }}
            placeholder="实例、世界、玩家名或 UUID"
          />
        </label>
        {mode === 'grouped' ? (
          <SecondaryButton
            disabled={open.size === 0}
            onClick={() => {
              setOpen(new Set());
              setPage(0);
            }}
          >
            <ChevronsDownUp size={15} />
            全部收起
          </SecondaryButton>
        ) : (
          <SecondaryButton
            disabled={open.size >= flatWorlds.length || !flatWorlds.length}
            onClick={() => {
              setOpen(new Set(flatWorlds.map((w) => w.world.path)));
              setPage(0);
            }}
          >
            全部展开
          </SecondaryButton>
        )}
        {query ? (
          <TextButton
            onClick={() => {
              onQuery('');
              setPage(0);
            }}
          >
            清除搜索
          </TextButton>
        ) : null}
      </div>
      {!listCount ? <p>没有匹配的世界。</p> : null}
      {mode === 'flat'
        ? flatWorlds
            .slice(current * pageSize, current * pageSize + pageSize)
            .map(({ world, instanceName }) => (
              <World
                key={world.path}
                world={world}
                instanceName={instanceName}
                search={search}
                busy={busy}
                saved={report.saved}
                open={open.has(world.path)}
                onOpenChange={(next) =>
                  setOpen((prev) => {
                    const copy = new Set(prev);
                    if (next) copy.add(world.path);
                    else copy.delete(world.path);
                    return copy;
                  })
                }
                onSaved={onSaved}
                onActivity={onActivity}
              />
            ))
        : groups
            .slice(current * pageSize, current * pageSize + pageSize)
            .map((group) => {
              const expanded = open.has(group.root.path);
              return (
                <details
                  key={group.root.path}
                  className="world-group"
                  open={expanded}
                  onToggle={(e) => {
                    const expanded = e.currentTarget.open;
                    setOpen((prev) => {
                      if (prev.has(group.root.path) === expanded) return prev;
                      const next = new Set(prev);
                      if (expanded) next.add(group.root.path);
                      else next.delete(group.root.path);
                      return next;
                    });
                  }}
                >
                  <summary>
                    <strong>{group.name}</strong>
                    <span>
                      {group.shared ? '共享根目录 · ' : ''}
                      {group.worlds.length} 个世界
                    </span>
                  </summary>
                  {expanded ? (
                    <div className="world-group-content">
                      <p className="world-path">
                        {displayPath(group.root.path)}
                      </p>
                      {group.worlds.map((world) => (
                        <World
                          key={world.path}
                          world={world}
                          search={search}
                          busy={busy}
                          saved={report.saved}
                          onSaved={onSaved}
                          onActivity={onActivity}
                        />
                      ))}
                    </div>
                  ) : null}
                </details>
              );
            })}
      {pages > 1 ? (
        <Pagination
          page={current}
          pages={pages}
          onPrev={() => setPage(current - 1)}
          onNext={() => setPage(current + 1)}
          onJump={setPage}
        />
      ) : null}
    </section>
  );
}
