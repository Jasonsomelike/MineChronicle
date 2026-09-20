import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Layers3,
  Globe2,
  Settings2,
  Radar,
  History,
  BarChart3,
} from 'lucide-react';
import {
  cancelScan,
  parseRootInput,
  scanGameRoots,
  loadLibrary,
  runtimeInfo,
  acknowledgeView,
  discoverPclFolders,
} from '../lib/scan';
import type {
  ScanProgress,
  ScanSummary,
  RuntimeInfo,
  PclLink,
} from '../lib/scan';
import { formatTickTotal } from '../lib/duration';

import { displayPath, pathKey } from '../lib/path';
import { groupIssues } from '../lib/issues';
import WorldLibrary from './WorldLibrary';
import DataHealth from './DataHealth';
import { loadHealth } from '../lib/health';
import type { HealthSummary } from '../lib/health';
import PclInstances from './PclInstances';
import Dashboard from './Dashboard';
import {
  loadTrackingStatus,
  loadTrackingSummary,
  setTrackingEnabled,
} from '../lib/tracking';
import type { TrackingStatus, TrackingSummary } from '../lib/tracking';
import PclConnection from './PclConnection';
import Timeline from './Timeline';
import Statistics from './Statistics';
import { emptyScope } from '../lib/activity';
import type { ActivityScope } from '../lib/activity';
import { loadPclSync } from '../lib/pclSync';
import type { PclSyncStatus } from '../lib/pclSync';
import {
  initialPlayers,
  initialPlayersNone,
  savePlayers,
} from '../lib/players';
import SessionPage from './SessionPage';
import StartupSettings from './StartupSettings';
import SelfPlayerSettings from './SelfPlayerSettings';
import InstanceObservation from './InstanceObservation';
import ZoomControls from './ZoomControls';
import { useResource } from '../lib/useResource';
import ReadStatus from './ReadStatus';
import ArchiveSettings from './ArchiveSettings';

