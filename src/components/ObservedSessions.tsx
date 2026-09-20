import { useState } from 'react';
import type { ObservedSessionsPage } from '../lib/tracking';
import { displayPath } from '../lib/path';
import { formatSeconds } from '../lib/duration';
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

export default function ObservedSessions({
  data,
  loading,
  onPage,
  onEdited,
}: {
  data: ObservedSessionsPage;
  loading: boolean;
  onPage: (page: number) => void;
  /** Called after a manual end is saved or undone, so totals are re-read. */
  onEdited: () => void;
}) {
  const { sessions } = data;
  const [editing, setEditing] = useState<Session | null>(null);
  const total = sessions.reduce(
    (sum, s) =>
      sum + (s.missing_baseline ? 0n : BigInt(s.pseudo_seconds ?? '0')),
    0n,
  );
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return (
    <section className="observed-sessions settings-card" aria-busy={loading}>
      <h3>
        实例观测时段 <span>全部玩家 · 不随玩家筛选</span>
      </h3>
      <div className="observation-summary">
        <div>
          <span>全部历史累计 · 未归因</span>
          <strong>{formatSeconds(data.total_seconds)}</strong>
          <small>{data.history_total ?? data.total} 次观测</small>
        </div>
        <div>
          <span>筛选结果累计 · 未归因</span>
          <strong>
            {formatSeconds(data.filtered_seconds ?? data.total_seconds)}
          </strong>
          <small>{data.total} 条符合条件</small>
        </div>
        <div>
          <span>本页小计 · 未归因</span>
          <strong>{formatSeconds(total.toString())}</strong>
          <small>本页 {sessions.length} 条记录</small>
        </div>
        <div>
          <span>正在运行</span>
          <strong>{data.running_sessions} 个实例</strong>
          <small>关闭后计算时长</small>
        </div>
      </div>
      {data.baseline_sessions || data.unknown_sessions ? (
        <p className="scan-note">
          未计入累计：{data.baseline_sessions} 次缺少本地基线，
          {data.unknown_sessions} 次结束时间未知（含运行中）。
        </p>
      ) : null}
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
      {sessions.length ? (
        <div className="observed-sessions-scroll">
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
              {sessions.map((s) => {
                const manual = s.ended_source === 'manual';
                return (
                  <tr key={s.id}>
                    <td title={displayPath(s.game_root)}>{s.instance_name}</td>
                    <td>
                      <time dateTime={s.started_at}>{date(s.started_at)}</time>
                    </td>
                    <td>
                      {s.ended_at ? (
                        <>
                          <time dateTime={s.ended_at}>{date(s.ended_at)}</time>
                          {manual ? (
                            // A typed value is an estimate. Marking it keeps it
                            // from reading exactly like an observed one.
                            <span
                              className="observed-sessions-tag"
                              title={
                                s.edited_at
                                  ? `手动填写于 ${date(s.edited_at)}`
                                  : '手动填写'
                              }
                            >
                              手动
                            </span>
                          ) : null}
                        </>
                      ) : s.status === 'running' ? (
                        '等待实例关闭'
                      ) : (
                        '结束时间未知'
                      )}
                    </td>
                    <td>
                      {!s.ended_at ? (
                        '—'
                      ) : s.missing_baseline ? (
                        <span className="scan-note">缺少本地基线</span>
                      ) : (
                        formatSeconds(s.pseudo_seconds ?? '0')
                      )}
                    </td>
                    <td>
                      {s.status === 'running'
                        ? '运行中'
                        : s.status === 'closed'
                        ? '已结束'
                        : '观测中断'}
                    </td>
                    <td>
                      {s.status === 'running' ? (
                        // The observer owns a live session; a manual end would be
                        // contradicted on the next poll.
                        <span className="scan-note">等待观测</span>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setEditing(s)}
                        >
                          {s.ended_at ? '修改' : '填写'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          暂无符合条件的观测。可清除筛选；检测到 PCL 实例运行后会自动记录。
        </p>
      )}
      <nav className="observation-pagination" aria-label="观测记录分页">
        <span role="status">
          {loading
            ? '正在读取…'
            : `第 ${data.page} / ${pages} 页 · 共 ${data.total} 条`}
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || data.page <= 1}
          onClick={() => onPage(data.page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || data.page >= pages}
          onClick={() => onPage(data.page + 1)}
        >
          下一页
        </button>
      </nav>
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
