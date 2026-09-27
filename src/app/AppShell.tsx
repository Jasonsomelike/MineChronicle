import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { HardDrive, Layers3, MonitorDown, Sprout } from 'lucide-react';
import { checkRuntime } from '../lib/runtime';
import { FRONTEND_VERSION } from '../lib/version';
import { displayPath } from '../lib/path';
import { RAIL_OPEN_MEDIA, createRailController } from '../lib/rail';
import {
  PAGE_GROUP_OF,
  PAGE_GROUPS,
  PAGE_ICONS,
  PAGE_LABELS,
  PAGE_IDS,
  SETTINGS_SECTIONS,
} from './routes';
import type { AppState } from './useAppState';

/**
 * The runtime status reading, derived once and shared by the two surfaces that show it.
 *
 * Four states, and the loading one is tested before the two settled ones. The status
 * used to be read off `enabled` alone, so `trackingStatus === null` - the first frames
 * after launch, and every failed poll - fell through to 追踪已暂停: the bar announced a
 * conclusion it had no reading for, at exactly the moment a wrong one is most likely to
 * be believed. `is-ready` is gone with it; it had a tone and no rule.
 *
 * The tone is the surface, the dot is the reading, and the two settled quiet states
 * share the surface but not the dot. Sharing it was wrong twice over: the review's
 * acceptance says 追踪已就绪，等待游戏启动 and 追踪已暂停 must not paint the same
 * colour, and they are different facts - one is waiting for a game, the other has
 * recording switched off, so nothing is being written to the archive at all. The dot
 * carries that difference; the surface stays the shared neutral one, because neither
 * state is a failure.
 *
 * The error state gets its own label rather than passing the error off as a ready
 * tracker: a red dot beside 追踪已就绪，等待游戏启动 asks the reader to trust the
 * right-hand hint over the sentence in the middle. 异常 matches the wording the hint
 * already used.
 *
 * `short` is the ≤3-character form the rail foot shows beside the dot; the full
 * sentence stays with the status bar, which is the only surface that announces.
 */
function statusReading(state: AppState) {
  const { trackingStatus, backgroundErrors } = state;
  const hasError =
    !!trackingStatus?.error || Object.values(backgroundErrors).some(Boolean);
  const running =
    !!trackingStatus?.running || !!trackingStatus?.active_instances?.length;
  const tone = hasError
    ? 'is-error'
    : running
    ? 'is-running'
    : trackingStatus
    ? 'is-idle'
    : 'is-loading';
  const dot = hasError
    ? 'error'
    : running
    ? 'active'
    : !trackingStatus
    ? 'loading'
    : trackingStatus.enabled
    ? 'idle'
    : 'paused';
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
  const short = hasError
    ? '异常'
    : running
    ? '追踪中'
    : !trackingStatus
    ? '读取中'
    : trackingStatus.enabled
    ? '已就绪'
    : '已暂停';
  return { hasError, running, tone, dot, label, short };
}

