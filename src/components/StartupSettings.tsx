import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Power, MonitorCog } from 'lucide-react';
import { displayPath } from '../lib/path';
interface StartupStatus {
  supported: boolean;
  enabled: boolean;
  executable: string;
}
export default function StartupSettings() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      setStatus({ supported: false, enabled: false, executable: '' });
      return;
    }
    void invoke<StartupStatus>('startup_status')
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      setStatus(
        await invoke<StartupStatus>('set_startup_enabled', { enabled }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-card settings-preferences"
      aria-label="启动与界面"
    >
      <h2>
        <MonitorCog size={19} /> 启动与界面
      </h2>
      <div className="setting-row">
        <div>
          <strong>
            <Power size={16} /> 开机自启动
          </strong>
          <p>登录 Windows 后自动打开 MineChronicle，仅对当前账户生效。</p>
        </div>
        <label className="setting-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="开机自启动"
            checked={status?.enabled ?? false}
            disabled={!status?.supported || busy}
            onChange={(e) => void change(e.target.checked)}
          />
          {busy ? '保存中…' : status?.enabled ? '已开启' : '已关闭'}
        </label>
      </div>
      {status?.executable ? (
        <details>
          <summary>启动程序位置</summary>
          <p className="setting-path">{displayPath(status.executable)}</p>
        </details>
      ) : null}
      {!status?.supported && status ? (
        <p className="scan-note">请在 Windows 桌面版中设置。</p>
      ) : null}
      {error ? (
        <p role="alert" className="scan-error">
          {error}
        </p>
      ) : null}
      <div className="setting-row">
        <div>
          <strong>页面操作记忆</strong>
          <p>
            本次运行保留各页筛选、排序、搜索、分页与展开状态；退出后重置。界面缩放可在“窗口与显示”中调整。
          </p>
        </div>
        <span className="setting-badge">本次运行</span>
      </div>
      <div className="setting-row">
        <div>
          <strong>资源检查</strong>
          <p>
            仅点击“检查本页游戏图标”时读取模型与贴图，切换页面或类别不会触发。
          </p>
        </div>
        <span className="setting-badge">手动</span>
      </div>
    </section>
  );
}
