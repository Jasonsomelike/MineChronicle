import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Radar, RefreshCw } from 'lucide-react';
import { loadObservedSessionsPage } from '../lib/tracking';
import type { ObservationQuery } from '../lib/tracking';
import { usePageActive } from './SessionPage';
import ObservedSessions from './ObservedSessions';
import ReadStatus from './ReadStatus';
import { useResource } from '../lib/useResource';
const empty = { game_root: '', from: '', to: '', status: '' };
export default function InstanceObservation({
  children,
  revision,
}: {
  children: ReactNode;
  revision: string;
}) {
  const active = usePageActive();
  const [query, setQuery] = useState<ObservationQuery>(empty);
  const [page, setPage] = useState(1);
  const boundary = useRef<number | undefined>(undefined);
  const snapshot = useRef<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const request = useResource(
    () =>
      loadObservedSessionsPage(page, {
        ...query,
        boundary: boundary.current,
        snapshot: snapshot.current,
      }),
    JSON.stringify({ query, page, revision, generation }),
    active,
  );
  const data = request.data;
  useEffect(() => {
    if (data) {
      boundary.current = data.boundary;
      snapshot.current = data.snapshot;
      setPage(data.page);
    }
  }, [data]);
  const change = (next: ObservationQuery) => {
    boundary.current = undefined;
    snapshot.current = undefined;
    setPage(1);
    setQuery(next);
  };
  const refreshHistory = () => {
    boundary.current = undefined;
    snapshot.current = undefined;
    setPage(1);
    setGeneration((v) => v + 1);
  };
  return (
    <section className="instance-observation" aria-label="实例观测">
      <div className="library-heading">
        <h2>
          <Radar size={22} /> 实例观测
        </h2>
        <span className="scan-note">记录保存在本地档案中</span>
      </div>
      <div className="settings-card observation-controls">{children}</div>
      <div className="activity-filters observation-filters">
        <label>
          实例
          <select
            aria-label="实例"
            value={query.game_root}
            onChange={(e) => change({ ...query, game_root: e.target.value })}
          >
            <option value="">全部实例</option>
            {data?.instances?.map((i) => (
              <option key={i.game_root} value={i.game_root}>
                {i.name} · {i.game_root}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={query.from}
            onChange={(e) => change({ ...query, from: e.target.value })}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={query.to}
            onChange={(e) => change({ ...query, to: e.target.value })}
          />
        </label>
        <label>
          状态
          <select
            aria-label="状态"
            value={query.status}
            onChange={(e) => change({ ...query, status: e.target.value })}
          >
            <option value="">全部状态</option>
            <option value="running">运行中</option>
            <option value="closed">已结束</option>
            <option value="interrupted">观测中断</option>
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          onClick={() => change(empty)}
        >
          清除筛选
        </button>
      </div>
      <p className="scan-note">
        按本地观测开始日期筛选；实例观测不随玩家选择变化。筛选结果与本页记录固定于上次刷新，全部历史累计随数据更新。
      </p>
      <button
        className="secondary-button"
        onClick={refreshHistory}
        disabled={request.loading}
      >
        <RefreshCw size={14} />{' '}
        {data?.new_records
          ? `有 ${data.new_records} 条新观测，刷新查看`
          : data?.history_changed
          ? '观测有更新，刷新查看'
          : '刷新观测'}
      </button>
      <ReadStatus {...request} />
      {data && (
        <ObservedSessions
          data={data}
          loading={request.loading}
          onPage={setPage}
          // A manual end changes durations and totals, so the whole page is
          // re-read rather than patched in place: the backend recomputes
          // attribution, and the dashboard's summary must follow.
          onEdited={refreshHistory}
        />
      )}
    </section>
  );
}
