import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  Search,
  History,
  BarChart3,
} from 'lucide-react';
import type { ScanSummary, WorldSummary } from '../lib/scan';
import { worldGroups } from '../lib/worlds';
import { displayPath } from '../lib/path';
import { formatPlayTicks } from '../lib/duration';
import PlayerName from './PlayerName';
function World({
  world,
  search,
  busy,
  saved,
  onSaved,
  onActivity,
}: {
  world: WorldSummary;
  search: boolean;
  busy: boolean;
  saved: boolean;
  onSaved: (r: ScanSummary) => void;
  onActivity: (page: string, path: string) => void;
}) {
  const [expanded, setExpanded] = useState(search);
  const open = expanded;
  // The summary carries the world's total, so a collapsed row still answers "which
  // world did I play most" without opening every one of them. Summed over the
  // players whose latest reading is usable; a conflicting or unreadable reading
  // contributes nothing rather than a misleading zero.
  const total = world.players.reduce(
    (sum, player) =>
      sum + (player.play_ticks === null ? 0n : BigInt(player.play_ticks)),
    0n,
  );
  const readable = world.players.filter((p) => p.play_ticks !== null).length;
  return (
    <details
      className="world-result"
      open={open}
      onToggle={(e) => {
        setExpanded(e.currentTarget.open);
      }}
    >
      <summary>
        <strong>{world.name}</strong>
        <span className="world-total">
          {readable ? formatPlayTicks(total.toString()) : '—'}
        </span>
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
  onActivity: (page: string, path: string) => void;
}) {
  const groups = useMemo(() => worldGroups(report, query), [report, query]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(groups.length / 12));
  const current = Math.min(page, pages - 1);
  const search = !!query.trim();
  const previousQuery = useRef('');
  useEffect(() => {
    if (previousQuery.current === query) return;
    previousQuery.current = query;
    setOpen(new Set(query.trim() ? groups.map((g) => g.root.path) : []));
    setPage(0);
  }, [query, groups]);
  return (
    <section className="world-library" aria-label="世界与玩家">
      <div className="library-heading">
        <h2>世界与玩家</h2>
        <span>
          {query.trim() ? '搜索结果' : '全部档案'} · {groups.length}{' '}
          个实例根目录 · {groups.reduce((n, g) => n + g.worlds.length, 0)}{' '}
          个世界
        </span>
      </div>
      <div className="library-toolbar">
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
        <button
          type="button"
          className="secondary-button"
          disabled={open.size === 0}
          onClick={() => {
            setOpen(new Set());
            setPage(0);
          }}
        >
          <ChevronsDownUp size={15} />
          全部收起
        </button>
        {query ? (
          <button
            className="text-button"
            onClick={() => {
              onQuery('');
              setPage(0);
            }}
          >
            清除搜索
          </button>
        ) : null}
      </div>
      {!groups.length ? <p>没有匹配的世界。</p> : null}
      {groups.slice(current * 12, current * 12 + 12).map((group) => {
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
                <p className="world-path">{displayPath(group.root.path)}</p>
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
        <div className="pagination">
          <label>
            跳转到
            <select
              aria-label="世界列表页码"
              value={current}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {Array.from({ length: pages }, (_, i) => (
                <option value={i} key={i}>
                  第 {i + 1} 页
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            title="上一页"
            aria-label="上一页"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            title="下一页"
            aria-label="下一页"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