function StatusSummary({ state }: { state: AppState }) {
  const { trackingStatus, backgroundErrors, pclStatus, navigate } = state;
  const { hasError, tone, dot, label } = statusReading(state);
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

/* The rail foot's summary of the same reading the status bar carries in full. Division
   of labour: the rail foot is the glance (dot + ≤3-character word, title on hover for
   the whole sentence), the status bar at the top of the content is the announcement.

   The whole fragment is aria-hidden on purpose - the status bar is the single surface
   that speaks this state, and a second live region in the rail would read it out twice.
   Reusing the `.watch-dot` classes means the rail's dot and the status bar's dot can
   never disagree about what state they are showing: they are the same rule. */
function RailStatus({ state }: { state: AppState }) {
  const { dot, label, short } = statusReading(state);
  return (
    <span className="rail-status" title={label} aria-hidden="true">
      <span className={`watch-dot ${dot}`} />
      <span className="rail-status-label">{short}</span>
    </span>
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
  /* The rail opens on intent (pointer resting 100ms) or on focus (immediately), and
     closes on leave (after a 150ms grace), a press outside, Escape, window blur, or
     focus leaving beyond the rail while the pointer is NOT resting on it. Clicks
     never close it - navigating included: the click lands under a pointer that is
     still on the rail, and collapsing the overlay there yanked it out from under the
     cursor on every destination click (the click-collapse regression). There is no
     stored preference behind any of it: `railOpen` is this component's session state
     alone, the DOM carries it as one `.is-open` class, and the same window width
     always draws the same resting rail. The timers live in src/lib/rail.ts; this
     component only wires DOM events to the controller. */
  const [railOpen, setRailOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const controller = useMemo(
    () =>
      createRailController({
        canOpen: () => window.matchMedia(RAIL_OPEN_MEDIA).matches,
        onChange: setRailOpen,
      }),
    [],
  );

  useEffect(() => () => controller.destroy(), [controller]);

  /* Mounted only while the overlay is open - the three listeners are all close events,
     so before it opens there is nothing for them to hear. */
  useEffect(() => {
    if (!railOpen) return;
    const rail = railRef.current;
    const main = mainRef.current;
    /* Popover light dismiss: a press anywhere outside the rail closes it, so the
       overlay cannot sit over the content it no longer belongs to. */
    const onPointerDown = (event: PointerEvent) => {
      if (rail && event.target instanceof Node && rail.contains(event.target))
        return;
      controller.lightDismiss();
    };
    /* Escape closes, and - because the focus is inside the rail that is about to
       shrink to 72px - hands focus to the content column, so it cannot land back in
       the collapsed rail and become invisible. `tabIndex={-1}` on `.main-column`
       makes that landing spot legal; the container is not a control, so it draws no
       focus ring (see `.main-column:focus` in shell.css). */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      controller.escape();
      const active = document.activeElement;
      if (main && rail && active instanceof Node && rail.contains(active)) {
        main.focus({ preventScroll: true });
      }
    };
    /* Tauri can switch windows or minimize; on return the overlay must not still be
       covering content the user never asked it to cover. */
    const onWindowBlur = () => controller.windowBlur();
    /* Dragging the window below 860px while open: the strip tier has no overlay to
       show, so the open state must not survive the resize. The controller only gates
       OPENING on canOpen(), and no pointer/blur event fires for a resize - this is
       the one close source that has to listen to the media query itself. */
    const railMedia = window.matchMedia(RAIL_OPEN_MEDIA);
    const onRailMediaChange = () => {
      if (!railMedia.matches) controller.lightDismiss();
    };
    railMedia.addEventListener('change', onRailMediaChange);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      railMedia.removeEventListener('change', onRailMediaChange);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [railOpen, controller]);

  return (
    <div className="app-shell">
      {/* The brand, the primary navigation and the residency block are one left-hand
          rail, and - deliberately - ONE copy of the DOM. Expansion is that same node
          changing geometry, never a second overlay rendered elsewhere, so the nav is
          exactly seven buttons for readers and for scripts that count them.

          The rail has to be a single grid item. Declared as three separate grid rows,
          the content column spans them and the grid spreads its surplus height across
          all three - measured 501px/710px/518px rows, which left the nav half way down
          the window and the labels 1212px below the fold.

          The first grid column is the 72px compact width at every viewport that has a
          rail at all. When the rail expands it leaves the grid (`position: fixed`) and
          floats over the content: the column never changes, so the content never
          shifts by a pixel in either direction.

          Below 860px the rail stops being a box (`display: contents`) and its three
          children reflow into a top strip in this same DOM order, so there is no second
          copy of the navigation to keep in sync - and no box for the pointer to enter,
          so the hover model switches itself off. */}
      <div
        ref={railRef}
        className={railOpen ? 'app-rail is-open' : 'app-rail'}
        onPointerEnter={() => controller.pointerEnter()}
        onPointerLeave={() => controller.pointerLeave()}
        /* React's onFocus/onBlur are focusin/focusout - they bubble, so a Tab from the
           brand into any nav button opens the rail on the spot, with no intent delay:
           keyboard intent has no sweep to guard against. */
        onFocus={() => controller.focusIn()}
        onBlur={(event) => {
          /* focusout with a relatedTarget still inside the rail (Tab moving between
             buttons) is not a departure. A null relatedTarget is: the focus went
             somewhere this node cannot name. And a departure is only real when the
             pointer has left too: navigating from a rail click moves focus out to the
             new page's `.session-page` (useAppState's useLayoutEffect) while the
             cursor is still resting on the rail, and closing for that is the
             click-collapse bug again. The pointer holding the rail is what the hover
             model honours; a keyboard Tab-out with the cursor elsewhere still closes. */
          const rail = railRef.current;
          if (
            rail &&
            event.relatedTarget instanceof Node &&
            rail.contains(event.relatedTarget)
          )
            return;
          if (rail && rail.matches(':hover')) return;
          controller.focusOut();
        }}
      >
        <span className="wordmark">
          <span className="brand-mark">
            <Sprout size={23} aria-hidden="true" />
          </span>
          <span className="wordmark-label">MineChronicle</span>
        </span>
        <nav className="app-nav" id="app-primary-nav" aria-label="档案页面">
          {/* Two groups, rendered from the one declaration in routes.ts. The heading
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
                      /* Names the destination while the rail is collapsed to icons.
                         Suppressed while it is expanded - the visible label says the
                         same string, and a tooltip over a visible label is the same
                         sentence twice. */
                      title={railOpen ? undefined : PAGE_LABELS[id]}
                      aria-current={view === id ? 'page' : undefined}
                      onClick={() => {
                        /* No close on the choice: a click is not a departure. The
                           pointer is still resting where it clicked, so the overlay
                           stays up until the mouse actually leaves (grace), Escape,
                           a press outside, or the window losing focus. */
                        navigate(id);
                      }}
                    >
                      <Icon size={18} aria-hidden="true" />
                      {/* An element, not a bare text node, because the compact tier has
                        to hide it and a text node cannot be selected. */}
                      <span className="app-nav-label">{PAGE_LABELS[id]}</span>
                    </button>
                  );
                },
              )}
            </div>
          ))}
        </nav>
        {/* After the navigation, pinned to the foot by `.header-tools`' own
            `margin-top: auto`. Deliberately a sibling of the nav, not a member of it:
            `qa-error-boundary.mjs` counts `.app-shell .app-nav button` and expects the
            seven destinations. */}
        <div className="header-tools">
          <RailStatus state={state} />
          {/* The residency facts as icon + text. The collapsed rail shows the icon and
              keeps the full sentence in `title`; the expanded rail and the top strip
              show the text beside it (the strip swaps them - text, no icon). */}
          <span className="local-label" title="数据仅存本机，无账号无遥测">
            <HardDrive
              className="local-label-icon"
              size={14}
              aria-hidden="true"
            />
            <span className="local-label-text">本地档案</span>
          </span>
          <span
            className="local-label"
            title="关闭窗口后继续追踪，从系统托盘可彻底退出"
          >
            <MonitorDown
              className="local-label-icon"
              size={14}
              aria-hidden="true"
            />
            <span className="local-label-text">托盘驻留</span>
          </span>
        </div>
      </div>
      <main className="main-column" ref={mainRef} tabIndex={-1}>
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
