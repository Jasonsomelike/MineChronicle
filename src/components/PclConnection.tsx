import { useState } from 'react';
import { RefreshCw, Link2, FolderCog } from 'lucide-react';
import { AutoComplete, Button, Switch } from 'antd';
import type { PclSyncStatus } from '../lib/pclSync';
import { syncPclNow, setPclSync, selectPclLauncher } from '../lib/pclSync';
import { displayPath } from '../lib/path';
export default function PclConnection({
  status,
  onEnabled,
}: {
  status: PclSyncStatus | null;
  onEnabled: (enabled: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [path, setPath] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!status)
    return (
      <section className="settings-card">
        <h2>PCL 自动联动</h2>
        <p className="scan-note">正在读取 PCL 联动状态…</p>
      </section>
    );
  return (
    <section className="settings-card pcl-connection" aria-label="PCL 自动联动">
      <div className="library-heading">
        <h2>
          <Link2 size={18} /> PCL 自动联动
        </h2>
        <span className="connection-state">
          {status.running
            ? '正在同步'
            : status.pcl_running
            ? 'PCL 正在运行'
            : status.launcher
            ? 'PCL 已关闭 · 配置可用'
            : '等待连接 PCL'}
        </span>
      </div>
      <div className="connection-summary">
        <span>{status.source || '等待首次检查'}</span>
        <span>{status.link?.folders.length ?? 0} 个游戏文件夹</span>
        <span>{status.current_instances.length} 个当前实例</span>
      </div>
      <div className="connection-actions">
        <label>
          {/* Optimistic update, with the rollback compensation preserved: the
              parent's state flips immediately, and a failed setPclSync puts the
              previous value back before the error surfaces. */}
          <Switch
            aria-label="自动同步 PCL"
            checked={status.enabled}
            disabled={busy}
            onChange={(enabled) => {
              const previous = status.enabled;
              onEnabled(enabled);
              void run(async () => {
                try {
                  await setPclSync(enabled);
                } catch (error) {
                  onEnabled(previous);
                  throw error;
                }
              });
            }}
          />
          自动同步 PCL
        </label>
        <span className="scan-note">
          {status.enabled ? '每 15 秒检查配置' : '自动同步已暂停'}
        </span>
        <Button
          icon={
            <RefreshCw size={15} className={status.running ? 'spinning' : ''} />
          }
          disabled={busy || status.running}
          onClick={() => void run(syncPclNow)}
        >
          立即同步
        </Button>
      </div>
      <p className="scan-note">
        最近同步：
        {status.last_synced
          ? new Date(status.last_synced).toLocaleString()
          : '尚未同步'}
        {status.last_synced
          ? ` · 新增 ${status.added} · 配置变化 ${status.changed}`
          : ''}
      </p>
      <details>
        <summary>
          <FolderCog size={14} />
          配置来源
        </summary>
        <p className="scan-note">
          最近检查：
          {status.last_checked
            ? new Date(status.last_checked).toLocaleString()
            : '尚未检查'}
        </p>
        <p className="world-path">HKCU\Software\PCL\LaunchFolders</p>
        {status.launcher ? (
          <p className="world-path">
            {displayPath(status.launcher)}\PCL\Setup.ini
          </p>
        ) : null}
        <p className="scan-note">
          实例配置：versions/*/PCL/Setup.ini · 版本 JSON
        </p>
        <label>
          配置目录
          {/* Was a native input + datalist for launcher-path suggestions; the
              antd AutoComplete keeps the same affordance (type a path, see the
              launchers PCL knows about, pick or keep typing). */}
          <AutoComplete
            aria-label="PCL 配置目录"
            value={path}
            onChange={(value) => setPath(value)}
            placeholder={
              status.launcher
                ? displayPath(status.launcher)
                : 'PCL.exe 所在目录'
            }
            options={(status.link?.launchers ?? []).map((p) => ({
              value: displayPath(p),
            }))}
          />
        </label>
        <Button
          icon={<Link2 size={14} />}
          disabled={busy || !path.trim()}
          onClick={() => void run(() => selectPclLauncher(path.trim()))}
        >
          连接此配置
        </Button>
      </details>
      {status.issues.length ? (
        <p role="status" className="scan-error">
          {status.issues.join('；')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="scan-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
