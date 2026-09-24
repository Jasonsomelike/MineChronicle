import SessionPage from '../components/SessionPage';
import Dashboard from '../components/Dashboard';
import WorldLibrary from '../components/WorldLibrary';
import DataHealth from '../components/DataHealth';
import PclInstances from '../components/PclInstances';
import Timeline from '../components/Timeline';
import Statistics from '../components/Statistics';
import InstanceObservation from '../components/InstanceObservation';
import ArchiveSettings from '../components/ArchiveSettings';
import PclConnection from '../components/PclConnection';
import SelfPlayerSettings from '../components/SelfPlayerSettings';
import StartupSettings from '../components/StartupSettings';
import ZoomControls from '../components/ZoomControls';
import ReadStatus from '../components/ReadStatus';
import { Globe2 } from 'lucide-react';
import { formatTickTotal } from '../lib/duration';
import { displayPath } from '../lib/path';
import type { AppState } from './useAppState';

function SettingsImport({ state }: { state: AppState }) {
  const {
    runtime,
    report,
    pcl,
    launcher,
    setLauncher,
    busy,
    loading,
    input,
    setInput,
    connectPcl,
    scan,
    cancel,
    cancelling,
  } = state;
  return (
    <section className="settings-card settings-import">
      <h2>读取本地存档</h2>
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
          onChange={(event) => setInput(event.target.value)}
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
  );
}

function SettingsBody({ state }: { state: AppState }) {
  const { report, pclStatus, setPclStatus, navigate } = state;
  return (
    <>
      {/* One layout system: stacked full-width sections. Nav targets are the
          SETTINGS_SECTIONS ids (P1.2/P1.3); archive keeps its id on the
          aria-busy card so qa-review-fixes can wait on readiness. */}
      <div className="settings-layout" hidden={state.view !== 'settings'}>
        <div id="settings-identity" className="settings-section">
          <SelfPlayerSettings report={report} />
        </div>
        <div id="settings-startup" className="settings-section">
          <StartupSettings />
          <section className="settings-card">
            <h2>窗口与显示</h2>
            <p>
              关闭窗口后继续在后台追踪游戏。点击系统托盘图标可重新打开，右键选择“彻底退出”停止软件。缩放控件在本卡片下方。
            </p>
            <ZoomControls />
            <p className="scan-note">
              也可使用 Ctrl + 滚轮或 Ctrl + 加减号调整缩放，Ctrl + 0 恢复默认。
            </p>
          </section>
        </div>
        <div
          id="settings-import"
          className="settings-section"
          role="group"
          aria-label="联动与存档导入"
        >
          <SessionPage active={state.view === 'settings'} label="PCL 联动">
            <PclConnection
              status={pclStatus}
              onEnabled={(enabled) =>
                setPclStatus((s) => (s ? { ...s, enabled } : s))
              }
            />
          </SessionPage>
          <SettingsImport state={state} />
        </div>
        <div className="settings-section">
          <SessionPage active={state.view === 'settings'} label="档案与备份">
            <ArchiveSettings />
          </SessionPage>
        </div>
      </div>
      {state.view === 'settings' && (
        <>
          {state.initialLibrary.error && (
            <ReadStatus {...state.initialLibrary} />
          )}
          {state.initialRuntime.error && (
            <ReadStatus {...state.initialRuntime} />
          )}
          {state.initialPcl.error && <ReadStatus {...state.initialPcl} />}
        </>
      )}
      {report ? (
        <div className="settings-block" hidden={state.view !== 'settings'}>
          {report.saved ? (
            <div className="import-summary">
              <h3>首次导入历史 · {formatTickTotal(report.historical_ticks)}</h3>
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
      ) : null}
      {report ? (
        <div className="settings-block" hidden={state.view !== 'settings'}>
          {state.issueGroups.length ? (
            <details className="scan-issues" open>
              <summary>需要留意 · {state.issueGroups.length} 类问题</summary>
              {state.issueGroups.slice(0, 100).map((issue, index) => (
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
              {state.issueGroups.length > 100 ? (
                <p>当前显示前 100 类问题。</p>
              ) : null}
            </details>
          ) : null}
          {state.emptyStats.length ? (
            <details className="empty-stats">
              <summary>
                {state.emptyStats.length} 个空统计文件 · 尚无数据，已跳过
              </summary>
              <p>
                文件没有可解析内容，不会作为损坏错误或零时长导入；写入有效数据后自动读取。
              </p>
              {state.emptyStats.map((i) => (
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
      ) : null}
      {report ? (
        <div
          hidden={state.view !== 'settings'}
          id="settings-health"
          className="settings-section"
        >
          <SessionPage active={state.view === 'settings'} label="数据健康">
            <DataHealth
              health={state.health}
              report={report}
              onSaved={state.setHealth}
              onOpen={(query) => {
                state.setWorldQuery(query);
                navigate('worlds');
              }}
            />
          </SessionPage>
        </div>
      ) : null}
    </>
  );
}

export default function ArchivePages({ state }: { state: AppState }) {
  const {
    view,
    report,
    tracking,
    scope,
    changeScope,
    health,
    navigate,
    openActivity,
    worldQuery,
    setWorldQuery,
    applySavedReport,
    busy,
    loading,
    worldCount,
    progress,
    error,
    clearError,
    notice,
    pcl,
    pclStatus,
    connectPcl,
    trackingStatus,
    toggleTracking,
    sharedTimelineScope,
    sharedStatisticsScope,
    setTimelineScope,
    setStatisticsScope,
  } = state;

  return (
    <>
      <SettingsBody state={state} />
      {(view === 'dashboard' || view === 'settings') && report ? (
        <>
          {(view === 'dashboard' || state.totalsRead.error) && (
            <ReadStatus {...state.totalsRead} />
          )}
          {state.healthRead.error && <ReadStatus {...state.healthRead} />}
        </>
      ) : null}
      {(view === 'dashboard' || view === 'settings') && !report ? (
        <>
          {state.totalsRead.error && <ReadStatus {...state.totalsRead} />}
          {state.healthRead.error && <ReadStatus {...state.healthRead} />}
        </>
      ) : null}
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
        /* Gated to the page that owns the action, like the status line above it: the
           message is about a scan the user started in 导入与设置, and it used to follow
           them to every other page with nothing to dismiss it. */
        <p className="scan-error" role="alert" hidden={view !== 'settings'}>
          {error}{' '}
          <button type="button" className="text-button" onClick={clearError}>
            知道了
          </button>
        </p>
      ) : null}
      {notice ? (
        /* The neutral half of the same message slot. A cancelled scan is an outcome, not a
           failure, so it is announced rather than alerted - and it carries its own dismiss,
           because the alternative is a line that stays on the page with no way to clear it
           until the next scan starts. `clearError` empties both halves, so the two can
           never be left disagreeing about whether the slot is empty. */
        <p className="scan-notice" role="status" hidden={view !== 'settings'}>
          {notice}{' '}
          <button type="button" className="text-button" onClick={clearError}>
            知道了
          </button>
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
              onWorlds={() => {
                // The complete ranking, unfiltered: the dashboard's link is "see all
                // of them", so it clears whatever world search the page was left on.
                setWorldQuery('');
                navigate('worlds');
              }}
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
          <div hidden={view !== 'instances'}>
            <PclInstances
              report={report}
              link={pcl}
              sync={pclStatus}
              tracking={tracking}
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
        </div>
      ) : null}
    </>
  );
}
