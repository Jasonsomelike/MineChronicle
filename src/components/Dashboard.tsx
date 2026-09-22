import { Fragment, lazy, Suspense, useId, useMemo, useState } from 'react';
import type { ScanSummary } from '../lib/scan';
import { summarize } from '../lib/dashboard';
import type { Ranking } from '../lib/dashboard';
import {
  formatTickTotal,
  formatCompactTicks,
  formatSeconds,
} from '../lib/duration';
import { displayPath } from '../lib/path';
import { groupIssues } from '../lib/issues';
import { trackingTotals, pseudoTotals } from '../lib/tracking';
import type { TrackingSummary } from '../lib/tracking';
import type { HealthSummary } from '../lib/health';
import {
  ArrowUpRight,
  ChevronDown,
  Clock3,
  Globe2,
  ShieldCheck,
  Sunrise,
  CalendarDays,
  Footprints,
} from 'lucide-react';
const RankingChart = lazy(() => import('./RankingChart'));
import Timeline from './Timeline';
import PlayerPicker from './PlayerPicker';
import { selectedPlayer } from '../lib/players';
import { emptyScope } from '../lib/activity';
import './Dashboard.css';
import SessionPage from './SessionPage';

function RankingList({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: Ranking[];
  onOpen: (path: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(5);
  const listId = useId();
  const visible = rows.slice(0, visibleCount);
  const remaining = rows.length - visible.length;
  return (
    <section className="ranking" aria-label={title}>
      <h3>{title}</h3>
      {visible.length ? (
        <>
          <div className="ranking-body">
            <Suspense fallback={null}>
              <RankingChart rows={visible} />
            </Suspense>
            <ol id={listId}>
              {visible.map((r, index) => (
                <li key={r.path}>
                  <button
                    type="button"
                    className="text-button"
                    title={displayPath(r.path)}
                    onClick={() => onOpen(r.path)}
                  >
                    <span className="rank-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>{' '}
                    {r.name}
                    {r.shared > 1 ? '（共享）' : ''}
                    {r.missing ? '（已缺失）' : ''}
                  </button>
                  <span
                    className="rank-duration"
                    title={formatTickTotal(r.ticks.toString())}
                  >
                    {formatCompactTicks(r.ticks.toString())}
                    <ArrowUpRight size={14} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="ranking-footer">
            <span aria-live="polite">
              已显示 {visible.length} / {rows.length}
            </span>
            {remaining > 0 ? (
              <button
                type="button"
                className="ranking-more secondary-button"
                aria-controls={listId}
                title={`继续显示后 ${Math.min(5, remaining)} 项`}
                onClick={() =>
                  setVisibleCount((count) => Math.min(count + 5, rows.length))
                }
              >
                <ChevronDown size={15} />
                显示更多
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p>还没有可排行的历史读数。</p>
      )}
    </section>
  );
}
/**
 * The playtime ruler: every world measured against one shared scale.
 *
 * This is the page's signature, and it exists to replace the "big number plus
 * illustration" hero, which is the templated answer and said nothing the number
 * itself did not. A ruler says something the number cannot: how the total is
 * distributed, and how far apart the worlds are.
 *
 * Three decisions make it a measuring instrument rather than a bar chart:
 *   - One shared scale across every row, so the bars are comparable to each other
 *     instead of each filling its own width.
 *   - Visible graduations with the unit labelled, so a value can be read off the
 *     track rather than only inferred from the number beside it.
 *   - The divisions are exact quarters of the real maximum, not rounded to a "nice"
 *     axis: a ruler that rounds its own scale is decoration.
 */
function PlaytimeRuler({
  rows,
  onOpen,
}: {
  rows: Ranking[];
  onOpen: (path: string) => void;
}) {
  // Rows arrive sorted by play time, so the first is the maximum.
  const max = rows[0]?.ticks ?? 0n;
  if (max <= 0n) return null;
  const marks = [0n, 1n, 2n, 3n, 4n].map((i) => (max * BigInt(i)) / 4n);
  const visible = rows.slice(0, 5);

  return (
    <div className="playtime-ruler">
      <div className="ruler-grid">
        <span />
        {/* Purely visual: the rows below carry the same numbers as text. */}
        <div className="ruler-scale" aria-hidden="true">
          {marks.map((mark, index) => (
            <span key={index}>
              {index === 0 ? '0' : formatCompactTicks(mark.toString())}
            </span>
          ))}
        </div>
        <span />
        {visible.map((row) => {
          // Percentage with two decimals, matching how the ranking chart scales its
          // bars, so the ruler and the chart cannot disagree.
          const share = Number((row.ticks * 10000n) / max) / 100;
          return (
            <Fragment key={row.path}>
              <button
                type="button"
                className="ruler-name"
                title={displayPath(row.path)}
                onClick={() => onOpen(row.path)}
              >
                {row.name}
              </button>
              <span className="ruler-track" aria-hidden="true">
                <span className="ruler-fill" style={{ width: `${share}%` }} />
              </span>
              {/* A world whose directory is gone has no current reading. Showing
                  "0 秒" would claim it was never played, which is a different and
                  untrue statement, so the value column says what happened. */}
              <span className="ruler-value">
                {row.missing
                  ? '已缺失'
                  : formatCompactTicks(row.ticks.toString())}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard({
  report,
  onOpen,
  onSettings,
  tracking,
  health,
  onTimeline,
  onObservation,
  players,
  onPlayers,
  playersNone = false,
}: {
  report: ScanSummary;
  tracking: TrackingSummary | null;
  health: HealthSummary | null;
  onOpen: (path: string) => void;
  onSettings: () => void;
  onTimeline: () => void;
  onObservation: () => void;
  players: string[];
  playersNone?: boolean;
  onPlayers: (ids: string[], none?: boolean) => void;
}) {
  const [ranking, setRanking] = useState<'worlds' | 'instances'>('worlds');
  const data = useMemo(
    () => summarize(report, playersNone ? null : players),
    [report, players, playersNone],
  );
  const rankingScope = `${playersNone}|${[...players].sort().join('|')}`;
  const timelineScope = useMemo(
    () => ({ ...emptyScope, uuids: players, players_none: playersNone }),
    [players, playersNone],
  );
  const issues = groupIssues(
    report.issues.filter((i) => i.kind !== 'EMPTY_STATS'),
  );
  const tracked = trackingTotals(tracking, playersNone ? null : players);
  // Not filtered by player: observed sessions record which instance ran, not
  // who played, so there is no uuid to filter on. Presenting it as an
  // instance-level figure keeps that honest.
  const pseudo = pseudoTotals(tracking);
  const rollbacks =
    tracking?.rollbacks.filter((r) =>
      selectedPlayer(r.uuid, playersNone ? null : players),
    ) ?? [];
  return (
    <section className="dashboard" aria-label="生涯概览">
      <div className="dashboard-heading">
        <div>
          <h2>生涯概览</h2>
          <p>
            {playersNone
              ? '未选择玩家'
              : players.length
              ? '所选玩家'
              : '全部玩家'}
            {' · '}
            {data.worlds.length} 个世界 · {report.instances.length} 个 PCL 实例
          </p>
        </div>
        <PlayerPicker
          report={report}
          value={players}
          none={playersNone}
          onChange={onPlayers}
        />
      </div>
      <div className="overview-grid">
        <div className="career-total">
          <div className="career-copy">
            <span className="metric-label">
              <Clock3 size={16} />
              累计游玩时长
            </span>
            <strong>{formatTickTotal(data.current.toString())}</strong>
            <p>
              最近有效存档读数 ·{' '}
              {playersNone
                ? '未选择玩家'
                : players.length > 1
                ? `${players.length} 人组合`
                : players.length
                ? '所选玩家'
                : '全部玩家'}
            </p>
            {/* The ruler replaces an illustration and a caption. The headline figure
                above stays; what changes is that the card now shows how the total is
                made up, which is the thing the number alone cannot say. */}
            <PlaytimeRuler
              rows={ranking === 'worlds' ? data.worlds : data.roots}
              onOpen={onOpen}
            />
          </div>
        </div>
        {/* The observation figures sit with the career total rather than in their
            own band below it. They are the same kind of number - a duration - so
            stacking them as a separate full-width row made the page read as two
            unrelated summaries and pushed the ranking off the first screen. */}
        <div className="tracking-state">
          <article>
            <span>
              <Globe2 size={16} aria-hidden="true" />
              统计范围
            </span>
            <strong>
              {data.worlds.length} /{' '}
              {playersNone ? 0 : players.length || data.players.length}
            </strong>
            <small>
              世界 / 玩家 · {report.instances.length} 个实例 · {data.missing}{' '}
              个缺失
            </small>
          </article>
          <article>
            <span>
              <Sunrise size={16} aria-hidden="true" />
              本周观察增量
            </span>
            <strong>
              {tracking?.started_at
                ? formatTickTotal(tracked.week.toString())
                : '等待首次观察'}
            </strong>
          </article>
          <article>
            <span>
              <CalendarDays size={16} aria-hidden="true" />
              本月观察增量
            </span>
            <strong>
              {tracking?.started_at
                ? formatTickTotal(tracked.month.toString())
                : '等待首次观察'}
            </strong>
          </article>
          <article>
            <span>
              <Footprints size={16} aria-hidden="true" />
              累计追踪时长
            </span>
            <strong>
              {tracking?.started_at
                ? formatTickTotal(tracked.ticks.toString())
                : '等待首次观察'}
            </strong>
          </article>
          <p className="tracking-note">
            只累计观察到的正向变化，回档不会扣减。周/月按本机日期的观察时间归档，不代表精确游戏会话时间。
          </p>
        </div>
      </div>
      <div className="ranking-switch" role="group" aria-label="排行维度">
        <button
          aria-pressed={ranking === 'worlds'}
          onClick={() => setRanking('worlds')}
        >
          世界排行
        </button>
        <button
          aria-pressed={ranking === 'instances'}
          onClick={() => setRanking('instances')}
        >
          实例排行
        </button>
      </div>
      <div className="ranking-grid ranking-unified">
        <SessionPage active={ranking === 'worlds'} label="世界排行">
          <RankingList
            key={`worlds:${rankingScope}`}
            title="世界排行"
            rows={data.worlds}
            onOpen={onOpen}
          />
        </SessionPage>
        <SessionPage active={ranking === 'instances'} label="实例排行">
          <RankingList
            key={`roots:${rankingScope}`}
            title="实例排行 · 按根目录汇总"
            rows={data.roots}
            onOpen={onOpen}
          />
        </SessionPage>
      </div>
      <p className="scan-note">
        按最近有效读数排行；不含已缺失世界与不可读统计。共享根目录只计算一次，复制世界尚未去重。
      </p>
      <div className="health-summary">
        <div>
          <h3 className="metric-label">
            <ShieldCheck size={16} />
            数据状态
          </h3>
          <p>
            {health?.pending_count ?? issues.length} 项待处理 ·{' '}
            {tracking?.rollback_count ?? 0} 次回档记录 · {data.unreadable}{' '}
            条当前读数不可用
          </p>
          {pseudo.seconds > 0n || pseudo.unknown || pseudo.baseline ? (
            <p>
              未归因运行时长 {formatSeconds(pseudo.seconds.toString())}
              {pseudo.instances ? ` · ${pseudo.instances} 个实例` : ''}
              {pseudo.unknown ? ` · ${pseudo.unknown} 次会话未观测到结束` : ''}
              {pseudo.baseline
                ? ` · ${pseudo.baseline} 次会话缺少本地基线，未计入`
                : ''}
              <br />
              全部实例历史累计，不随玩家筛选。可能包含服务器游玩、加载和菜单停留，不等同于玩家游戏时长。
              <button
                type="button"
                className="text-button"
                onClick={onObservation}
              >
                查看实例观测
              </button>
            </p>
          ) : null}
          {health?.confirmed_lineages ? (
            <p>
              已确认 {health.confirmed_lineages}{' '}
              条世界关联；继承时长未知，尚未计算去重估值。
            </p>
          ) : null}
        </div>
        <button type="button" className="secondary-button" onClick={onSettings}>
          查看数据健康
        </button>
      </div>
      {rollbacks.length ? (
        <details className="rollback-list">
          <summary>最近回档记录 · 显示 {rollbacks.length} 条</summary>
          {rollbacks.map((r, index) => (
            <article
              key={`${r.world_path}:${r.uuid}:${r.detected_at}:${index}`}
            >
              <strong>{r.world_name}</strong>
              <p>
                {data.players.find(([id]) => id === r.uuid)?.[1] ?? r.uuid} ·{' '}
                {formatTickTotal(r.old_ticks)} → {formatTickTotal(r.new_ticks)}
              </p>
              <p>
                {new Date(r.detected_at).toLocaleString()} · 本次增量
                0，历史保留
              </p>
            </article>
          ))}
        </details>
      ) : null}
      <Timeline
        report={report}
        scope={timelineScope}
        compact
        onOpen={onOpen}
        onAll={onTimeline}
      />
      <p className="scan-note">
        {report.last_scan
          ? `最近保存：${new Date(report.last_scan).toLocaleString()}`
          : '尚未扫描。前往“导入与设置”，连接 PCL 或添加目录。'}
      </p>
    </section>
  );
}
