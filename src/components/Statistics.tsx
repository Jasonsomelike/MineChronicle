import { emptyScope } from '../lib/activity';
import { useResource } from '../lib/useResource';
import ReadStatus from './ReadStatus';
import { useEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';
import { Input, Pagination, Segmented, Switch, Table, Tabs } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  BarChart3,
  Search,
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
  statisticUnitSuffix,
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
import { UNKNOWN_DURATION, formatTickTotal } from '../lib/duration';
import ActivityFilters from './ActivityFilters';
import StatIconPreview from './StatIconPreview';
import type { IconSelection } from './StatIconPreview';
import { TextButton } from './ui';
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
  /* The three columns. The reading column's sort is server-side: no compare
     function, only the controlled cycle default → descend → ascend → default
     (sortDirections ['descend','ascend'] over a controlled sortOrder reproduces
     the hand-rolled three-state order exactly, including reaching 默认顺序
     again). The three-state `title` hint and the `aria-sort` value travel on the
     header cell via onHeaderCell, as the hand-written th carried them. */
  const statColumns: TableColumnsType<StatisticsPage['rows'][number]> = [
    {
      title: '分类 / 统计键',
      dataIndex: 'key',
      render: (_, row) => {
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
                      const { naturalWidth: width, naturalHeight: height } =
                        e.currentTarget;
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
                    : `分类占位 · ${local?.reason ?? '尚未找到可用游戏模型'}`
                }
              >
                {(() => {
                  const CatIcon =
                    groupIcons[
                      (row.category.split(':').pop() ??
                        'other') as keyof typeof groupIcons
                    ] ?? groupIcons.other;
                  const letter = (row.label ?? resource?.english ?? row.key)
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
              {row.resources?.some((r) => r.origin === 'reviewed') ? (
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
        );
      },
    },
    {
      title: '读数',
      dataIndex: 'value',
      sorter: true,
      sortDirections: ['descend', 'ascend'],
      sortOrder:
        sort === 'value_desc'
          ? 'descend'
          : sort === 'value_asc'
          ? 'ascend'
          : null,
      onHeaderCell: () => ({
        title:
          sort === 'value_desc'
            ? '当前降序；切换为升序（按原始读数）'
            : sort === 'value_asc'
            ? '当前升序；恢复默认顺序'
            : '当前默认顺序；切换为降序（按原始读数）',
        'aria-sort':
          sort === 'value_desc'
            ? 'descending'
            : sort === 'value_asc'
            ? 'ascending'
            : 'none',
      }),
      render: (_, row) =>
        row.value !== null ? (
          <span
            className="stat-reading"
            title={statisticRawTitle(row.value, row.unit)}
          >
            <span className="stat-value">
              {formatStatistic(row.value, row.unit)}
            </span>
            {statisticUnitSuffix(row.unit) ? (
              <small className="stat-unit">
                {statisticUnitSuffix(row.unit)}
              </small>
            ) : null}
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
        ),
    },
    {
      title: '来源',
      dataIndex: 'sources',
      render: (_, row) =>
        row.sources === 1 ? (
          <span className="stat-provenance-count">1 份</span>
        ) : (
          <details className="stat-provenance">
            <summary>{row.sources} 份</summary>
            <div>{row.source_packs?.join('、') || '本地世界'}</div>
            {row.resources?.map((r, i) => (
              <div key={i}>
                {row.resources.length > 1 ? (
                  <b>
                    {r.label ?? r.english} · {r.packs.join('、')}
                  </b>
                ) : null}
                <span>{r.translation_source ?? '未找到可用语言资源'}</span>
                {r.english && r.english !== r.label ? (
                  <span>{r.english}</span>
                ) : null}
              </div>
            ))}
          </details>
        ),
    },
  ];
  return (
    <section className="statistics" aria-label="更多统计">
      <div className="library-heading">
        <h2>
          <BarChart3 size={18} />
          更多统计
        </h2>
        <span title="按当前玩家筛选的有效统计份数；不等于档案内全部世界数">
          {/* Not a 0 before the first read arrives: "所选玩家 0 份有效统计" reads as
              "there is nothing", which is a different statement from "not read yet". */}
          所选玩家 {data ? data.sources : UNKNOWN_DURATION} 份有效统计
        </span>
      </div>
      {/* One band of controls, and then the table. It used to be nine stacked bands
          between the heading and the first row of data: five of them were a single
          control each, so the reader scrolled a whole screen of chrome to reach the
          numbers, and the two blocks that are maintenance rather than reading sat
          above the table as well. The order is now the one the page is read in -
          what is being counted, then the count, then the tools that keep the count
          working. */}
      <div className="statistics-toolband">
        <div className="statistics-filters">
          <ActivityFilters
            report={report}
            scope={scope}
            onChange={(s) => {
              setOffset(0);
              onScope(s);
            }}
          />
          <div className="library-toolbar statistics-toolbar">
            <Input
              className="statistics-search"
              aria-label="搜索统计分类或键"
              prefix={<Search size={15} aria-hidden="true" />}
              allowClear
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
              placeholder="钻石矿石、跳跃或模组 ID"
            />
            <span className="stat-results-count" aria-live="polite">
              {loading
                ? '读取中…'
                : data
                ? `${data.total.toLocaleString('zh-CN')} 项`
                : UNKNOWN_DURATION}
            </span>
          </div>
        </div>
        <div className="statistics-context">
          {/* The scope pair became a Segmented (radio model); the pressed-state
              buttons and their aria-selected tabs are retired with the rest of
              the hand-rolled tablist. */}
          <div className="health-tabs" aria-label="统计口径">
            <Segmented
              value={mode}
              onChange={(next) => {
                setMode(next as string);
                setOffset(0);
              }}
              options={[
                { value: 'current', label: '最近存档读数' },
                { value: 'initial', label: '首次导入历史' },
              ]}
            />
          </div>
          {data?.unavailable ? (
            <span className="stat-unavailable">
              {data.unavailable} 份来源暂不可读
            </span>
          ) : null}
        </div>
        {/* The category strip is antd Tabs: the icon and the count travel in each
            tab's label, and the library owns the roving tabindex, Home/End,
            wrapping arrows and overflow scrolling that the hand-rolled version
            implemented key by key - `categoryTabs` and its focus plumbing are
            gone with them. The sr-only line keeps the tablist named. */}
        <span className="sr-only">统计类别</span>
        <div className="statistics-categories">
          <Tabs
            activeKey={group}
            onChange={(id) => {
              setGroup(id as StatisticsGroup);
              setOffset(0);
            }}
            items={statisticsGroups.map(([id, label]) => {
              const Icon = groupIcons[id];
              const count =
                id === 'all'
                  ? categoryTotal
                  : data?.categories.find((category) => category.id === id)
                      ?.count ?? 0;
              return {
                key: id,
                label: (
                  <span className="stat-category-tab">
                    <Icon size={15} aria-hidden="true" />
                    <span>{label}</span>
                    <small title={`${count.toLocaleString('zh-CN')} 项`}>
                      {new Intl.NumberFormat('zh-CN', {
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(count)}
                    </small>
                  </span>
                ),
              };
            })}
          />
        </div>
        <div className="filter-summary">
          <span>玩家选择与其他页面同步；其他筛选仅影响本页。</span>
          <div className="filter-tools">
            <div className="health-tabs" aria-label="表格密度">
              <Segmented
                value={density}
                onChange={(next) =>
                  setDensity(next as 'compact' | 'comfortable')
                }
                options={[
                  { value: 'compact', label: '紧凑' },
                  { value: 'comfortable', label: '舒适' },
                ]}
              />
            </div>
            <label className="setting-switch">
              {/* antd Switch carries the same role=switch semantics the ARIA
                  checkbox had. */}
              <Switch
                checked={showTech}
                onChange={(checked) => setShowTech(checked)}
              />
              显示技术字段
            </label>
            <TextButton onClick={clearFilters}>清除本页筛选</TextButton>
          </div>
        </div>
      </div>
      <ReadStatus {...request} />
      {/* The table, or the one empty state that says why there is none. Every empty
          branch is `.list-empty` with a `role="status"` heading and a sentence of its
          own - the page used to answer with three different wordings and a bare
          "暂无数据", so a reader could not tell a loading page from an empty one. */}
      {!data ? (
        <div className="list-empty" role="status">
          <strong>{error ? '统计读取失败' : '正在读取统计…'}</strong>
          <p>
            {error
              ? `${error} 保留已有读数，稍后会自动重试。`
              : '正在从档案读取这一页的读数。'}
          </p>
        </div>
      ) : data.rows.length ? (
        /* The big table is the migration's centrepiece: an antd Table carrying
           the same three columns. Density is the library's own (compact → small,
           comfortable → middle); the container keeps `aria-busy`/`is-loading`,
           and every per-row hook survives - `data-stat-id` rides `onRow` for the
           GSAP discovery animation, `.stat-sprite`/`.pixel-texture` stay on the
           img, and the icon fallback / size backfill chain is untouched. */
        <div
          className={`statistics-table${
            loading ? ' is-loading' : ''
          } is-${density}`}
          aria-busy={loading}
        >
          <Table
            rowKey={(row) => `${row.category}:${row.key}`}
            dataSource={data.rows}
            size={density === 'compact' ? 'small' : 'middle'}
            pagination={false}
            /* data-stat-id rides the row for the GSAP discovery animation; the
               data attribute needs the unknown-props cast because React's
               HTMLAttributes typing has no data-* index. */
            onRow={(row) =>
              ({
                'data-stat-id': `${row.category}:${row.key}`,
              } as unknown as HTMLAttributes<HTMLTableRowElement>)
            }
            columns={statColumns}
            /* Sorting is server-side; clicking the header only walks the
               controlled three-state cycle and resets the page, exactly as the
               hand-rolled heading button did. */
            onChange={(_pagination, _filters, sorter) => {
              const order = Array.isArray(sorter)
                ? sorter[0]?.order
                : sorter.order;
              setSort(
                order === 'descend'
                  ? 'value_desc'
                  : order === 'ascend'
                  ? 'value_asc'
                  : 'default',
              );
              setOffset(0);
            }}
          />
        </div>
      ) : (
        <div className="list-empty" role="status">
          <strong>
            {scope.players_none
              ? '未选择玩家，无法统计'
              : !data.sources
              ? '所选筛选还没有可统计的读数'
              : '没有匹配的统计'}
          </strong>
          <p>
            {scope.players_none
              ? '当前玩家筛选会保留到下次启动；选好玩家后这里会列出读数。'
              : !data.sources
              ? '换一个实例、世界或统计口径，或到「导入与设置」重新扫描档案。'
              : '可清除本页筛选，或换一个搜索词；读数本身没有丢失。'}
          </p>
        </div>
      )}
      {data && data.rows.length && data.total > data.page_size ? (
        /* Same simple-mode Pagination as the timeline: the offset semantics stay
           the one source of truth (current derives from offset, onChange writes
           it back as `(page-1) * page_size`), 50/页 or whatever page_size the
           backend sent, and the wrapping nav names the pager. */
        <nav className="pagination" aria-label="统计页码">
          <Pagination
            simple
            disabled={loading}
            current={Math.floor(offset / data.page_size) + 1}
            pageSize={data.page_size}
            total={data.total}
            showSizeChanger={false}
            onChange={(page) => setOffset((page - 1) * data.page_size)}
          />
        </nav>
      ) : null}
      {/* Everything below the table is read only on request. The overview answers
          "what do these rows add up to", which is a different question from the list
          and used to push the list off the first screen; the icon block is
          maintenance, not reading. Both are disclosures, both start closed. */}
      <details className="statistics-overview">
        <summary>
          <ChevronDown size={16} />
          <span>统计概览</span>
          <strong>
            {data?.sources
              ? formatTickTotal(data.counters.play_ticks ?? '0')
              : UNKNOWN_DURATION}
          </strong>
          <span className="stat-overview-caption">
            {metrics.length} 个指标 · {data ? data.sources : UNKNOWN_DURATION}{' '}
            份统计
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
                  : formatCount(data.counters[key] ?? '0')}
                {key.endsWith('_cm') ? (
                  <small className="stat-unit">m</small>
                ) : key === 'play_ticks' ? null : (
                  <small className="stat-unit">次</small>
                )}
              </strong>
            </div>
          ))}
        </div>
      </details>
      <details className="stat-icon-resources">
        <summary>
          <ChevronDown size={16} />
          <span>图标与资源</span>
          <span className="stat-overview-caption">
            <span role="status" className="stat-icon-status">
              {checkingResources
                ? '正在检查游戏图标…'
                : resourceStatus || '打开页面自动用缓存'}
            </span>
          </span>
        </summary>
        <div className="stat-icon-toolbar">
          <TextButton
            title="从本机已安装实例查找模型并补齐本页图标；不会写入游戏文件。打开页面只自动应用已有缓存。"
            disabled={loading || !data || checkingResources}
            onClick={() => void checkResources()}
          >
            检查本页游戏图标
          </TextButton>
          <TextButton
            disabled={resourceDetails.length === 0}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen
              ? '收起明细'
              : resourceDetails.length
              ? `查看明细（${resourceDetails.length}）`
              : '查看明细'}
          </TextButton>
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
                （未扫描
                mods）。若仍缺图，请点击「检查本页游戏图标」做完整检查。
              </p>
            ) : null}
            <div className="stat-detail-chips" aria-label="结果汇总">
              <span className="stat-detail-badge status-cached">
                缓存{' '}
                {resourceDetails.filter((d) => d.status === 'cached').length}
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
                错误{' '}
                {resourceDetails.filter((d) => d.status === 'error').length}
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
                      <small title={detail.source}>
                        {detail.source || UNKNOWN_DURATION}
                      </small>
                      <div className="stat-detail-reason">{detail.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>
      {preview ? (
        <StatIconPreview selection={preview} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}
