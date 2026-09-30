import { useResource } from '../lib/useResource';
import ReadStatus from './ReadStatus';
import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Button, Collapse, DatePicker, Pagination, Select } from 'antd';
import { ArrowUpRight, Check, History } from 'lucide-react';
import { loadTimeline, eventNames, emptyScope } from '../lib/activity';
import type { ActivityScope, TimelinePage } from '../lib/activity';
import type { ScanSummary } from '../lib/scan';
import { formatTickTotal } from '../lib/duration';
import { displayPath } from '../lib/path';
import ActivityFilters from './ActivityFilters';
import { TextButton } from './ui';
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
  /* The row whose UUID was just copied, name included: the confirmation is shown beside
     that row and announced by the live region below, so both need to know which one it is. */
  const [copied, setCopied] = useState<{ uuid: string; name: string } | null>(
    null,
  );
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    /* The ref is read through a local so the cleanup does not capture a `.current` that
       the lint rule cannot prove is still the same timer. */
    const timer = copyTimer;
    return () => window.clearTimeout(timer.current);
  }, []);
  async function copyUuid(uuid: string, name: string) {
    const write = navigator.clipboard?.writeText(uuid);
    /* A confirmation is a claim about the clipboard, so it is only shown for a write that
       actually resolved. There is no clipboard outside a secure context, and the browser
       can refuse the permission. */
    if (!write) return;
    try {
      await write;
    } catch {
      return;
    }
    setCopied({ uuid, name });
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
  }
  useEffect(() => {
    setOffset(0);
  }, [scope.uuids, scope.players_none]);
  const request = useResource(
    () => loadTimeline({ ...scope, from, to, kind, offset }),
    JSON.stringify({ scope, from, to, kind, offset, scan: report.last_scan }),
    pageActive,
  );
  const clearFilters = () => {
    setFrom('');
    setTo('');
    setKind('');
    setOffset(0);
    onScope?.({
      ...emptyScope,
      uuids: scope.uuids,
      players_none: scope.players_none,
    });
  };
  useEffect(() => {
    if (request.data) setData(request.data);
    setError(request.error);
    setLoading(request.loading);
  }, [request.data, request.error, request.loading]);
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
          <TextButton onClick={onAll}>
            全部记录
            <ArrowUpRight size={14} />
          </TextButton>
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
            {/* The DatePickers are the input layer only: their dayjs values are
                formatted straight back to `YYYY-MM-DD` strings here, which is the
                shape loadTimeline has always received - a dayjs object must never
                reach the IPC query. The wrapping <label> keeps the implicit
                field-to-name association the native inputs had. */}
            <label>
              开始日期
              <DatePicker
                value={from ? dayjs(from, 'YYYY-MM-DD') : null}
                onChange={(value) => {
                  setFrom(value ? value.format('YYYY-MM-DD') : '');
                  setOffset(0);
                }}
                allowClear
              />
            </label>
            <label>
              结束日期
              <DatePicker
                value={to ? dayjs(to, 'YYYY-MM-DD') : null}
                onChange={(value) => {
                  setTo(value ? value.format('YYYY-MM-DD') : '');
                  setOffset(0);
                }}
                allowClear
              />
            </label>
            <div
              className="date-shortcuts"
              role="group"
              aria-label="日期快捷范围"
            >
              {(
                [
                  ['today', '今天'],
                  ['week', '近 7 天'],
                  ['month', '本月'],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={id}
                  className="secondary-button"
                  size="small"
                  onClick={() => {
                    const now = new Date();
                    const day = (offsetDays: number) => {
                      const d = new Date(now);
                      d.setDate(d.getDate() - offsetDays);
                      return `${d.getFullYear()}-${String(
                        d.getMonth() + 1,
                      ).padStart(2, '0')}-${String(d.getDate()).padStart(
                        2,
                        '0',
                      )}`;
                    };
                    if (id === 'today') {
                      const t = day(0);
                      setFrom(t);
                      setTo(t);
                    } else if (id === 'week') {
                      setFrom(day(6));
                      setTo(day(0));
                    } else {
                      const start = new Date(
                        now.getFullYear(),
                        now.getMonth(),
                        1,
                      );
                      setFrom(
                        `${start.getFullYear()}-${String(
                          start.getMonth() + 1,
                        ).padStart(2, '0')}-${String(start.getDate()).padStart(
                          2,
                          '0',
                        )}`,
                      );
                      setTo(day(0));
                    }
                    setOffset(0);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <label>
              事件
              <Select
                value={kind}
                onChange={(value) => {
                  setKind(value);
                  setOffset(0);
                }}
                options={[
                  { value: '', label: '所有事件' },
                  ...Object.entries(eventNames).map(([key, name]) => ({
                    value: key,
                    label: name,
                  })),
                ]}
              />
            </label>
          </div>
          <p className="scan-note">
            按本机观察日期显示。首次导入历史不代表当天游玩，观察增量不等同于完整游戏会话。
          </p>
        </>
      ) : null}
      <ReadStatus {...request} label="时间线" />
      {/* One live region for the list rather than one per row, and it is here from the first
          render: a live region that arrives together with its text is not reliably
          announced, whereas a change inside one that already exists is. Absolutely
          positioned (`.sr-only`) so it cannot add a gap to any row it sits above. */}
      <p className="sr-only" role="status">
        {copied ? `已复制 ${copied.name} 的 UUID` : ''}
      </p>
      <div className="filter-summary">
        <span>玩家选择与其他页面同步；其他筛选仅影响本页。</span>
        <TextButton onClick={clearFilters}>清除本页筛选</TextButton>
      </div>
      {loading ? (
        <p role="status">正在读取时间线…</p>
      ) : !error && !data?.events.length ? (
        <div className="list-empty" role="status">
          <strong>暂无符合条件的记录</strong>
          <p>
            可清除本页筛选，或调整统计玩家。观察缺口表示当时未在观测，不代表没有游玩。
          </p>
        </div>
      ) : null}
      {data?.events.length ? (
        <p className="list-result-count">本页共 {data.events.length} 条记录</p>
      ) : null}
      {data ? (
        <ol className="timeline-events">
          {data?.events.slice(0, compact ? 5 : 50).map((e) => {
            const merged = (e.merged_count ?? 1) > 1;
            // A span that contains an import or a rollback is more than "time
            // grew", so the row describes what it is made of instead of claiming
            // one kind. `kinds` is most frequent first.
            const composition = (e.kinds ?? []).filter(
              (k) => k.kind !== 'increment',
            );
            const increments = (e.kinds ?? []).find(
              (k) => k.kind === 'increment',
            )?.count;
            const title = merged
              ? composition.length
                ? composition
                    .map((k) => eventNames[k.kind] ?? k.kind)
                    .join(' + ')
                : eventNames[e.kind] ?? e.kind
              : eventNames[e.kind] ?? e.kind;
            return (
              <li key={e.id} className={`event-${e.kind}`}>
                <div className="event-when">
                  <time dateTime={e.observed_at} className="event-date">
                    {new Date(e.observed_at).toLocaleDateString()}
                  </time>
                  {merged && e.first_observed_at ? (
                    // A merged run covers a span, so the time shows the range
                    // rather than one instant. Without this the row looked like a
                    // single moment that happened to add an hour.
                    <span className="event-range">
                      <time dateTime={e.first_observed_at}>
                        {new Date(e.first_observed_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      <span className="event-span-sep" aria-hidden="true">
                        →
                      </span>
                      <time dateTime={e.observed_at}>
                        {new Date(e.observed_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                  ) : (
                    // One instant, so a single time under the date keeps the
                    // column's shape identical to a merged row's.
                    <span className="event-range">
                      <time dateTime={e.observed_at}>
                        {new Date(e.observed_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                  )}
                </div>
                <div className="event-body">
                  <div className="timeline-title">
                    <strong>{title}</strong>
                    {merged ? (
                      <span
                        className="event-merged-tag"
                        title={`这一段时间由 ${e.merged_count} 次观测合并`}
                      >
                        {increments
                          ? `${increments} 次增长${
                              composition.length ? ' · ' : ''
                            }`
                          : ''}
                        {e.merged_count} 次观测
                      </span>
                    ) : null}
                    <TextButton
                      className="event-world"
                      title={displayPath(e.world_path)}
                      onClick={() => onOpen(e.world_path)}
                    >
                      {e.world_name}
                      <ArrowUpRight size={13} />
                    </TextButton>
                  </div>
                  <p className="event-meta">
                    {/* A button, because this row's only action has to be reachable
                        from the keyboard. It was a span with `cursor: copy` and an
                        onClick, so nobody tabbing through the page could copy anything.
                        The confirmation is transient and replaces nothing: the name stays
                        where it was and the fact follows it. */}
                    <TextButton
                      className="event-player"
                      title={`UUID ${e.uuid} · 点击复制`}
                      aria-label={`复制 ${e.player_name ?? e.uuid} 的 UUID`}
                      onClick={() =>
                        void copyUuid(e.uuid, e.player_name ?? e.uuid)
                      }
                    >
                      {e.player_name ?? e.uuid}
                      {/* Visual only. A button's children are presentational, so nothing
                          inside it is read out - which is why the confirmation is also
                          mirrored into the live region above the list. */}
                      {copied?.uuid === e.uuid ? (
                        <span className="uuid-copy">
                          <Check size={13} />
                          已复制
                        </span>
                      ) : null}
                    </TextButton>
                    <span className="event-duration">
                      {e.kind === 'increment'
                        ? `+ ${formatTickTotal(e.delta_ticks)}`
                        : e.kind === 'mixed'
                        ? // A mixed span's headline figure is the net growth, with
                          // the rollback shown inside the breakdown so the two are
                          // not conflated.
                          `+ ${formatTickTotal(e.delta_ticks)}`
                        : e.kind === 'rollback'
                        ? `${formatTickTotal(
                            e.old_ticks ?? '0',
                          )} → ${formatTickTotal(e.play_ticks)}`
                        : e.kind === 'initial_import'
                        ? formatTickTotal(e.play_ticks)
                        : ''}
                    </span>
                  </p>
                  {merged && e.parts?.length ? (
                    // The individual observations, so the merged total stays
                    // auditable: a reader can see how it was built up, including
                    // the import and rollback that opened the span. A ghost
                    // Collapse carries both hook classes (`.event-details
                    // .event-parts`) on its root, so the compact-timeline spacing
                    // rules still apply.
                    <Collapse
                      ghost
                      className="event-details event-parts"
                      items={[
                        {
                          key: 'parts',
                          label: `展开 ${e.parts.length} 次观测`,
                          children: (
                            <ol>
                              {e.parts.map((part) => (
                                <li
                                  key={part.observed_at}
                                  className={`part-${part.kind ?? 'increment'}`}
                                >
                                  <time dateTime={part.observed_at}>
                                    {new Date(
                                      part.observed_at,
                                    ).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </time>
                                  <span className="part-kind">
                                    {eventNames[part.kind ?? 'increment'] ??
                                      part.kind ??
                                      ''}
                                  </span>
                                  <span className="part-delta">
                                    {part.kind === 'rollback'
                                      ? `${formatTickTotal(
                                          part.old_ticks ?? '0',
                                        )} → 回档`
                                      : part.kind === 'initial_import'
                                      ? // An import's delta is always 0 - it records the
                                        // baseline the later increments are measured
                                        // against, so its own change is not a duration.
                                        '建立基线'
                                      : `+ ${formatTickTotal(
                                          part.delta_ticks,
                                        )}`}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          ),
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {!compact && data && data.total > 50 ? (
        /* The pager is an antd Pagination in simple mode: the "1 / 8" readout
           became the library's jump field, which keeps 50/page and the jump-to
           semantics. The wrapper nav carries the pager's name (the native input's
           `aria-label="时间线页码"` moved onto it - antd's jumper input gets its
           own accessible name from the zh_CN locale) and the `.pagination` class
           the shared footer styles key on. Offset math stays the one source:
           onChange converts the page back to `(page-1) * 50`. */
        <nav className="pagination" aria-label="时间线页码">
          <Pagination
            simple
            disabled={loading}
            current={Math.floor(offset / 50) + 1}
            pageSize={50}
            total={data.total}
            showSizeChanger={false}
            onChange={(page) => setOffset((page - 1) * 50)}
          />
        </nav>
      ) : null}
    </section>
  );
}
