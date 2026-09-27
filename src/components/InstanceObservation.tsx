import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import { Button, DatePicker, Select } from 'antd';
import { Radar, RefreshCw } from 'lucide-react';
import { loadObservedSessionsPage } from '../lib/tracking';
import type { ObservationQuery } from '../lib/tracking';
import { usePageActive } from './SessionPage';
import ObservedSessions from './ObservedSessions';
import ReadStatus from './ReadStatus';
import { TextButton } from './ui';
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
  const boundary = useRef<number | undefined>(undefined);
  const snapshot = useRef<string | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const request = useResource(
    () =>
      loadObservedSessionsPage(1, {
        ...query,
        boundary: boundary.current,
        snapshot: snapshot.current,
      }),
    JSON.stringify({ query, revision, generation }),
    active,
  );
  const data = request.data;
  useEffect(() => {
    if (data) {
      boundary.current = data.boundary;
      snapshot.current = data.snapshot;
    }
  }, [data]);
  /**
   * Move one instance's pager without moving any other instance's.
   *
   * Only the instance that was paged comes back, so `group_page` is replaced
   * rather than merged: leaving the previous instance's page in the query would
   * pull *its* records onto the new instance's page number.
   */
  const pageGroup = (gameRoot: string, groupPage: number) =>
    setQuery((previous) => ({
      ...previous,
      group_page: { ...(previous.group_page ?? {}), [gameRoot]: groupPage },
    }));
  const resetPaging = (next: ObservationQuery): ObservationQuery => ({
    ...next,
    group_page: null,
  });
  const change = (next: ObservationQuery) => {
    boundary.current = undefined;
    snapshot.current = undefined;
    setQuery(resetPaging(next));
  };
  const refreshHistory = () => {
    boundary.current = undefined;
    snapshot.current = undefined;
    setQuery(resetPaging);
    setGeneration((v) => v + 1);
  };
  // How many filters are narrowing the list, so the collapsed bar can say so
  // instead of hiding the fact that the list is filtered.
  const activeFilters = [
    query.game_root && '实例',
    query.from && '开始日期',
    query.to && '结束日期',
    query.status && '状态',
  ].filter(Boolean) as string[];
  return (
    <section className="instance-observation" aria-label="实例观测">
      <div className="library-heading">
        <h2>
          <Radar size={22} /> 实例观测
        </h2>
        <div className="heading-actions">
          <span className="scan-note">记录保存在本地档案中</span>
          {/* antd Button keeps the `.secondary-button` class; while the request is
              in flight its `loading` state swaps the lucide glyph for the
              library's spinner - the same feedback the disabled state gave, with
              motion. */}
          <Button
            className="secondary-button"
            icon={<RefreshCw size={14} />}
            onClick={refreshHistory}
            loading={request.loading}
            disabled={request.loading}
          >
            刷新观测
          </Button>
        </div>
      </div>
      <div className="settings-card observation-controls">{children}</div>
      {/* Collapsed by default: the filters are usually untouched, and expanded they
          pushed the first row of data more than 700px down the page. The summary
          states whether anything is actually filtering, so a hidden filter cannot
          silently hide records. */}
      <details className="filter-drawer" open={activeFilters.length > 0}>
        <summary>
          筛选
          {activeFilters.length ? (
            <span className="filter-badge">{activeFilters.join(' · ')}</span>
          ) : (
            <span className="filter-badge filter-badge-idle">未筛选</span>
          )}
        </summary>
        <div className="activity-filters observation-filters">
          <label>
            实例
            <Select
              aria-label="实例"
              value={query.game_root}
              onChange={(value) => change({ ...query, game_root: value })}
              options={[
                { value: '', label: '全部实例' },
                ...(data?.instances?.map((i) => ({
                  value: i.game_root,
                  label: `${i.name} · ${i.game_root}`,
                })) ?? []),
              ]}
            />
          </label>
          {/* The DatePickers format straight back to `YYYY-MM-DD` strings - the
              shape ObservationQuery has always carried over IPC. */}
          <label>
            开始日期
            <DatePicker
              value={query.from ? dayjs(query.from, 'YYYY-MM-DD') : null}
              onChange={(value) =>
                change({
                  ...query,
                  from: value ? value.format('YYYY-MM-DD') : '',
                })
              }
              allowClear
            />
          </label>
          <label>
            结束日期
            <DatePicker
              value={query.to ? dayjs(query.to, 'YYYY-MM-DD') : null}
              onChange={(value) =>
                change({
                  ...query,
                  to: value ? value.format('YYYY-MM-DD') : '',
                })
              }
              allowClear
            />
          </label>
          <label>
            状态
            <Select
              aria-label="状态"
              value={query.status}
              onChange={(value) => change({ ...query, status: value })}
              options={[
                { value: '', label: '全部状态' },
                { value: 'running', label: '运行中' },
                { value: 'closed', label: '已结束' },
                { value: 'interrupted', label: '观测中断' },
              ]}
            />
          </label>
          <TextButton onClick={() => change(empty)}>清除筛选</TextButton>
          <p className="scan-note">
            按本地观测开始日期筛选；实例观测不随玩家选择变化。筛选结果与本页记录固定于上次刷新，全部历史累计随数据更新。
          </p>
        </div>
      </details>
      {/* Only the "new records" prompt stays here; the plain refresh action moved up
          to the heading so it is reachable without scrolling past the summary. */}
      {data?.new_records || data?.history_changed ? (
        <p className="observation-stale">
          <Button
            className="secondary-button"
            icon={<RefreshCw size={14} />}
            onClick={refreshHistory}
            loading={request.loading}
            disabled={request.loading}
          >
            {data.new_records
              ? `有 ${data.new_records} 条新观测，刷新查看`
              : '观测有更新，刷新查看'}
          </Button>
        </p>
      ) : null}
      <ReadStatus {...request} />
      {data && (
        <ObservedSessions
          data={data}
          loading={request.loading}
          onGroupPage={pageGroup}
          // A manual end changes durations and totals, so the whole page is
          // re-read rather than patched in place: the backend recomputes
          // attribution, and the dashboard's summary must follow.
          onEdited={refreshHistory}
        />
      )}
    </section>
  );
}
