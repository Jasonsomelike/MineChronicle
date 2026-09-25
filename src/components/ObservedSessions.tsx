import { useState } from 'react';
import type { ObservedSessionsPage } from '../lib/tracking';
import { displayPath } from '../lib/path';
import { formatGroupSeconds, formatSeconds } from '../lib/duration';
import SessionEndDialog from './SessionEndDialog';

const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

type Session = NonNullable<ObservedSessionsPage['sessions']>[number];

/** One session row. Shared by every group's table. */
function SessionRow({
  session,
  onEdit,
}: {
  session: Session;
  onEdit: (session: Session) => void;
}) {
  const manual = session.ended_source === 'manual';
  return (
    <tr>
      <td title={displayPath(session.game_root)}>{session.instance_name}</td>
      <td>
        <time dateTime={session.started_at}>{date(session.started_at)}</time>
      </td>
      <td>
        {session.ended_at ? (
          <>
            <time dateTime={session.ended_at}>{date(session.ended_at)}</time>
            {manual ? (
              // A typed value is an estimate. Marking it keeps it from reading
              // exactly like an observed one.
              <span
                className="observed-sessions-tag"
                title={
                  session.edited_at
                    ? `手动填写于 ${date(session.edited_at)}`
                    : '手动填写'
                }
              >
                手动
              </span>
            ) : null}
          </>
        ) : session.status === 'running' ? (
          '等待实例关闭'
        ) : (
          '结束时间未知'
        )}
      </td>
      <td>
        {!session.ended_at ? (
          '—'
        ) : session.missing_baseline ? (
          <span className="scan-note">缺少本地基线</span>
        ) : (
          formatSeconds(session.pseudo_seconds ?? '0')
        )}
      </td>
      <td>
        {session.status === 'running'
          ? '运行中'
          : session.status === 'closed'
          ? '已结束'
          : '观测中断'}
      </td>
      <td>
        {session.status === 'running' ? (
          // The observer owns a live session; a manual end would be contradicted
          // on the next poll.
          <span className="scan-note">等待观测</span>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => onEdit(session)}
          >
            {session.ended_at ? '修改' : '填写'}
          </button>
        )}
      </td>
    </tr>
  );
}

function SessionTable({
  sessions,
  onEdit,
}: {
  sessions: Session[];
  onEdit: (session: Session) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>实例</th>
          <th>观测开始时间</th>
          <th>观测结束时间</th>
          <th>未归因运行时长</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} onEdit={onEdit} />
        ))}
      </tbody>
    </table>
  );
}

