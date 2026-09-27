import { Fragment, useMemo, useRef, useState } from 'react';
import { Collapse, Segmented, Tag } from 'antd';
import type { ScanSummary } from '../lib/scan';
import {
  summarize,
  rankingPanel,
  rankingMax,
  rowShare,
  RANKING_TABS,
} from '../lib/dashboard';
import type { Ranking, RankingDimension } from '../lib/dashboard';
import {
  formatTickTotal,
  formatCompactTicks,
  formatSeconds,
  UNKNOWN_DURATION,
} from '../lib/duration';
import { displayPath } from '../lib/path';
import { groupIssues } from '../lib/issues';
import { trackingTotals, pseudoTotals } from '../lib/tracking';
import type { TrackingSummary } from '../lib/tracking';
import type { HealthSummary } from '../lib/health';
import {
  Clock3,
  Globe2,
  ShieldCheck,
  Sunrise,
  CalendarDays,
  Footprints,
} from 'lucide-react';
import Timeline from './Timeline';
import PlayerPicker from './PlayerPicker';
import { SecondaryButton, TextButton } from './ui';
import { selectedPlayer } from '../lib/players';
import { emptyScope } from '../lib/activity';
import './Dashboard.css';

/**
 * The playtime ruler: every world measured against one shared scale, and the page's
 * only list of play time.
 *
 * This is the page's signature, and it exists to replace the "big number plus
 * illustration" hero, which is the templated answer and said nothing the number
 * itself did not. A ruler says something the number cannot: how the total is
 * distributed, and how far apart the worlds are.
 *
 * It is also the ONLY ranking on this page. A second, longer list of the same rows
 * used to sit below the switch that changed them - same array, two row caps (7 and
 * 5), two type sizes, and a world whose directory is gone read `0s` there while the
 * ruler named the same world 已缺失. One screen cannot say one quantity two ways.
 * The complete ranking is the 世界与玩家 page, which already draws it with bars.
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
  const max = rankingMax(rows);
  if (max <= 0n) return null;
  const marks = [0n, 1n, 2n, 3n, 4n].map((i) => (max * BigInt(i)) / 4n);
  // Dense instrument: more rows share one scale so the hero card fills with
  // measurements instead of empty panel.
  const visible = rows.slice(0, 7);

  return (
    <div className="playtime-ruler">
      <div className="ruler-grid">
        <span />
        {/* Purely visual: the rows below carry the same numbers as text. The first
            graduation goes through the formatter like the rest - it was a hardcoded
            `'0'`, which is neither the unit the other four labels are in nor a value a
            formatter can be asked for. */}
        <div className="ruler-scale" aria-hidden="true">
          {marks.map((mark, index) => (
            <span key={index}>{formatCompactTicks(mark.toString())}</span>
          ))}
        </div>
        <span />
        {visible.map((row) => {
          // The same helper the ruler's own bars use, so the name, the track and the
          // value cannot disagree about what a full-width bar means.
          const share = rowShare(row.ticks, max);
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
                {/* A one-minute world against a sixty-day scale is 0.001% of the
                    track: a sub-pixel fill that reads as no time at all, beside a
                    number that says otherwise. Every non-zero share keeps a 3px
                    floor, and a zero reading stays invisible rather than claiming
                    a sliver it did not measure. */}
                <span
                  className="ruler-fill"
                  style={{ width: share > 0 ? `max(${share}%, 3px)` : '0%' }}
                />
              </span>
              {/* A world whose directory is gone has no current reading. Showing
                  "0 秒" would claim it was never played, which is a different and
                  untrue statement, so the value column says what happened. This is the
                  page's only reading of that world now, so there is nothing left for
                  it to disagree with. */}
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
  onWorlds,
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
  onWorlds: () => void;
  onTimeline: () => void;
  onObservation: () => void;
  players: string[];
  playersNone?: boolean;
  onPlayers: (ids: string[], none?: boolean) => void;
}) {
  const [ranking, setRanking] = useState<RankingDimension>('worlds');
  const data = useMemo(
    () => summarize(report, playersNone ? null : players),
    [report, players, playersNone],
  );
  // One mapping drives the switch's pressed state AND the ruler above it, so the
  // selected pill and the rows it plots cannot disagree. The ruler is the whole
  // ranking now - the second list that this switch also drove is gone (see
  // `PlaytimeRuler`), and with it the two row caps that used to differ.
  const panels = useMemo(() => rankingPanel(ranking, data), [ranking, data]);
  const timelineScope = useMemo(
    () => ({ ...emptyScope, uuids: players, players_none: playersNone }),
    [players, playersNone],
  );
  /* The one player control on the page. The empty state below points at THIS picker
     rather than rendering a second one: two triggers for one dialog is the same
     control twice, and this page has one thing to say about who is being counted. */
  const playerPicker = useRef<HTMLDivElement>(null);
  const openPlayerPicker = () =>
    playerPicker.current
      ?.querySelector<HTMLButtonElement>('button.player-trigger')
      ?.click();
  const issues = groupIssues(
    report.issues.filter((i) => i.kind !== 'EMPTY_STATS'),
  );
  const tracked = trackingTotals(tracking, playersNone ? null : players);
  /* The three observed-duration figures are filtered by the same player selection as
     everything else here, so with no player chosen they have no reading at all:
     `trackingTotals(tracking, null)` sums an empty selection and hands back 0n, and
     three rows of `0 秒` would say "nothing was ever observed" about an archive that
     has been observing all along. Same `—` as the hero, and for the same reason the
     hero uses it. The counts beside them stay 0: the number of worlds and players in
     the current selection is honestly zero, which is a statement about the selection
     rather than about the archive. */
  const observed = (ticks: bigint) =>
    playersNone
      ? UNKNOWN_DURATION
      : tracking?.started_at
      ? formatTickTotal(ticks.toString())
      : '等待首次观察';
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
            {playersNone ? 0 : data.worlds.length} 个世界 ·{' '}
            {report.instances.length} 个 PCL 实例
            <span
              className="count-hint"
              tabIndex={0}
              aria-label="统计口径：世界数按当前玩家筛选；实例数为档案内全部 PCL 实例"
              title="按当前玩家筛选后的世界数；实例数为档案内全部 PCL 实例"
            >
              口径
            </span>
          </p>
        </div>
        <div className="dashboard-picker" ref={playerPicker}>
          <PlayerPicker
            report={report}
            value={players}
            none={playersNone}
            onChange={onPlayers}
          />
        </div>
      </div>
      <div className="overview-grid">
        <div className="career-total">
          <div className="career-copy">
            <span className="metric-label">
              <Clock3 size={16} />
              累计游玩时长
            </span>
            {/* Not 0 秒 and not `0`: with no player chosen there is no reading to
                report, and a zero would be read as one. The block below says which
                state this is and how to leave it. */}
            <strong>
              {playersNone
                ? UNKNOWN_DURATION
                : formatTickTotal(data.current.toString())}
            </strong>
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
            {playersNone ? (
              /* An actionable empty state, in the place the reading would be. The
                 choice is persisted, so it survives a restart: saying only "no data"
                 would send a reader to rescan an archive that is intact. */
              <div className="list-empty" role="status">
                <strong>未选择玩家，无法统计</strong>
                <p>
                  当前筛选是「未选择玩家」，所以没有可汇总的读数。该选择会保留到下次启动；选好玩家后这里会显示累计时长与世界分布。
                </p>
                <SecondaryButton onClick={openPlayerPicker}>
                  选择玩家
                </SecondaryButton>
              </div>
            ) : (
              <>
                {/* The switch sits in the card it changes, directly above the ruler it
                    redraws. It used to sit below the card, where it changed a surface
                    the reader had already passed: the two were 33px apart and it
                    still read as changing the list under it instead. */}
                {/* The two pressed-state buttons became an antd Segmented: the
                    control's semantics moved from role=group + aria-pressed to the
                    library's radio model (role=radiogroup with aria-checked
                    options). The one mapping below still drives both this control
                    and the ruler it redraws, so the selection cannot disagree with
                    the plotted rows. */}
                <div
                  className="ranking-switch"
                  role="group"
                  aria-label="排行维度"
                >
                  <Segmented
                    value={ranking}
                    onChange={(next) => setRanking(next as RankingDimension)}
                    options={panels.map((panel) => ({
                      value: panel.dimension,
                      label: RANKING_TABS[panel.dimension],
                    }))}
                  />
                </div>
                {/* The ruler replaces an illustration and a caption. The headline
                    figure above stays; what changes is that the card now shows how the
                    total is made up, which is the thing the number alone cannot say.
                    It is also the page's only ranking: the full one lives on
                    世界与玩家, and the link below says so. */}
                <PlaytimeRuler
                  rows={
                    panels.find((panel) => panel.active)?.rows ?? data.worlds
                  }
                  onOpen={onOpen}
                />
              </>
            )}
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
            {/* Two readings, not a fraction. "3 / 2" over "世界 / 玩家" read like a
                ratio and left the reader to work out that it was two independent
                counts; each count now carries its own noun. The separator is bound
                to the first count with a no-break space so the narrow column wraps
                after "·" instead of starting a line with it. */}
            <strong>
              {`${data.worlds.length} 个世界\u00A0· ${
                playersNone
                  ? '未选择玩家'
                  : `${players.length || data.players.length} 个玩家`
              }`}
            </strong>
            <small>
              {report.instances.length} 个实例 · {data.missing} 个缺失
            </small>
          </article>
          <article>
            <span>
              <Sunrise size={16} aria-hidden="true" />
              本周观察增量
            </span>
            <strong>{observed(tracked.week)}</strong>
          </article>
          <article>
            <span>
              <CalendarDays size={16} aria-hidden="true" />
              本月观察增量
            </span>
            <strong>{observed(tracked.month)}</strong>
          </article>
          <article>
            <span>
              <Footprints size={16} aria-hidden="true" />
              累计追踪时长
            </span>
            <strong>{observed(tracked.ticks)}</strong>
          </article>
          <p className="tracking-note">
            只累计观察到的正向变化，回档不会扣减。周/月按本机日期的观察时间归档，不代表精确游戏会话时间。
          </p>
        </div>
      </div>
      {/* Where the second ranking used to start. The full list of worlds is on the
          page that owns it, so the only thing this position keeps is the way there -
          a link rather than a copy of the answer. */}
      <p className="ranking-link">
        <TextButton onClick={onWorlds}>
          在世界与玩家查看全部
          <span aria-hidden="true"> →</span>
        </TextButton>
      </p>
      <p className="scan-note">
        按最近有效读数排行；不含已缺失世界与不可读统计。共享根目录只计算一次，复制世界尚未去重。
      </p>
      <div className="health-summary">
        <div>
          <h3 className="metric-label">
            <ShieldCheck size={16} />
            数据状态
          </h3>
          {/* The counts are the scan line: three same-ink figures in a sentence
              read as prose; three tags read as a checklist. Neutral tags rather
              than antd's warning/error presets: those blend with the warm page
              tint and measured 4.46:1 here, under the gate's 4.5 floor. */}
          <p className="health-counts">
            <Tag>{health?.pending_count ?? issues.length} 项待处理</Tag>
            <Tag>{tracking?.rollback_count ?? 0} 次回档记录</Tag>
            <Tag>{data.unreadable} 条当前读数不可用</Tag>
          </p>
          {pseudo.seconds > 0n || pseudo.unknown || pseudo.baseline ? (
            <>
              <p>
                未归因运行时长 {formatSeconds(pseudo.seconds.toString())}
                {pseudo.instances ? ` · ${pseudo.instances} 个实例` : ''}
                {pseudo.unknown
                  ? ` · ${pseudo.unknown} 次会话未观测到结束`
                  : ''}
                {pseudo.baseline
                  ? ` · ${pseudo.baseline} 次会话缺少本地基线，未计入`
                  : ''}{' '}
                <TextButton onClick={onObservation}>查看实例观测</TextButton>
              </p>
              {/* Fine print under the counts, not a third fact beside them: same
                  caption size, so it separates by ink and measure instead. */}
              <p className="health-caveat">
                全部实例历史累计，不随玩家筛选；可能包含服务器游玩、加载和菜单停留，不等同于玩家游戏时长。
              </p>
            </>
          ) : null}
          {health?.confirmed_lineages ? (
            <p>
              已确认 {health.confirmed_lineages}{' '}
              条世界关联；继承时长未知，尚未计算去重估值。
            </p>
          ) : null}
        </div>
        <SecondaryButton onClick={onSettings}>查看数据健康</SecondaryButton>
      </div>
      {rollbacks.length ? (
        /* The hand-written <details> is a ghost Collapse; the `.rollback-list`
           class moves to the Collapse root so its type scale and spacing rules
           still key on it, and the header text plays the role `summary` played. */
        <Collapse
          ghost
          className="rollback-list"
          expandIcon={() => null}
          items={[
            {
              key: 'rollbacks',
              label: `最近回档记录 · 显示 ${rollbacks.length} 条`,
              children: rollbacks.map((r, index) => (
                <article
                  key={`${r.world_path}:${r.uuid}:${r.detected_at}:${index}`}
                >
                  <strong>{r.world_name}</strong>
                  <p>
                    {data.players.find(([id]) => id === r.uuid)?.[1] ?? r.uuid}{' '}
                    · {formatTickTotal(r.old_ticks)} →{' '}
                    {formatTickTotal(r.new_ticks)}
                  </p>
                  <p>
                    {new Date(r.detected_at).toLocaleString()} · 本次增量
                    0，历史保留
                  </p>
                </article>
              )),
            },
          ]}
        />
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
