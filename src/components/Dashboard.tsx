import { lazy, Suspense, useId, useMemo, useState } from 'react';
import type { ScanSummary } from '../lib/scan';
import { summarize } from '../lib/dashboard';
import type { Ranking } from '../lib/dashboard';
import { formatTickTotal, formatCompactTicks } from '../lib/duration';
import { displayPath } from '../lib/path';
import { groupIssues } from '../lib/issues';
import { trackingTotals } from '../lib/tracking';
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
export default function Dashboard({
  report,
  onOpen,
  onSettings,
  tracking,
  health,
  onTimeline,
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
            <span className="career-caption">
              每一次出发，都在这里留下足迹。
            </span>
          </div>
          <img
            className="career-scene"
            src="/illustrations/homestead.svg"
            alt=""
            aria-hidden="true"
            width="320"
            height="180"
          />
        </div>
        <div className="metric-grid">
          <article>
            <span className="metric-label">
              <Globe2 size={16} />
              当前统计 · 世界 / 玩家
            </span>
            <strong>
              {data.worlds.length} /{' '}
              {playersNone ? 0 : players.length || data.players.length}
            </strong>
            <small>
              {report.instances.length} 个 PCL 实例 · {data.missing} 个缺失世界
            </small>
          </article>
        </div>
      </div>
      <div className="tracking-state">
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
        <p>
          只累计观察到的正向变化，回档不会扣减。周/月按本机日期的观察时间归档，不代表精确游戏会话时间。
        </p>
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
