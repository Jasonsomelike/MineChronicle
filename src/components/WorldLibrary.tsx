import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, Search, History, BarChart3 } from 'lucide-react';
import { Collapse, Input } from 'antd';
import type { ScanSummary, WorldSummary } from '../lib/scan';
import { worldGroups, worldTicks, byPlayTimeDesc } from '../lib/worlds';
import type { PageId } from '../app/routes';
import { displayPath } from '../lib/path';
import { formatPlayTicks } from '../lib/duration';
import PlayerName from './PlayerName';
import { SecondaryButton, TextButton, Tabs, Pagination } from './ui';
function WorldTotal({
  world,
  maxTicks,
}: {
  world: WorldSummary;
  maxTicks: bigint;
}) {
  const readable = world.players.filter((p) => p.play_ticks !== null);
  const total = worldTicks(world);
  // The bar used to be a fixed 55%, which made every world look the same size. It is
  // now a share of the largest total in the list, so the lengths compare.
  const share = maxTicks > 0n ? Number((total * 10000n) / maxTicks) / 100 : 0;
  return (
    <span className="world-total">
      {/* The figure is a span of its own so the bar beside it is the same length on
          every row. Sized to the text, a row reading "0秒" left its bar 303px wide
          and a row reading "1小时26分" left it 240px: two ends moving, which is a
          bar that cannot be read against its neighbour. */}
      <span className="world-duration">
        {readable.length ? formatPlayTicks(total.toString()) : '—'}
      </span>
      {readable.length ? (
        <span className="world-mini-bar" aria-hidden="true">
          {/* Same floor as the hero's ruler: a minute against a sixty-day scale is
              a sub-pixel fill, which reads as no time beside a number that says
              otherwise. A zero reading keeps its empty track. */}
          <i style={{ width: share > 0 ? `max(${share}%, 3px)` : '0%' }} />
        </span>
      ) : null}
    </span>
  );
}

