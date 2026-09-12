import { useState } from 'react';
import { checkRuntime } from './lib/runtime';
import ScanPanel from './components/ScanPanel';
import { FRONTEND_VERSION } from './lib/version';
import { Activity, Sprout } from 'lucide-react';

export default function App() {
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
        <ScanPanel />
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
      </main>
      <footer>
        <span>MineChronicle {FRONTEND_VERSION}</span>
        <span>无需账号 · 无遥测 · 不修改游戏文件</span>
      </footer>
    </div>
  );
}
