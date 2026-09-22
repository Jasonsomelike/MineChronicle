import { useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, Layers3, Sprout } from 'lucide-react';
import { checkRuntime } from '../lib/runtime';
import { FRONTEND_VERSION } from '../lib/version';
import { displayPath } from '../lib/path';
import { PAGE_ICONS, PAGE_LABELS, PAGE_IDS, SETTINGS_SECTIONS } from './routes';
import type { AppState } from './useAppState';

function StatusSummary({ state }: { state: AppState }) {
  const { trackingStatus, backgroundErrors, pclStatus, navigate } = state;
  const label = trackingStatus?.running
    ? '正在同步存档'
    : trackingStatus?.active_instances?.length
    ? `正在追踪 ${trackingStatus.active_instances.length} 个实例`
    : trackingStatus?.finalizing_instances
    ? '游戏已退出，正在收尾同步'
    : trackingStatus?.enabled
    ? '追踪已就绪，等待游戏启动'
    : '追踪已暂停';
  return (
    <details className="status-center">
      <summary>
        <span
          className={trackingStatus?.enabled ? 'watch-dot active' : 'watch-dot'}
        />
        {label}
        <span className="status-center-hint">
          {trackingStatus?.error ||
          Object.values(backgroundErrors).some(Boolean)
            ? '有服务异常 · 查看详情'
            : '运行状态'}
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
    </details>
  );
}

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
    <details className="connection-check">
      <summary>
        <Activity size={14} />
        连接状态
      </summary>
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
    </details>
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
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="wordmark">
          <span className="brand-mark">
            <Sprout size={23} aria-hidden="true" />
          </span>
          MineChronicle
        </span>
        <div className="header-tools">
          <span className="local-label">本地档案</span>
          <span
            className="local-label"
            title="关闭窗口后继续追踪，从系统托盘可彻底退出"
          >
            关闭窗口后驻留托盘
          </span>
        </div>
      </header>
      <main>
        <section
          className="foundation scan-panel"
          aria-label="MineChronicle 档案"
        >
          <nav className="app-nav" aria-label="档案页面">
            {PAGE_IDS.map((id) => {
              const Icon = PAGE_ICONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={view === id ? 'page' : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {PAGE_LABELS[id]}
                </button>
              );
            })}
          </nav>
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
        <ConnectionCheck />
      </main>
      <footer>
        <span>MineChronicle {FRONTEND_VERSION}</span>
        <span>无需账号 · 无遥测 · 不修改游戏文件</span>
      </footer>
    </div>
  );
}
