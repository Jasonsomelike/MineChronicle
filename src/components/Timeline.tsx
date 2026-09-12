import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { loadTimeline, eventNames, emptyScope } from '../lib/activity';
import type { ActivityScope, TimelinePage } from '../lib/activity';
import type { ScanSummary } from '../lib/scan';
import { formatTickTotal } from '../lib/duration';
import { displayPath } from '../lib/path';
import ActivityFilters from './ActivityFilters';
import { usePageActive } from './SessionPage';
export default function Timeline({
  report,
  scope = emptyScope,
  onScope,
  onOpen,
  compact = false,
  onAll,
}: {
  report: ScanSummary;
  scope?: ActivityScope;
  onScope?: (s: ActivityScope) => void;
  onOpen: (path: string) => void;
  compact?: boolean;
  onAll?: () => void;
}) {
  const pageActive = usePageActive();
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [kind, setKind] = useState(''),
    [offset, setOffset] = useState(0);
  const [data, setData] = useState<TimelinePage | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const loadedQuery = useRef('');
  useEffect(() => {
    setOffset(0);
  }, [scope.uuids, scope.players_none]);
  useEffect(() => {
    if (!pageActive) return;
    const signature = JSON.stringify({
      scope,
      from,
      to,
      kind,
      offset,
      scan: report.last_scan,
    });
    if (signature === loadedQuery.current) {
      setLoading(false);
      setError('');
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void loadTimeline({ ...scope, from, to, kind, offset })
      .then((d) => {
        if (active) {
          loadedQuery.current = signature;
          setData(d);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, from, to, kind, offset, report.last_scan, pageActive]);
  return (
    <section
      className={compact ? 'timeline compact-timeline' : 'timeline'}
      aria-label={compact ? '最近时间线' : '时间线'}
    >
      <div className="library-heading">
        <h2>
          <History size={17} />
          {compact ? '最近时间线' : '时间线'}
        </h2>
        {compact ? (
          <button className="text-button" onClick={onAll}>
            全部记录
            <ArrowUpRight size={14} />
          </button>
        ) : (
          <span>{data?.total ?? 0} 条记录</span>
        )}
      </div>
      {!compact ? (
        <>
          <ActivityFilters
            report={report}
            scope={scope}
            onChange={(s) => {
              setOffset(0);
              onScope?.(s);
            }}
          />
          <div className="timeline-filters">
            <label>
              开始日期
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              事件
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">所有事件</option>
                {Object.entries(eventNames).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="scan-note">
            按本机观察日期显示。首次导入历史不代表当天游玩，观察增量不等同于完整游戏会话。
          </p>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="scan-error">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status">正在读取时间线…</p>
      ) : !error && !data?.events.length ? (
        <p>暂无符合条件的记录。</p>
      ) : null}
      {!loading && !error ? (
        <ol className="timeline-events">
          {data?.events.slice(0, compact ? 5 : 50).map((e) => (
            <li key={e.id} className={`event-${e.kind}`}>
              <time dateTime={e.observed_at}>
                {new Date(e.observed_at).toLocaleString()}
              </time>
              <div>
                <div className="timeline-title">
                  <strong>{eventNames[e.kind] ?? e.kind}</strong>
                  <button
                    className="text-button"
                    title={displayPath(e.world_path)}
                    onClick={() => onOpen(e.world_path)}
                  >
                    {e.world_name}
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                <p>
                  {e.player_name ?? e.uuid}
                  <span className="event-duration">
                    {e.kind === 'increment'
                      ? `+ ${formatTickTotal(e.delta_ticks)}`
                      : e.kind === 'rollback'
                      ? `${formatTickTotal(
                          e.old_ticks ?? '0',
                        )} → ${formatTickTotal(e.play_ticks)}`
                      : e.kind === 'initial_import'
                      ? formatTickTotal(e.play_ticks)
                      : ''}
                  </span>
                </p>
                {!compact ? (
                  <details className="event-details">
                    <summary>玩家标识</summary>
                    <code className="scan-note">{e.uuid}</code>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {!compact && data && data.total > 50 ? (
        <div className="pagination">
          <label>
            跳转到{' '}
            <input
              type="number"
              aria-label="时间线页码"
              min={1}
              max={Math.ceil(data.total / 50)}
              value={Math.floor(offset / 50) + 1}
              onChange={(event) => {
                const page = Number(event.target.value);
                if (
                  Number.isInteger(page) &&
                  page >= 1 &&
                  page <= Math.ceil(data.total / 50)
                )
                  setOffset((page - 1) * 50);
              }}
            />
          </label>
          <button
            title="上一页"
            aria-label="上一页"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {Math.floor(offset / 50) + 1} / {Math.ceil(data.total / 50)}
          </span>
          <button
            title="下一页"
            aria-label="下一页"
            disabled={loading || offset + 50 >= data.total}
            onClick={() => setOffset(offset + 50)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