const pages = [
  'dashboard',
  'instances',
  'worlds',
  'timeline',
  'statistics',
  'observation',
  'settings',
];
function routePage() {
  const page = window.location.hash.replace(/^#\/?/, '');
  return page === 'health'
    ? 'settings'
    : pages.includes(page)
    ? page
    : 'dashboard';
}

export default function ScanPanel() {
  const navIcons: Record<string, typeof LayoutDashboard> = {
    dashboard: LayoutDashboard,
    instances: Layers3,
    worlds: Globe2,
    settings: Settings2,
    observation: Radar,
    timeline: History,
    statistics: BarChart3,
  };
  const [view, setView] = useState(routePage);
  const [backgroundErrors, setBackgroundErrors] = useState<
    Record<string, string>
  >({});
  const [scope, setScope] = useState<ActivityScope>(() => ({
    ...emptyScope,
    uuids: initialPlayers(),
    players_none: initialPlayersNone(),
  }));
  const [statisticsScope, setStatisticsScope] = useState<ActivityScope>(() => ({
    ...emptyScope,
    uuids: initialPlayers(),
    players_none: initialPlayersNone(),
  }));
  const [timelineScope, setTimelineScope] = useState<ActivityScope>(() => ({
    ...emptyScope,
    uuids: initialPlayers(),
    players_none: initialPlayersNone(),
  }));
  function changeScope(next: ActivityScope) {
    setScope(next);
    // Persist the shared player selection so it survives a restart. All three
    // pages funnel through here; savePlayers was previously never called.
    savePlayers(next.uuids, next.players_none ?? false);
  }
  const sharedTimelineScope = useMemo(
    () => ({
      ...timelineScope,
      uuids: scope.uuids,
      players_none: scope.players_none,
    }),
    [timelineScope, scope.uuids, scope.players_none],
  );
  const sharedStatisticsScope = useMemo(
    () => ({
      ...statisticsScope,
      uuids: scope.uuids,
      players_none: scope.players_none,
    }),
    [statisticsScope, scope.uuids, scope.players_none],
  );
  const [pclStatus, setPclStatus] = useState<PclSyncStatus | null>(null);
  useEffect(() => {
    let active = true,
      running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const status = await loadPclSync();
        if (!active || !status) return;
        setPclStatus((old) =>
          JSON.stringify(old) === JSON.stringify(status) ? old : status,
        );
        if (status.link) setPcl(status.link);
        if (active) setBackgroundErrors((old) => ({ ...old, pcl: '' }));
      } catch (e) {
        if (active)
          setBackgroundErrors((old) => ({
            ...old,
            pcl: `PCL 联动暂不可用，将自动重试：${String(e)}`,
          }));
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  function openActivity(page: string, world_path = '') {
    if (world_path) {
      const setTarget =
        page === 'statistics' ? setStatisticsScope : setTimelineScope;
      setTarget((old) => ({
        ...old,
        world_path,
        world_paths: undefined,
        game_root: '',
        game_roots: null,
        instance_paths: null,
      }));
    }
    navigate(page);
  }
  const [tracking, setTracking] = useState<TrackingSummary | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus | null>(
    null,
  );
  useEffect(() => {
    let active = true,
      running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const status = await loadTrackingStatus();
        if (!active || !status) return;
        setTrackingStatus((old) =>
          JSON.stringify(old) === JSON.stringify(status) ? old : status,
        );
        if (active) setBackgroundErrors((old) => ({ ...old, tracking: '' }));
      } catch (cause) {
        if (active)
          setBackgroundErrors((old) => ({
            ...old,
            tracking: `追踪状态暂不可用，将自动重试：${String(cause)}`,
          }));
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function toggleTracking() {
    try {
      setTrackingStatus(await setTrackingEnabled(!trackingStatus?.enabled));
    } catch (cause) {
      setError(String(cause));
    }
  }
  function navigate(next: string) {
    if (next === view) return;
    scrollPositions.current[view] = window.scrollY;
    window.location.hash = `/${next}`;
    setView(next);
  }
  useEffect(() => {
    const changed = () => setView(routePage());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const scrollPositions = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    const positions = scrollPositions.current;
    window.scrollTo({
      top: positions[view] ?? 0,
      behavior: 'instant',
    });
    return () => {
      positions[view] = window.scrollY;
    };
  }, [view]);
  const [worldQuery, setWorldQuery] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [report, setReport] = useState<ScanSummary | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [today, setToday] = useState(() => new Date().toDateString());
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date().toDateString()), 60000);
    return () => clearInterval(timer);
  }, []);
  const totalsRead = useResource(
    loadTrackingSummary,
    `${report?.last_scan}:${trackingStatus?.revision}:${today}`,
    !!report,
  );
  const healthRead = useResource(loadHealth, report, !!report);
  useEffect(() => {
    if (totalsRead.data) setTracking(totalsRead.data);
  }, [totalsRead.data]);
  useEffect(() => {
    if (healthRead.data) setHealth(healthRead.data);
  }, [healthRead.data]);
  const [error, setError] = useState('');
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [pcl, setPcl] = useState<PclLink | null>(null);
  const [launcher, setLauncher] = useState('');

  async function connectPcl() {
    setError('');
    setBusy(true);
    try {
      const link = await discoverPclFolders();
      setPcl(link);
      setLauncher(link.launchers.length === 1 ? link.launchers[0] : '');
      inputDirty.current = true;
      setInput(link.folders.map((f) => displayPath(f.path)).join('\n'));
      if (!link.folders.length)
        setError('PCL 没有已保存的游戏文件夹，请先打开 PCL 或手动添加目录。');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  const [loading, setLoading] = useState(true);
  const inputDirty = useRef(false);
  const inputInitialized = useRef(false);
  // All refresh sources share one request generation and stale-response guard.
  const initialLibrary = useResource(
    loadLibrary,
    `${pclStatus?.revision}:${trackingStatus?.revision}`,
  );
  const initialRuntime = useResource(runtimeInfo, 'runtime');
  const initialPcl = useResource(discoverPclFolders, 'pcl-discovery');
  useEffect(() => {
    if (initialRuntime.data) setRuntime(initialRuntime.data);
  }, [initialRuntime.data]);
  useEffect(() => {
    if (initialPcl.data) setPcl(initialPcl.data);
  }, [initialPcl.data]);
  useEffect(() => {
    const library = initialLibrary.data;
    if (library) {
      setReport(library.report);
      if (!inputDirty.current && !inputInitialized.current) {
        setInput(library.inputs.map(displayPath).join('\n'));
        inputInitialized.current = true;
      }
    }
  }, [initialLibrary.data]);
  useEffect(() => {
    setLoading(initialLibrary.loading && !initialLibrary.data);
  }, [initialLibrary.loading, initialLibrary.data]);
  function applySavedReport(next: ScanSummary) {
    initialLibrary.refresh();
    setReport(next);
  }

  useEffect(() => {
    if (!report || !runtime) return;
    void acknowledgeView(report).catch(() => {});
  }, [report, runtime]);

  async function scan() {
    setError('');
    let paths: string[];
    try {
      paths = parseRootInput(input);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
      return;
    }
    setBusy(true);
    setCancelling(false);
    setProgress(null);
    try {
      const result = await scanGameRoots(
        paths,
        setProgress,
        pclStatus?.launcher &&
          paths.every((p) =>
            pclStatus.link?.folders.some((f) => pathKey(f.path) === pathKey(p)),
          )
          ? pclStatus.launcher
          : launcher || undefined,
      );
      if (result.cancelled) {
        setError('扫描已取消，已保存的世界与实例保持不变。');
      } else {
        applySavedReport(result);
      }
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await cancelScan();
    } catch {
      setError('无法发送取消请求，请等待当前扫描结束。');
      setCancelling(false);
    }
  }

  const issueGroups = groupIssues(
    (report?.issues ?? []).filter((i) => i.kind !== 'EMPTY_STATS'),
  );
  const emptyStats = (report?.issues ?? []).filter(
    (i) => i.kind === 'EMPTY_STATS',
  );
  const worldCount =
    report?.roots.reduce((sum, root) => sum + root.worlds.length, 0) ?? 0;
  return (
    <section className="foundation scan-panel" aria-label="MineChronicle 档案">
      <nav className="app-nav" aria-label="档案页面">
        {[
          ['dashboard', '生涯概览'],
          ['instances', '游戏实例'],
          ['worlds', '世界与玩家'],
          ['timeline', '时间线'],
          ['statistics', '更多统计'],
          ['observation', '实例观测'],
          ['settings', '导入与设置'],
        ].map(([id, label]) => {
          const Icon = navIcons[id];
          return (
            <button
              key={id}
              type="button"
              aria-current={view === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>
      <details className="status-center">
        <summary>
          <span
            className={
              trackingStatus?.enabled ? 'watch-dot active' : 'watch-dot'
            }
          />
          {trackingStatus?.running
            ? '正在同步存档'
            : trackingStatus?.active_instances?.length
            ? `正在追踪 ${trackingStatus.active_instances.length} 个实例`
            : trackingStatus?.finalizing_instances
            ? '游戏已退出，正在收尾同步'
            : trackingStatus?.enabled
            ? '追踪已就绪，等待游戏启动'
            : '追踪已暂停'}
          <span className="status-center-hint">
            {trackingStatus?.error ||
            Object.values(backgroundErrors).some(Boolean)
              ? '有服务异常 · 查看详情'
              : '运行状态'}
          </span>
        </summary>
        {pclStatus && view !== 'settings' ? (
          <button
            type="button"
            className="pcl-link-strip"
            onClick={() => navigate('instances')}
          >
            <Layers3 size={14} />
            <strong>PCL</strong>
            <span>
              {pclStatus.running
                ? '正在同步实例'
                : pclStatus.enabled
                ? '自动联动已开启'
                : '自动联动已暂停'}
            </span>
            <span>{pclStatus.current_instances.length} 个当前实例</span>
          </button>
        ) : null}
        {trackingStatus?.error ? (
          <p className="scan-error">{trackingStatus.error}</p>
        ) : null}
        {Object.entries(backgroundErrors)
          .filter(([, message]) => message)
          .map(([source, message]) => (
            <p className="background-warning" key={source}>
              {message}
            </p>
          ))}
      </details>
      {view === 'settings' && (
        <nav className="settings-jump" aria-label="设置分区">
          {[
            ['settings-identity', '身份'],
            ['settings-startup', '启动与显示'],
            ['settings-import', '导入与联动'],
            ['settings-archive', '档案与备份'],
            ['settings-health', '数据健康'],
          ].map(([id, label]) => (
            <button
              className="text-button"
              key={id}
              onClick={() =>
                document.getElementById(id)?.scrollIntoView({ block: 'start' })
              }
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div hidden={view !== 'settings'} className="settings-layout">
        <div
          className="settings-column"
          role="group"
          aria-label="个人与界面设置"
        >
          <div id="settings-identity">
            <SelfPlayerSettings report={report} />
          </div>
          <div id="settings-startup">
            <StartupSettings />
          </div>
          <section className="settings-card">
            <h2>窗口与显示</h2>
            <p>
              关闭窗口后继续在后台追踪游戏。点击系统托盘图标可重新打开，右键选择“彻底退出”停止软件。
            </p>
            <ZoomControls />
            <p className="scan-note">
              也可使用 Ctrl + 滚轮或 Ctrl + 加减号调整缩放，Ctrl + 0 恢复默认。
            </p>
          </section>
        </div>
        <div
          className="settings-column"
          id="settings-import"
          role="group"
          aria-label="联动与存档导入"
        >
          <SessionPage active={view === 'settings'} label="PCL 联动">
            <PclConnection
              status={pclStatus}
              onEnabled={(enabled) =>
                setPclStatus((s) => (s ? { ...s, enabled } : s))
              }
            />
          </SessionPage>
          <section className="settings-card settings-import">
            <h2 id="scan-title">读取本地存档</h2>
            {runtime ? (
              <div className="import-summary" role="status">
                <strong>
                  MineChronicle {runtime.version} ·{' '}
                  {runtime.embedded_assets ? '独立桌面版' : '开发服务器模式'}
                </strong>
                <details>
                  <summary>当前档案位置</summary>
                  <p>当前档案：{displayPath(runtime.database_path)}</p>
                </details>
                <p>
                  PCL 配置适配已启用 · 已保存{' '}
                  {report?.instances.length ?? runtime.pcl_instances} 个实例
                </p>
              </div>
            ) : null}
            <p>
              输入
              .minecraft、实例集合或游戏根目录，自动寻找下层存档。扫描只读取游戏文件，结果保存到
              MineChronicle 的本地数据库。
            </p>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void connectPcl()}
            >
              读取 PCL 文件夹
            </button>
            {pcl ? (
              <details className="pcl-link">
                <summary>PCL 文件夹列表 · {pcl.folders.length} 个</summary>
                <p>
                  来源：PCL
                  已保存的跨盘目录和正在运行的启动器。点击“扫描并保存”同步存档统计。
                </p>
                {pcl.launchers.length > 0 ? (
                  <label>
                    使用此 PCL 的全局设置
                    <select
                      value={launcher}
                      disabled={busy}
                      onChange={(e) => setLauncher(e.target.value)}
                    >
                      <option value="">仅使用实例明确配置</option>
                      {pcl.launchers.map((path) => (
                        <option key={path} value={path}>
                          {displayPath(path)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {pcl.folders.map((folder) => (
                  <p key={folder.path} className="world-path">
                    <strong>{folder.name}</strong> ·{' '}
                    {folder.available ? '可访问' : '目录不可访问'}
                    <br />
                    {displayPath(folder.path)}
                  </p>
                ))}
                {pcl.issues.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </details>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void scan();
              }}
            >
              <label htmlFor="game-roots">
                搜索目录 <span>每行一个，最多 32 个</span>
              </label>
              <textarea
                id="game-roots"
                value={input}
                onChange={(event) => {
                  inputDirty.current = true;
                  setInput(event.target.value);
                  setLauncher('');
                }}
                rows={3}
                disabled={busy || loading}
                placeholder={'例如 D:\\Games\\Minecraft\\.minecraft'}
                aria-describedby="scan-note"
              />
              <p id="scan-note" className="scan-note">
                自动寻找目录中的游戏存档，兼容不同 Minecraft
                版本。只读取文件，不修改游戏内容。
              </p>
              <div className="scan-actions">
                <button type="submit" disabled={busy || loading}>
                  {busy ? '扫描中…' : '扫描并保存'}
                </button>
                {busy ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={cancelling}
                    onClick={() => void cancel()}
                  >
                    {cancelling ? '正在取消…' : '取消扫描'}
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        </div>
      </div>
      <SessionPage active={view === 'settings'} label="档案与备份">
        <ArchiveSettings />
      </SessionPage>
      {view === 'settings' && (
        <>
          {initialLibrary.error && <ReadStatus {...initialLibrary} />}
          {initialRuntime.error && <ReadStatus {...initialRuntime} />}
          {initialPcl.error && <ReadStatus {...initialPcl} />}
        </>
      )}
      {(view === 'dashboard' || view === 'settings') && (
        <>
          {(view === 'dashboard' || totalsRead.error) && (
            <ReadStatus {...totalsRead} />
          )}
          {healthRead.error && <ReadStatus {...healthRead} />}
        </>
      )}
      <SessionPage active={view === 'observation'} label="实例观测">
        <InstanceObservation
          revision={`${trackingStatus?.revision}:${report?.last_scan}`}
        >
          {trackingStatus ? (
            <div className="watch-status">
              <span
                className={
                  trackingStatus.enabled ? 'watch-dot active' : 'watch-dot'
                }
              />
              <span>
                {trackingStatus.running
                  ? '正在同步存档'
                  : trackingStatus.enabled
                  ? trackingStatus.active_instances?.length
                    ? '正在跟踪运行中的 PCL 实例'
                    : trackingStatus.finalizing_instances
                    ? '实例已退出，正在收尾同步'
                    : '等待 PCL 实例启动'
                  : '自动追踪已暂停'}
              </span>
              <small>{trackingStatus.watched_directories} 个监控目录</small>
              <label className="tracking-toggle">
                <input
                  type="checkbox"
                  role="switch"
                  checked={trackingStatus.enabled}
                  onChange={() => void toggleTracking()}
                />
                自动追踪
              </label>
            </div>
          ) : null}
          {trackingStatus?.enabled &&
          trackingStatus.active_instances?.length ? (
            <div className="active-games">
              {trackingStatus.active_instances.map((item) => (
                <span key={item.game_root} title={displayPath(item.game_root)}>
                  <span className="watch-dot active" />
                  {item.name}
                </span>
              ))}
            </div>
          ) : null}
        </InstanceObservation>
      </SessionPage>
      {!loading && !busy && !worldCount && view !== 'settings' ? (
        <section className="empty-onboarding">
          <Globe2 size={36} />
          <h2>从你的第一个世界开始</h2>
          <p>导入 Minecraft 文件夹，即可查看玩家、世界和游玩统计。</p>
          <div className="scan-actions">
            <button
              onClick={() => {
                navigate('settings');
                requestAnimationFrame(() =>
                  document.getElementById('game-roots')?.focus(),
                );
              }}
            >
              选择游戏目录
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                navigate('settings');
                void connectPcl();
              }}
            >
              从 PCL 读取目录
            </button>
          </div>
        </section>
      ) : null}
      <p
        role="status"
        className="runtime-status"
        hidden={view !== 'settings' && !busy && !report?.cancelled}
      >
        {busy
          ? progress
            ? `已检查 ${progress.roots_done}/${progress.roots_total} 个目录、${progress.worlds_scanned} 个世界条目、${progress.player_files_scanned} 个统计文件`
            : '正在准备扫描…'
          : report
          ? `${
              report.cancelled ? '已取消，以下为部分结果' : '已保存的生涯档案'
            } · ${report.roots.length} 个独立根目录 · ${worldCount} 个世界`
          : loading
          ? '正在读取本地档案…'
          : '选择目录后开始首次导入。'}
      </p>
      {error ? (
        <p className="scan-error" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <div
          className={
            view === 'dashboard' ? 'dashboard-results' : 'scan-results'
          }
        >
          <SessionPage active={view === 'dashboard'} label="生涯概览">
            <Dashboard
              report={report}
              tracking={tracking}
              players={scope.uuids}
              playersNone={scope.players_none}
              onPlayers={(uuids, players_none) =>
                changeScope({ ...scope, uuids, players_none })
              }
              health={health}
              onTimeline={() => openActivity('timeline')}
              onObservation={() => navigate('observation')}
              onSettings={() => {
                navigate('settings');
                setTimeout(
                  () =>
                    document
                      .getElementById('settings-health')
                      ?.scrollIntoView({ block: 'start' }),
                  0,
                );
              }}
              onOpen={(path) => {
                setWorldQuery(displayPath(path));
                navigate('worlds');
              }}
            />
          </SessionPage>
          <div hidden={view !== 'settings'}>
            {report.saved ? (
              <div className="import-summary">
                <h3>
                  首次导入历史 · {formatTickTotal(report.historical_ticks)}
                </h3>
                <p>
                  所有已导入世界和玩家的首次读数之和，尚未进行复制世界去重。重复扫描不会重复累加。
                </p>
                {report.last_scan ? (
                  <p>最近扫描：{new Date(report.last_scan).toLocaleString()}</p>
                ) : null}
                {report.database_path ? (
                  <p className="world-path">
                    档案位置：{displayPath(report.database_path)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p>扫描已取消，本次结果未写入数据库。</p>
            )}
          </div>
          <div hidden={view !== 'instances'}>
            <PclInstances
              report={report}
              link={pcl}
              sync={pclStatus}
              onOpen={(path) => {
                setWorldQuery(path);
                navigate('worlds');
              }}
            />
          </div>
          <SessionPage active={view === 'worlds'} label="世界与玩家">
            <WorldLibrary
              report={report}
              query={worldQuery}
              onQuery={setWorldQuery}
              busy={busy}
              onSaved={applySavedReport}
              onActivity={openActivity}
            />
          </SessionPage>

          <SessionPage active={view === 'timeline'} label="时间线">
            <Timeline
              report={report}
              scope={sharedTimelineScope}
              onScope={(next) => {
                setTimelineScope(next);
                changeScope({
                  ...scope,
                  uuids: next.uuids,
                  players_none: next.players_none,
                });
              }}
              onOpen={(path) => {
                setWorldQuery(path);
                navigate('worlds');
              }}
            />
          </SessionPage>
          <SessionPage active={view === 'statistics'} label="更多统计">
            <Statistics
              report={report}
              scope={sharedStatisticsScope}
              onScope={(next) => {
                setStatisticsScope(next);
                changeScope({
                  ...scope,
                  uuids: next.uuids,
                  players_none: next.players_none,
                });
              }}
            />
          </SessionPage>
          <div hidden={view !== 'settings'}>
            {issueGroups.length ? (
              <details className="scan-issues" open>
                <summary>需要留意 · {issueGroups.length} 类问题</summary>
                {issueGroups.slice(0, 100).map((issue, index) => (
                  <div key={`${issue.kind}:${index}`}>
                    <p>{issue.message}</p>
                    <details>
                      <summary>涉及 {issue.paths.length} 个位置</summary>
                      {issue.paths.slice(0, 100).map((path) => (
                        <p key={path}>
                          <code>{displayPath(path)}</code>
                        </p>
                      ))}
                      {issue.paths.length > 100 ? (
                        <p>仅显示前 100 个位置。</p>
                      ) : null}
                    </details>
                  </div>
                ))}
                {issueGroups.length > 100 ? (
                  <p>当前显示前 100 类问题。</p>
                ) : null}
              </details>
            ) : null}
            {emptyStats.length ? (
              <details className="empty-stats">
                <summary>
                  {emptyStats.length} 个空统计文件 · 尚无数据，已跳过
                </summary>
                <p>
                  文件没有可解析内容，不会作为损坏错误或零时长导入；写入有效数据后自动读取。
                </p>
                {emptyStats.map((i) => (
                  <p key={i.path} className="world-path">
                    {displayPath(i.path)}
                  </p>
                ))}
              </details>
            ) : null}
            <p className="scan-note">
              首次导入历史保持不变，最近读数随扫描更新。自动追踪正向增量，回档单独记录；跨世界复制去重将在后续阶段提供。
            </p>
          </div>
          <div hidden={view !== 'settings'} id="settings-health">
            <SessionPage active={view === 'settings'} label="数据健康">
              <DataHealth
                health={health}
                report={report}
                onSaved={setHealth}
                onOpen={(query) => {
                  setWorldQuery(query);
                  navigate('worlds');
                }}
              />
            </SessionPage>
          </div>
        </div>
      ) : null}
    </section>
  );
}
