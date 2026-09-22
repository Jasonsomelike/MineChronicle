import { emptyScope } from '../lib/activity';
import { useResource } from '../lib/useResource';
import ReadStatus from './ReadStatus';
import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ArrowUpDown,
  ChevronDown,
  ListFilter,
  Hand,
  Pickaxe,
  Hammer,
  MousePointer2,
  Unplug,
  PackagePlus,
  PackageMinus,
  Swords,
  Skull,
  Ellipsis,
} from 'lucide-react';
import {
  loadStatistics,
  formatCount,
  formatDistance,
  formatStatistic,
  statisticRawTitle,
  statisticsGroups,
} from '../lib/activity';
import type {
  ActivityScope,
  StatisticsPage,
  StatisticsSort,
  StatisticsGroup,
} from '../lib/activity';
import type { ScanSummary } from '../lib/scan';
import { formatTickTotal } from '../lib/duration';
import ActivityFilters from './ActivityFilters';
import StatIconPreview from './StatIconPreview';
import type { IconSelection } from './StatIconPreview';
import { discoverIcons, iconUrl } from '../lib/runtimeResources';
import type { Resolution, DiscoverDetail } from '../lib/runtimeResources';
import {
  animateDiscoveredStatIcons,
  newlyDiscoveredIds,
} from '../lib/statIconMotion';
import { usePageActive } from './SessionPage';
const groupIcons = {
  all: ListFilter,
  interaction: Hand,
  mined: Pickaxe,
  crafted: Hammer,
  used: MousePointer2,
  broken: Unplug,
  picked_up: PackagePlus,
  dropped: PackageMinus,
  killed: Swords,
  killed_by: Skull,
  custom: BarChart3,
  other: Ellipsis,
};
const metrics = [
  ['play_ticks', '游玩时长'],
  ['deaths', '死亡'],
  ['jumps', '跳跃'],
  ['mob_kills', '生物击杀'],
  ['leave_game_count', '离开游戏'],
  ['walk_cm', '步行距离'],
  ['sprint_cm', '疾跑距离'],
  ['fly_cm', '飞行距离'],
];
export default function Statistics({
  report,
  scope,
  onScope,
}: {
  report: ScanSummary;
  scope: ActivityScope;
  onScope: (s: ActivityScope) => void;
}) {
  const pageActive = usePageActive();
  const [mode, setMode] = useState('current'),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState<StatisticsSort>('default'),
    [group, setGroup] = useState<StatisticsGroup>('all'),
    [preview, setPreview] = useState<IconSelection | null>(null),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<StatisticsPage | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const categoryTabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOffset(0);
  }, [scope.uuids, scope.players_none]);
  const [discovered, setDiscovered] = useState<Record<string, Resolution>>({});
  const discoveredIdsRef = useRef<string[]>([]);
  const [resourceDetails, setResourceDetails] = useState<DiscoverDetail[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');
  const [showTech, setShowTech] = useState(false);
  useEffect(() => {
    setDiscovered({});
    discoveredIdsRef.current = [];
    setResourceDetails([]);
    setDetailsOpen(false);
  }, [scope]);
  useEffect(() => {
    const next = Object.keys(discovered).sort();
    const added = newlyDiscoveredIds(discoveredIdsRef.current, next);
    discoveredIdsRef.current = next;
    if (!added.length) return;
    const handle = requestAnimationFrame(() => {
      animateDiscoveredStatIcons(added);
    });
    return () => cancelAnimationFrame(handle);
  }, [discovered]);
  const [resourceStatus, setResourceStatus] = useState('');
  const [checkingResources, setCheckingResources] = useState(false);
  const [detailsMode, setDetailsMode] = useState<'none' | 'cache' | 'full'>(
    'none',
  );
  const detailsModeRef = useRef(detailsMode);
  detailsModeRef.current = detailsMode;
  const requestId = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  async function checkResources() {
    if (!data || checkingResources) return;
    const snapshot = data;
    const id = ++requestId.current;
    setCheckingResources(true);
    setResourceStatus('正在扫描本机实例并解析图标…');
    setDetailsOpen(true);
    setDetailsMode('full');
    // Re-check every non-air row so a correct runtime icon can replace a
    // wrong bundled catalog icon (e.g. spider that still looks like slabs).
    const targetRows = snapshot.rows.filter(
      (row) => row.key !== 'minecraft:air',
    );
    await discoverIcons(targetRows, { refreshKnown: true, cacheOnly: false })
      .then((result) => {
        if (id !== requestId.current || snapshot !== dataRef.current) return;
        setDiscovered((old) => ({ ...old, ...result.icons }));
        setResourceDetails(result.details);
        const ok =
          result.summary.cached +
          result.summary.resolved +
          result.summary.rendered;
        const noRoots = result.details.filter(
          (d) => !d.source && d.reason.includes('来源实例'),
        ).length;
        setResourceStatus(
          `完整检查：共 ${result.details.length} 项 · 成功 ${ok} · 未找到 ${result.summary.missing} · 错误 ${result.summary.error}` +
            (noRoots ? ` · 无来源根目录 ${noRoots}` : ''),
        );
        setDetailsOpen(true);
      })
      .catch(() => {
        if (id === requestId.current)
          setResourceStatus('本地资源检查失败，可重试');
      })
      .finally(() => {
        if (id === requestId.current) setCheckingResources(false);
      });
  }
  useEffect(() => {
    requestId.current++;
    setCheckingResources(false);
    setResourceStatus('');
    setDetailsMode('none');
    setResourceDetails([]);
  }, [data]);
  useEffect(() => {
    if (!pageActive || !data) return;
    // Include rows that already have a bundled catalog icon so a cached
    // runtime icon can replace a wrong/ugly bundled one on reopen.
    const missing = data.rows.filter((row) => row.key !== 'minecraft:air');
    if (!missing.length) {
      if (detailsModeRef.current !== 'full') {
        setResourceDetails([]);
        setDetailsMode('none');
      }
      return;
    }
    const id = ++requestId.current;
    void discoverIcons(missing, { cacheOnly: true })
      .then((result) => {
        if (id !== requestId.current || !result) return;
        const hits = Object.values(result.icons).filter(
          (entry) => entry.image,
        ).length;
        if (hits) {
          setDiscovered((old) => ({ ...old, ...result.icons }));
        }
        if (detailsModeRef.current === 'full') return;
        setResourceDetails(result.details);
        setDetailsMode('cache');
        setResourceStatus(
          hits
            ? `已应用 ${hits} 项本机缓存图标；其余需点「检查本页游戏图标」`
            : '本机缓存无命中；点「检查本页游戏图标」扫描 mods',
        );
      })
      .catch(() => {
        /* cache-only is silent on failure */
      });
  }, [data, pageActive]);
  useEffect(() => {
    if (!pageActive) setPreview(null);
  }, [pageActive]);
  const categoryTotal =
    data?.categories.reduce((total, category) => total + category.count, 0) ??
    0;
  const request = useResource(
    () => loadStatistics({ ...scope, mode, query, offset, sort, group }),
    JSON.stringify({
      scope,
      mode,
      query,
      offset,
      sort,
      group,
      scan: report.last_scan,
    }),
    pageActive,
    150,
  );
  const clearFilters = () => {
    setQuery('');
    setOffset(0);
    setGroup('all');
    setSort('default');
    setMode('current');
    onScope({
      ...emptyScope,
      uuids: scope.uuids,
      players_none: scope.players_none,
    });
  };
  useEffect(() => {
    if (request.data) {
      const lastOffset =
        Math.max(
          0,
          Math.ceil(request.data.total / request.data.page_size) - 1,
        ) * request.data.page_size;
      if (offset > lastOffset) setOffset(lastOffset);
      else setData(request.data);
    }
    setError(request.error);
    setLoading(request.loading);
  }, [request.data, request.error, request.loading, offset]);
  return (
    <section className="statistics" aria-label="更多统计">
      <div className="library-heading">
        <h2>
          <BarChart3 size={18} />
          更多统计
        </h2>
        <span title="按当前玩家筛选的有效统计份数；不等于档案内全部世界数">
          所选玩家 {data?.sources ?? 0} 份有效统计
        </span>
      </div>
      <ActivityFilters
        report={report}
        scope={scope}
        onChange={(s) => {
          setOffset(0);
          onScope(s);
        }}
      />
      <div className="stat-icon-toolbar">
        <span role="status" className="stat-icon-status">
          {checkingResources
            ? '正在检查游戏图标…'
            : resourceStatus || '图标：打开页面自动用缓存，完整检查需手动'}
        </span>
        <button
          type="button"
          className="text-button"
          title="从本机已安装实例查找模型并补齐本页图标；不会写入游戏文件。打开页面只自动应用已有缓存。"
          disabled={loading || !data || checkingResources}
          onClick={() => void checkResources()}
        >
          检查本页游戏图标
        </button>
        <button
          type="button"
          className="text-button"
          disabled={resourceDetails.length === 0}
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen
            ? '收起明细'
            : resourceDetails.length
            ? `查看明细（${resourceDetails.length}）`
            : '查看明细'}
        </button>
      </div>
      <div className="statistics-context">
        <div className="health-tabs" role="tablist" aria-label="统计口径">
          {[
            ['current', '最近存档读数'],
            ['initial', '首次导入历史'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {data?.unavailable ? (
          <span className="stat-unavailable">
            {data.unavailable} 份来源暂不可读
          </span>
        ) : null}
      </div>
      {detailsOpen && resourceDetails.length > 0 ? (
        <div
          className="stat-icon-details"
          role="region"
          aria-label="图标补齐明细"
        >
          {detailsMode === 'cache' ? (
            <p className="stat-detail-banner">
              下列结果来自<strong>缓存查询</strong>
              （未扫描 mods）。若仍缺图，请点击「检查本页游戏图标」做完整检查。
            </p>
          ) : null}
          <div className="stat-detail-chips" aria-label="结果汇总">
            <span className="stat-detail-badge status-cached">
              缓存 {resourceDetails.filter((d) => d.status === 'cached').length}
            </span>
            <span className="stat-detail-badge status-resolved">
              材质{' '}
              {resourceDetails.filter((d) => d.status === 'resolved').length}
            </span>
            <span className="stat-detail-badge status-rendered">
              已渲染{' '}
              {resourceDetails.filter((d) => d.status === 'rendered').length}
            </span>
            <span className="stat-detail-badge status-missing">
              未找到{' '}
              {resourceDetails.filter((d) => d.status === 'missing').length}
            </span>
            <span className="stat-detail-badge status-error">
              错误 {resourceDetails.filter((d) => d.status === 'error').length}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>统计</th>
                <th>结果</th>
                <th>来源 / 原因</th>
              </tr>
            </thead>
            <tbody>
              {resourceDetails.map((detail) => (
                <tr key={detail.id} data-status={detail.status}>
                  <td>
                    <strong>{detail.label}</strong>
                    <code>{detail.id}</code>
                  </td>
                  <td>
                    <span
                      className={`stat-detail-badge status-${detail.status}`}
                    >
                      {detail.status === 'cached'
                        ? '缓存'
                        : detail.status === 'resolved'
                        ? '材质'
                        : detail.status === 'rendered'
                        ? '已渲染'
                        : detail.status === 'error'
                        ? '错误'
                        : '未找到'}
                    </span>
                  </td>
                  <td>
                    <small title={detail.source}>{detail.source || '—'}</small>
                    <div className="stat-detail-reason">{detail.reason}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ReadStatus {...request} />
      <div className="filter-summary">
        <span>玩家选择与其他页面同步；其他筛选仅影响本页。</span>
        <div className="filter-tools">
          <div className="health-tabs" role="group" aria-label="表格密度">
            <button
              type="button"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity('compact')}
            >
              紧凑
            </button>
            <button
              type="button"
              aria-pressed={density === 'comfortable'}
              onClick={() => setDensity('comfortable')}
            >
              舒适
            </button>
          </div>
          <label className="setting-switch">
            <input
              type="checkbox"
              role="switch"
              checked={showTech}
              onChange={(e) => setShowTech(e.target.checked)}
            />
            显示技术字段
          </label>
          <button type="button" className="text-button" onClick={clearFilters}>
            清除本页筛选
          </button>
        </div>
      </div>
      <details className="statistics-overview">
        <summary>
          <ChevronDown size={16} />
          <span>统计概览</span>
          <strong>
            {data?.sources
              ? formatTickTotal(data.counters.play_ticks ?? '0')
              : '暂无数据'}
          </strong>
          <span className="stat-overview-caption">
            {data?.sources ?? 0} 份统计
          </span>
        </summary>
        <p className="scan-note">
          {mode === 'current'
            ? '不含已缺失世界和当前不可读来源。'
            : '首次有效导入时的累计读数。'}
          共享根目录只计算一次，复制世界尚未去重。
        </p>
        <div className="statistics-metrics">
          {metrics.map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>
                {loading || error
                  ? '…'
                  : !data?.sources
                  ? '暂无数据'
                  : key === 'play_ticks'
                  ? formatTickTotal(data.counters[key] ?? '0')
                  : key.endsWith('_cm')
                  ? formatDistance(data.counters[key] ?? '0')
                  : `${formatCount(data.counters[key] ?? '0')} 次`}
              </strong>
            </div>
          ))}
        </div>
      </details>
      <div
        className="statistics-categories"
        ref={categoryTabs}
        role="tablist"
        aria-label="统计类别"
      >
        {statisticsGroups.map(([id, label], index) => {
          const Icon = groupIcons[id];
          const count =
            id === 'all'
              ? categoryTotal
              : data?.categories.find((category) => category.id === id)
                  ?.count ?? 0;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={group === id}
              tabIndex={group === id ? 0 : -1}
              key={id}
              onClick={() => {
                setGroup(id);
                setOffset(0);
              }}
              onKeyDown={(event) => {
                const direction =
                  event.key === 'ArrowRight'
                    ? 1
                    : event.key === 'ArrowLeft'
                    ? -1
                    : 0;
                if (!direction && event.key !== 'Home' && event.key !== 'End')
                  return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                    ? statisticsGroups.length - 1
                    : (index + direction + statisticsGroups.length) %
                      statisticsGroups.length;
                setGroup(statisticsGroups[next][0]);
                setOffset(0);
                const tabs =
                  categoryTabs.current?.querySelectorAll<HTMLButtonElement>(
                    'button',
                  );
                tabs?.item(next).focus();
              }}
            >
              <Icon size={15} />
              <span>{label}</span>
              <small title={`${count.toLocaleString('zh-CN')} 项`}>
                {new Intl.NumberFormat('zh-CN', {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(count)}
              </small>
            </button>
          );
        })}
      </div>
      <div className="library-toolbar statistics-toolbar">
        <label>
          <Search size={15} />
          <input
            aria-label="搜索统计分类或键"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
            placeholder="钻石矿石、跳跃或模组 ID"
          />
        </label>
        <span className="stat-results-count" aria-live="polite">
          {loading
            ? '读取中…'
            : `${data?.total.toLocaleString('zh-CN') ?? 0} 项`}
        </span>
      </div>
      {data ? (
        <div
          className={`statistics-table${
            loading ? ' is-loading' : ''
          } is-${density}`}
          aria-busy={loading}
        >
          <table>
            <thead>
              <tr>
                <th>分类 / 统计键</th>
                <th
                  aria-sort={
                    sort === 'value_desc'
                      ? 'descending'
                      : sort === 'value_asc'
                      ? 'ascending'
                      : 'none'
                  }
                >
                  <button
                    className="stat-sort-heading"
                    title={
                      sort === 'value_desc'
                        ? '当前降序；切换为升序（按原始读数）'
                        : sort === 'value_asc'
                        ? '当前升序；恢复默认顺序'
                        : '当前默认顺序；切换为降序（按原始读数）'
                    }
                    onClick={() => {
                      setSort(
                        sort === 'default'
                          ? 'value_desc'
                          : sort === 'value_desc'
                          ? 'value_asc'
                          : 'default',
                      );
                      setOffset(0);
                    }}
                  >
                    读数{' '}
                    {sort === 'value_desc' ? (
                      <ArrowDownWideNarrow size={15} />
                    ) : sort === 'value_asc' ? (
                      <ArrowUpNarrowWide size={15} />
                    ) : (
                      <ArrowUpDown size={15} />
                    )}
                  </button>
                </th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => {
                const resource =
                  row.resources?.find((r) => r.icon) ?? row.resources?.[0];
                const local = discovered[`${row.category}:${row.key}`];
                const icon = local?.image
                  ? {
                      image: local.image,
                      size: 32,
                      width: local.width,
                      height: local.height,
                      kind: local.kind ?? 'item',
                      source: local.source,
                    }
                  : resource?.icon;
                const isAir = row.key === 'minecraft:air';
                return (
                  <tr
                    key={`${row.category}:${row.key}`}
                    data-stat-id={`${row.category}:${row.key}`}
                  >
                    <td>
                      <div className="stat-identity">
                        {icon ? (
                          <button
                            type="button"
                            className="stat-icon"
                            title={`查看${row.label ?? row.key}图标`}
                            aria-label={`查看${row.label ?? row.key}图标`}
                            onClick={() =>
                              setPreview({ label: row.label ?? row.key, icon })
                            }
                          >
                            <img
                              className={`stat-sprite${
                                icon.kind === 'item' ? ' pixel-texture' : ''
                              }`}
                              src={iconUrl(icon.image)}
                              onLoad={(e) => {
                                if (local?.image && !local.width) {
                                  const {
                                    naturalWidth: width,
                                    naturalHeight: height,
                                  } = e.currentTarget;
                                  setDiscovered((old) => ({
                                    ...old,
                                    [`${row.category}:${row.key}`]: {
                                      ...local,
                                      width,
                                      height,
                                    },
                                  }));
                                }
                              }}
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = '/stat-fallback.svg';
                              }}
                              width={icon.width ?? icon.size}
                              height={icon.height ?? icon.size}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                        ) : (
                          <span
                            className="stat-icon stat-icon-placeholder"
                            title={
                              isAir
                                ? '空气（无可见材质）'
                                : `分类占位 · ${
                                    local?.reason ?? '尚未找到可用游戏模型'
                                  }`
                            }
                          >
                            {(() => {
                              const CatIcon =
                                groupIcons[
                                  (row.category.split(':').pop() ??
                                    'other') as keyof typeof groupIcons
                                ] ?? groupIcons.other;
                              const letter = (
                                row.label ??
                                resource?.english ??
                                row.key
                              )
                                .replace(/^minecraft:/, '')
                                .slice(0, 1)
                                .toUpperCase();
                              return (
                                <>
                                  <CatIcon size={18} aria-hidden="true" />
                                  <span
                                    className="stat-placeholder-letter"
                                    aria-hidden="true"
                                  >
                                    {letter}
                                  </span>
                                </>
                              );
                            })()}
                          </span>
                        )}
                        <div className="stat-description">
                          <strong className="stat-label">
                            {row.label ?? resource?.english ?? row.key}
                          </strong>
                          {row.resources?.some(
                            (r) => r.origin === 'reviewed',
                          ) ? (
                            <small className="stat-supplement">补充译名</small>
                          ) : null}
                          {showTech ? (
                            <div className="stat-tech">
                              <small title={row.category}>
                                {row.category_label ?? row.category} ·{' '}
                                {row.key.includes(':')
                                  ? row.key.split(':')[0]
                                  : 'Minecraft'}
                              </small>
                              <code>{row.key}</code>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      {row.value !== null ? (
                        <span
                          className="stat-reading"
                          title={statisticRawTitle(row.value, row.unit)}
                        >
                          {formatStatistic(row.value, row.unit)}
                        </span>
                      ) : (
                        <details>
                          <summary>
                            {row.category === 'extra' ? '原始值' : '非整数数据'}
                          </summary>
                          {row.samples.map((s, i) => (
                            <pre key={i}>{s}</pre>
                          ))}
                        </details>
                      )}
                    </td>
                    <td>
                      {row.sources === 1 ? (
                        <span className="stat-provenance-count">1 份</span>
                      ) : (
                        <details className="stat-provenance">
                          <summary>{row.sources} 份</summary>
                          <div>
                            {row.source_packs?.join('、') || '本地世界'}
                          </div>
                          {row.resources?.map((r, i) => (
                            <div key={i}>
                              {row.resources.length > 1 ? (
                                <b>
                                  {r.label ?? r.english} · {r.packs.join('、')}
                                </b>
                              ) : null}
                              <span>
                                {r.translation_source ?? '未找到可用语言资源'}
                              </span>
                              {r.english && r.english !== r.label ? (
                                <span>{r.english}</span>
                              ) : null}
                            </div>
                          ))}
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data?.rows.length ? (
            <p>
              没有匹配的统计。可清除本页筛选，或检查所选玩家是否有对应读数。
            </p>
          ) : null}
        </div>
      ) : null}
      {data && data.total > data.page_size ? (
        <div className="pagination">
          <button
            title="上一页"
            aria-label="上一页"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - data.page_size))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {Math.floor(offset / data.page_size) + 1} /{' '}
            {Math.ceil(data.total / data.page_size)}
          </span>
          <button
            title="下一页"
            aria-label="下一页"
            disabled={loading || offset + data.page_size >= data.total}
            onClick={() => setOffset(offset + data.page_size)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
      {preview ? (
        <StatIconPreview selection={preview} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}
