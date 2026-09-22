import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { loadHealth } from '../lib/health';
import type { HealthSummary } from '../lib/health';
import {
  loadTrackingStatus,
  loadTrackingSummary,
  setTrackingEnabled,
} from '../lib/tracking';
import type { TrackingStatus, TrackingSummary } from '../lib/tracking';
import { loadPclSync } from '../lib/pclSync';
import type { PclSyncStatus } from '../lib/pclSync';
import { emptyScope } from '../lib/activity';
import type { ActivityScope } from '../lib/activity';
import {
  initialPlayers,
  initialPlayersNone,
  savePlayers,
} from '../lib/players';
import { useResource } from '../lib/useResource';
import { displayPath, pathKey } from '../lib/path';
import { groupIssues } from '../lib/issues';
import { routePage, pageHash } from './routes';
import type { PageId, SettingsSectionId } from './routes';

export type AppState = ReturnType<typeof useAppState>;

export function useAppState() {
  const [view, setView] = useState<PageId>(routePage);
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>('settings-identity');
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

  const scrollPositions = useRef<Record<string, number>>({});
  function navigate(next: PageId) {
    if (next === view) return;
    scrollPositions.current[view] = window.scrollY;
    window.location.hash = pageHash(next);
    setView(next);
  }

  useEffect(() => {
    const changed = () => setView(routePage());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

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

  function openActivity(page: PageId, world_path = '') {
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
  const [loading, setLoading] = useState(true);
  const inputDirty = useRef(false);
  const inputInitialized = useRef(false);

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

  useEffect(() => {
    if (view !== 'settings') return;
    const ids = [
      'settings-identity',
      'settings-startup',
      'settings-import',
      'settings-archive',
      'settings-health',
    ] as const;
    const present = () =>
      ids
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);
    const update = () => {
      const sections = present();
      if (!sections.length) return;
      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 32;
      if (atBottom) {
        setActiveSection(sections[sections.length - 1].id as SettingsSectionId);
        return;
      }
      const line = 120;
      let current = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
      }
      setActiveSection(current as SettingsSectionId);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [view]);

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

  return {
    view,
    activeSection,
    setActiveSection,
    backgroundErrors,
    scope,
    statisticsScope,
    timelineScope,
    sharedTimelineScope,
    sharedStatisticsScope,
    changeScope,
    setStatisticsScope,
    setTimelineScope,
    pclStatus,
    setPclStatus,
    pcl,
    setPcl,
    launcher,
    setLauncher,
    tracking,
    trackingStatus,
    toggleTracking,
    navigate,
    openActivity,
    worldQuery,
    setWorldQuery,
    input,
    setInput: (value: string) => {
      inputDirty.current = true;
      setInput(value);
      setLauncher('');
    },
    busy,
    cancelling,
    progress,
    report,
    setReport,
    health,
    setHealth,
    error,
    setError,
    runtime,
    loading,
    totalsRead,
    healthRead,
    initialLibrary,
    initialRuntime,
    initialPcl,
    applySavedReport,
    connectPcl,
    scan,
    cancel,
    issueGroups,
    emptyStats,
    worldCount,
  };
}
