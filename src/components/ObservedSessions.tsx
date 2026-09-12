import type { TrackingSummary } from '../lib/tracking';
import { displayPath } from '../lib/path';

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

export default function ObservedSessions({
  sessions,
}: {
  sessions: NonNullable<TrackingSummary['sessions']>;
}) {
  const running = sessions.filter((s) => s.status === 'running').length;
  return (
    <section className="observed-sessions settings-card">
      <h3>
        实例观测时段
        <span>
          {running ? `${running} 个实例运行中` : '查看启动与关闭时间'}
        </span>
      </h3>
      <p className="muted">
        每 3
        秒检测一次游戏进程，时间精确到秒。包含加载和菜单时间，实际游戏时长以存档统计为准。
        暂停追踪或退出本软件时，未观测到的关闭时间留空。显示最近 50 次观测。
      </p>
      {sessions.length ? (
        <div className="observed-sessions-scroll">
          <table>
            <thead>
              <tr>
                <th>实例</th>
                <th>观测开始时间</th>
                <th>观测结束时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td title={displayPath(s.game_root)}>{s.instance_name}</td>
                  <td>
                    <time dateTime={s.started_at}>{date(s.started_at)}</time>
                  </td>
                  <td>
                    {s.ended_at ? (
                      <time dateTime={s.ended_at}>{date(s.ended_at)}</time>
                    ) : s.status === 'running' ? (
                      '等待实例关闭'
                    ) : (
                      '未观测到关闭'
                    )}
                  </td>
                  <td>
                    {s.status === 'running'
                      ? '运行中'
                      : s.status === 'closed'
                      ? '已结束'
                      : '观测中断'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          尚无观测记录；检测到 PCL 实例运行后自动开始记录。
        </p>
      )}
    </section>
  );
}