function World({
  world,
  instanceName,
  maxTicks,
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
  maxTicks: bigint;
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
  /* The hand-written <details> became an antd Collapse (ghost): same disclosure,
     library disclosure semantics. The `.world-result` class and `data-status`
     land on the Collapse root (antd forwards unknown props there), so the page
     styles and the qa-design-check degraded-world assertion keep their hooks -
     the header node plays the role `summary` played, and the row content sits in
     the panel body. antd owns the open/close motion; the dual-source state
     (`openProp ?? expanded`) survives unchanged: flat view is controlled by the
     open Set, the grouped view keeps its own state seeded by the search flag. */
  return (
    <Collapse
      ghost
      className="world-result"
      data-status={world.status}
      activeKey={open ? ['detail'] : []}
      /* The row carried no visible disclosure marker (hover ink only); a null
         icon keeps that shape instead of adding an arrow the row never had. */
      expandIcon={() => null}
      onChange={(keys) => {
        const next = keys.length > 0;
        if (openProp === undefined) setExpanded(next);
        onOpenChange?.(next);
      }}
      items={[
        {
          key: 'detail',
          label: (
            <>
              <strong>{world.name}</strong>
              {instanceName ? (
                <span className="world-instance" title={instanceName}>
                  {instanceName}
                </span>
              ) : null}
              <WorldTotal world={world} maxTicks={maxTicks} />
              <span className="world-status">
                {world.status === 'Missing'
                  ? '目录已缺失 · 历史保留'
                  : world.status === 'Degraded'
                  ? '元数据缺失或损坏'
                  : `${world.players.length} 位玩家`}
              </span>
            </>
          ),
          children: (
            <>
              <p className="world-path">{displayPath(world.path)}</p>
              <p>Minecraft {world.minecraft_version ?? '版本未知'}</p>
              <div className="world-detail-actions">
                <TextButton onClick={() => onActivity('timeline', world.path)}>
                  <History size={14} />
                  时间线与追踪
                </TextButton>
                <TextButton
                  onClick={() => onActivity('statistics', world.path)}
                >
                  <BarChart3 size={14} />
                  更多统计
                </TextButton>
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
          ),
        },
      ]}
    />
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
  // Longest first. The page is a reading of how much each world has been played, so
  // ordering by name buried the answer; `worldGroups` still sorts the grouped view by
  // name, which is right for a folder tree.
  const flatWorlds = useMemo(
    () =>
      groups
        .flatMap((g) =>
          g.worlds.map((world) => ({ world, instanceName: g.name })),
        )
        .sort(byPlayTimeDesc),
    [groups],
  );
  const maxWorldTicks = useMemo(
    () =>
      flatWorlds.reduce(
        (max, w) => (worldTicks(w.world) > max ? worldTicks(w.world) : max),
        0n,
      ),
    [flatWorlds],
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const listCount = mode === 'flat' ? flatWorlds.length : groups.length;
  const pages = Math.max(1, Math.ceil(listCount / pageSize));
  const current = Math.min(page, pages - 1);
  const search = !!query.trim();
  // Empty copy keys off the same trimmed needle the list filters on, so a
  // whitespace-only query cannot claim the archive is empty while rows show.
  const searching = search;
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
        <Input
          className="library-search"
          aria-label="查找世界或玩家"
          prefix={<Search size={16} aria-hidden="true" />}
          allowClear
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setPage(0);
          }}
          placeholder="实例、世界、玩家名或 UUID"
        />
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
      {!listCount ? (
        <div className="list-empty" role="status">
          <strong>{searching ? '没有匹配的世界' : '档案中还没有世界'}</strong>
          <p>
            {searching
              ? '可清除搜索，或换用实例名、玩家名或 UUID 再试。'
              : '到「导入与设置」添加游戏根目录并扫描后，世界会出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="list-meta">
          <span className="list-result-count">
            共 {listCount} {mode === 'flat' ? '个世界' : '个目录'}
          </span>
          {/* The archive path used to be printed here too. The panel's own footer
              states it once (`.runtime-path`), and two identical paths on one page
              read as the same fact rendered twice - the same reasoning that took it
              out of the instances list's bar. */}
        </div>
      )}
      {mode === 'flat'
        ? flatWorlds
            .slice(current * pageSize, current * pageSize + pageSize)
            .map(({ world, instanceName }) => (
              <World
                key={world.path}
                world={world}
                instanceName={instanceName}
                maxTicks={maxWorldTicks}
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
                /* Same treatment as `.world-result`: the folder disclosure is a
                   ghost Collapse now, with the `.world-group` class and the open
                   Set as the single controlled source. */
                <Collapse
                  key={group.root.path}
                  ghost
                  className="world-group"
                  activeKey={expanded ? ['group'] : []}
                  expandIcon={() => null}
                  onChange={(keys) => {
                    const next = keys.length > 0;
                    setOpen((prev) => {
                      if (prev.has(group.root.path) === next) return prev;
                      const copy = new Set(prev);
                      if (next) copy.add(group.root.path);
                      else copy.delete(group.root.path);
                      return copy;
                    });
                  }}
                  items={[
                    {
                      key: 'group',
                      label: (
                        <>
                          <strong>{group.name}</strong>
                          <span>
                            {group.shared ? '共享根目录 · ' : ''}
                            {group.worlds.length} 个世界
                          </span>
                        </>
                      ),
                      children: (
                        <div className="world-group-content">
                          <p className="world-path">
                            {displayPath(group.root.path)}
                          </p>
                          {group.worlds.map((world) => (
                            <World
                              key={world.path}
                              world={world}
                              // The same maximum as the flat view, so a bar means the same
                              // length in both modes.
                              maxTicks={maxWorldTicks}
                              search={search}
                              busy={busy}
                              saved={report.saved}
                              onSaved={onSaved}
                              onActivity={onActivity}
                            />
                          ))}
                        </div>
                      ),
                    },
                  ]}
                />
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
