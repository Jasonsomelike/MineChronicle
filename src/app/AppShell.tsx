import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Layers3, Sprout } from 'lucide-react';
import { checkRuntime } from '../lib/runtime';
import { FRONTEND_VERSION } from '../lib/version';
import { displayPath } from '../lib/path';
import {
  applyRail,
  loadRailPreference,
  railIsCollapsed,
  saveRailPreference,
} from '../lib/rail';
import type { RailPreference } from '../lib/rail';
import {
  PAGE_GROUP_OF,
  PAGE_GROUPS,
  PAGE_ICONS,
  PAGE_LABELS,
  PAGE_IDS,
  SETTINGS_SECTIONS,
} from './routes';
import type { AppState } from './useAppState';

function StatusSummary({ state }: { state: AppState }) {
  const { trackingStatus, backgroundErrors, pclStatus, navigate } = state;
  const hasError =
    !!trackingStatus?.error || Object.values(backgroundErrors).some(Boolean);
  const running =
    !!trackingStatus?.running || !!trackingStatus?.active_instances?.length;
  /* Four states, and the loading one is tested before the two settled ones. The status
     used to be read off `enabled` alone, so `trackingStatus === null` - the first frames
     after launch, and every failed poll - fell through to 追踪已暂停: the bar announced a
     conclusion it had no reading for, at exactly the moment a wrong one is most likely to
     be believed. `is-ready` is gone with it; it had a tone and no rule. */
  const tone = hasError
    ? 'is-error'
    : running
    ? 'is-running'
    : trackingStatus
    ? 'is-idle'
    : 'is-loading';
  /* The tone is the surface, the dot is the reading, and the two settled quiet states
     share the surface but not the dot. Sharing it was wrong twice over: the review's
     acceptance says 追踪已就绪，等待游戏启动 and 追踪已暂停 must not paint the same
     colour, and they are different facts - one is waiting for a game, the other has
     recording switched off, so nothing is being written to the archive at all. The dot
     carries that difference; the surface stays the shared neutral one, because neither
     state is a failure. */
  const dot = hasError
    ? 'error'
    : running
    ? 'active'
    : !trackingStatus
    ? 'loading'
    : trackingStatus.enabled
    ? 'idle'
    : 'paused';
  /* The error state gets its own label rather than passing the error off as a ready
     tracker: a red dot beside 追踪已就绪，等待游戏启动 asks the reader to trust the
     right-hand hint over the sentence in the middle. 异常 matches the wording the hint
     already used. */
  const label = trackingStatus?.running
    ? '正在同步存档'
    : trackingStatus?.active_instances?.length
    ? `正在追踪 ${trackingStatus.active_instances.length} 个实例`
    : trackingStatus?.finalizing_instances
    ? '游戏已退出，正在收尾同步'
    : !trackingStatus
    ? '正在读取追踪状态…'
    : hasError
    ? '追踪服务异常'
    : trackingStatus.enabled
    ? '追踪已就绪，等待游戏启动'
    : '追踪已暂停';
  return (
    <details className={`status-center ${tone}`}>
      <summary>
        <span className={`watch-dot ${dot}`} />
        {label}
        {/* The state is the label now, so this side of the summary only says what the
            disclosure does. It used to carry the state too - 追踪服务异常 beside
            有服务异常 · 查看详情 is the same sentence twice - and 「运行状态」 is the
            label this side already used when there was nothing wrong. */}
        <span className="status-center-hint">
          {hasError ? '查看详情' : '运行状态'}
        </span>
      </summary>
      {pclStatus && state.view !== 'settings' ? (
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
      {pclStatus || state.report?.last_scan ? (
        <p className="status-stamps">
          {pclStatus?.last_synced ? (
            <span>
              配置最近同步：{new Date(pclStatus.last_synced).toLocaleString()}
            </span>
          ) : pclStatus ? (
            <span>配置尚未同步</span>
          ) : null}
          {state.report?.last_scan ? (
            <span>
              统计最近保存：
              {new Date(state.report.last_scan).toLocaleString()}
            </span>
          ) : null}
        </p>
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
      <ConnectionCheck />
    </details>
  );
}

/* Was a second status line under the page, with its own `<details>` and its own summary
   reading 连接状态. Two lines that each said half of one thing are how a status strip
   stops being read: this one sat below every page, so the sentence a reader needed was a
   scroll away from the dot they had just looked at. It is a row inside the status bar
   now - no summary, no second heading, and the manual check still exists because it is
   the only way to test the desktop bridge from the browser preview. */
function ConnectionCheck() {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('尚未检查桌面连接');

  async function checkConnection() {
    setChecking(true);
    try {
      const status = await checkRuntime();
      setMessage(
        status
          ? `桌面服务已连接 · ${status.offline ? '离线模式' : '在线模式'}`
          : '当前为浏览器预览，请打开 MineChronicle 桌面程序。',
      );
    } catch {
      setMessage('连接失败，请确认桌面后端正在运行后重试。');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="connection-check">
      <button
        type="button"
        onClick={() => void checkConnection()}
        disabled={checking}
      >
        {checking ? '正在检查…' : '检查桌面连接'}
        <span aria-hidden="true"> →</span>
      </button>
      <p className="runtime-status" role="status">
        {message}
      </p>
    </div>
  );
}

export default function AppShell({
  state,
  children,
}: {
  state: AppState;
  children: ReactNode;
}) {
  const { view, navigate, activeSection, setActiveSection, runtime } = state;
  /* The preference is read once, from the same place the theme and the zoom level are
     read, and written straight to <html data-rail> so the CSS - not a second copy of the
     breakpoints - decides the width. See src/lib/rail.ts for why the attribute is only
     written for an explicit choice. */
  const [railPreference, setRailPreference] =
    useState<RailPreference>(loadRailPreference);
  useEffect(() => {
    applyRail(railPreference);
  }, [railPreference]);

  const railCollapsed = railIsCollapsed(railPreference);
  const toggleRail = () => {
    const next: RailPreference = railCollapsed ? 'expanded' : 'collapsed';
    saveRailPreference(next);
    setRailPreference(next);
  };

  return (
    <div className="app-shell">
      {/* The brand, the primary navigation and the two residency labels used to be two
          stacked horizontal bars pinned to the top of the window: 149px of chrome before
          a single number was on screen. They are one left-hand rail now, so content
          starts at the top of the window and the cost is width rather than height.

          The rail has to be a single grid item. Declared as three separate grid rows, the
          content column spans them and the grid spreads its surplus height across all
          three - measured 501px/710px/518px rows, which left the nav half way down the
          window and the labels 1212px below the fold.

          Below 860px the rail stops being a box (`display: contents`) and its three
          children reflow into a top strip in this same DOM order, so there is no second
          copy of the navigation to keep in sync. */}
      <div className="app-rail">
        <span className="wordmark">
          <span className="brand-mark">
            <Sprout size={23} aria-hidden="true" />
          </span>
          <span className="wordmark-label">MineChronicle</span>
        </span>
        <nav className="app-nav" id="app-primary-nav" aria-label="档案页面">
          {/* Three groups, rendered from the one declaration in routes.ts. The heading
              is a labelled `group`, never a button: the seven destinations are still
              exactly seven buttons (qa-error-boundary.mjs counts them), and a heading
              that could be clicked would be an eighth destination that goes nowhere.
              `aria-labelledby` points at the visible text rather than repeating it in
              an `aria-label`, so the two cannot drift apart. */}
          {PAGE_GROUPS.map(([groupId, groupLabel]) => (
            <div
              key={groupId}
              className="app-nav-group"
              role="group"
              aria-labelledby={`app-nav-group-${groupId}`}
            >
              <span
                className="app-nav-group-title"
                id={`app-nav-group-${groupId}`}
              >
                {groupLabel}
              </span>
              {PAGE_IDS.filter((id) => PAGE_GROUP_OF[id] === groupId).map(
                (id) => {
                  const Icon = PAGE_ICONS[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      /* Carries the name for a pointer when the rail collapses to icons at
                       1080px. The visible label is the same string, so the two cannot drift
                       apart. */
                      title={PAGE_LABELS[id]}
                      aria-current={view === id ? 'page' : undefined}
                      onClick={() => navigate(id)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      {/* An element, not a bare text node, because the icon tier has to hide it
                        and a text node cannot be selected. */}
                      <span className="app-nav-label">{PAGE_LABELS[id]}</span>
                    </button>
                  );
                },
              )}
            </div>
          ))}
        </nav>
        {/* After the navigation in the DOM so it cannot open a gap between the brand and
            the list of destinations: the rail's `gap` sits between flex siblings, and this
            one is pulled out of the flow entirely. It is `title`d and `aria-label`led with
            the action rather than the state, so the same string works as the button's
            accessible name and as the pointer's tooltip.

            Deliberately a sibling of the nav, not a member of it:
            `qa-error-boundary.mjs` counts `.app-shell .app-nav button` and expects the
            seven destinations. Inside `nav.app-nav` this would have made that eight, and
            the assertion would have had to be loosened rather than kept. */}
        <button
          type="button"
          className="rail-toggle"
          title={railCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={railCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-controls="app-primary-nav"
          aria-expanded={!railCollapsed}
          onClick={toggleRail}
        >
          {railCollapsed ? (
            <ChevronRight size={16} aria-hidden="true" />
          ) : (
            <ChevronLeft size={16} aria-hidden="true" />
          )}
        </button>
        <div className="header-tools">
          <span className="local-label" title="数据仅存本机，无账号无遥测">
            本地档案
          </span>
          <span
            className="local-label"
            title="关闭窗口后继续追踪，从系统托盘可彻底退出"
          >
            托盘驻留
          </span>
        </div>
      </div>
      <main className="main-column">
        <section
          className="foundation scan-panel"
          aria-label="MineChronicle 档案"
        >
          <StatusSummary state={state} />
          {view === 'settings' && (
            <nav className="settings-jump" aria-label="设置分区">
              {SETTINGS_SECTIONS.map(([id, label]) => (
                <button
                  key={id}
                  aria-current={
                    activeSection === id ? ('true' as const) : undefined
                  }
                  onClick={() => {
                    document
                      .getElementById(id)
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                    setActiveSection(id);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {children}
          <p className="runtime-path" hidden={!runtime?.database_path}>
            {runtime?.database_path
              ? `档案：${displayPath(runtime.database_path)}`
              : ''}
          </p>
        </section>
      </main>
      <footer>
        <span>MineChronicle {FRONTEND_VERSION}</span>
        <span>无需账号 · 无遥测 · 不修改游戏文件</span>
      </footer>
    </div>
  );
}