/** One instance's own pager. Rendered inside the group it belongs to. */
function GroupPagination({
  page,
  pageCount,
  recordCount,
  loading,
  onPage,
}: {
  page: number;
  pageCount: number;
  recordCount: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const single = pageCount <= 1;
  return (
    <nav
      className="observation-pagination observation-group-pagination"
      aria-label="本实例观测记录分页"
    >
      <span role="status">
        {loading
          ? '正在读取…'
          : `第 ${page} / ${pageCount} 页 · 共 ${recordCount} 条`}
      </span>
      <button
        type="button"
        className="secondary-button"
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={loading || single || page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}

export default function ObservedSessions({
  data,
  loading,
  onGroupPage,
  onEdited,
}: {
  data: ObservedSessionsPage;
  loading: boolean;
  /** Page one instance's records without moving any other instance's. */
  onGroupPage: (gameRoot: string, page: number) => void;
  /** Called after a manual end is saved or undone, so totals are re-read. */
  onEdited: () => void;
}) {
  const { sessions } = data;
  const [editing, setEditing] = useState<Session | null>(null);
  // Falls back to one synthetic group when the backend sent none, which keeps the
  // preview fixture and any older archive rendering instead of showing an empty
  // list.
  //
  // The fallback is also why `page` / `page_count` are optional on the type: an
  // archive written before per-instance paging sends groups without them, and one
  // page of one instance is the honest reading for a synthetic group.
  const groups: NonNullable<ObservedSessionsPage['groups']> = data.groups
    ?.length
    ? data.groups
    : sessions.length
    ? [
        {
          game_root: sessions[0].game_root,
          name: sessions[0].instance_name,
          sessions,
          session_count: sessions.length,
          seconds: sessions
            .reduce(
              (sum, s) =>
                sum +
                (s.missing_baseline || !s.ended_at
                  ? 0n
                  : BigInt(s.pseudo_seconds ?? '0')),
              0n,
            )
            .toString(),
          unknown_sessions: sessions.filter((s) => !s.ended_at).length,
          baseline_sessions: sessions.filter((s) => s.missing_baseline).length,
          page: 1,
          page_count: 1,
        },
      ]
    : [];
  const total = sessions.reduce(
    (sum, s) =>
      sum + (s.missing_baseline ? 0n : BigInt(s.pseudo_seconds ?? '0')),
    0n,
  );
  return (
    <section className="observed-sessions settings-card" aria-busy={loading}>
      <h3>
        实例观测时段 <span>全部玩家 · 不随玩家筛选</span>
      </h3>
      {/* One compact line instead of four large cards.
          Three of the four figures were the same quantity at different scopes (all
          history, the filtered set, this page), so as equal-sized cards they read as
          four unrelated numbers and pushed the instance list below the fold. The
          headline is the filtered total, since that is what the list below shows;
          the other scopes are inline qualifiers. */}
      <div
        className="observation-summary"
        role="group"
        aria-label="观测时段汇总"
      >
        <p className="observation-headline">
          <strong>
            {formatSeconds(data.filtered_seconds ?? data.total_seconds)}
          </strong>
          <span className="observation-headline-label">未归因运行时长</span>
        </p>
        <dl className="observation-facts">
          <div>
            <dt>全部历史</dt>
            <dd>{formatSeconds(data.total_seconds)}</dd>
            <small>{data.history_total ?? data.total} 次观测</small>
          </div>
          <div>
            <dt>筛选结果</dt>
            <dd>{data.total} 条</dd>
            <small>
              {data.total === (data.history_total ?? data.total)
                ? '未筛选'
                : `共 ${data.history_total ?? data.total} 条`}
            </small>
          </div>
          <div>
            <dt>本页</dt>
            <dd>{sessions.length} 条</dd>
            <small>{formatSeconds(total.toString())}</small>
          </div>
          <div>
            <dt>正在运行</dt>
            <dd>{data.running_sessions} 个</dd>
            <small>关闭后计算</small>
          </div>
        </dl>
        {data.baseline_sessions || data.unknown_sessions ? (
          <p className="observation-excluded">
            未计入累计：{data.baseline_sessions} 次缺少本地基线，
            {data.unknown_sessions} 次结束时间未知（含运行中）。
          </p>
        ) : null}
      </div>
      <details className="observation-explanation">
        <summary>如何计算这些时间</summary>
        <p className="muted">
          每 3
          秒检查一次进程，时间按秒显示。未归因运行时长是观测时长扣除本地统计增量后的差额，可能包含服务器游玩、加载和菜单停留，不能确认是否连接服务器，也不与玩家时长相加。
        </p>
        <p className="muted">
          结束后 15
          分钟内读到的增量会尝试归入本次会话，最迟截止到下一次启动。首次读取本地世界只能建立基线，无法确认历史读数属于哪次会话；这类会话标记为“缺少本地基线”，不计入累计。新读数到达后结果可能更新。
        </p>
        <p className="muted">
          暂停追踪或退出软件时，无法确认实例何时结束，结束时间留空。可以手动填写真实
          的结束时间，填好后这段时间才会计入统计；手动填写的时间会标出来，也能撤销。
          这里保留全部历史，可按页查看。
        </p>
      </details>
      {groups.length ? (
        <div className="observed-sessions-scroll">
          {groups.map((group) => {
            // The pager is per instance, so these describe this instance's
            // records only - never a slice of every instance's records at once.
            const pageCount = Math.max(1, group.page_count ?? 1);
            const page = Math.min(Math.max(1, group.page ?? 1), pageCount);
            return (
              <details
                key={group.game_root}
                className="observed-group"
                // Collapsed by default so the list reads as one line per instance
                // and the totals can be compared at a glance. No `open` prop is
                // passed: that makes the element uncontrolled, so it opens and
                // closes natively and cannot be pinned shut by a re-render.
              >
                <summary>
                  <strong title={displayPath(group.game_root)}>
                    {group.name}
                  </strong>
                  <span className="observed-group-total">
                    {formatGroupSeconds(group.seconds)}
                  </span>
                  <span className="observed-group-count">
                    {group.session_count} 次观测
                    {pageCount > 1 ? ` · 共 ${pageCount} 页` : ''}
                  </span>
                  {group.unknown_sessions ? (
                    <span className="observed-group-note">
                      {group.unknown_sessions} 次结束未知
                    </span>
                  ) : null}
                  {group.baseline_sessions ? (
                    <span className="observed-group-note">
                      {group.baseline_sessions} 次缺少本地基线
                    </span>
                  ) : null}
                </summary>
                <div className="observed-group-rows">
                  {group.sessions.length ? (
                    <SessionTable
                      sessions={group.sessions}
                      onEdit={setEditing}
                    />
                  ) : (
                    // Reached when this instance's next page sits beyond the
                    // records the payload carried. Page 1 is the one case where
                    // "other page" would be wrong: the reader is on the first
                    // page and the group simply is not in it yet.
                    <p className="muted">
                      {page > 1
                        ? '该实例的观测记录在其他页，翻页后可查看。'
                        : '本次读取未包含该实例的记录，刷新观测后可查看。'}
                    </p>
                  )}
                  <GroupPagination
                    page={page}
                    pageCount={pageCount}
                    recordCount={group.session_count}
                    loading={loading}
                    onPage={(next) => onGroupPage(group.game_root, next)}
                  />
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          暂无符合条件的观测。可清除筛选；检测到 PCL 实例运行后会自动记录。
        </p>
      )}
      {/* There is no list-level pager here on purpose. One pager over every
          instance could only ever say 「第 1 / 3 页 · 共 43 条」 while the reader
          was looking at one instance's records, so each group carries its own. */}
      {editing ? (
        <SessionEndDialog
          session={editing}
          onClose={() => setEditing(null)}
          onSaved={onEdited}
        />
      ) : null}
    </section>
  );
}
