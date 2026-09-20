import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, FolderOpen, Save } from 'lucide-react';
import {
  archiveStatus,
  configureBackups,
  createBackup,
  inspectBackup,
  restoreBackup,
  restartRestore,
  openArchiveFolder,
  cancelRestore,
  chooseBackup,
} from '../lib/backup';
import type { BackupInfo } from '../lib/backup';
import { useResource } from '../lib/useResource';
import { usePageActive } from './SessionPage';
import ReadStatus from './ReadStatus';

export default function ArchiveSettings() {
  const active = usePageActive();
  const request = useResource(archiveStatus, 'archive', active);
  const [directory, setDirectory] = useState<string>();
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<BackupInfo>();
  const [confirm, setConfirm] = useState(false);
  const inspection = useRef(0);
  function selectPath(value: string) {
    inspection.current++;
    setPath(value);
    setPreview(undefined);
    setConfirm(false);
  }
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const refresh = request.refresh;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [active, refresh]);
  const status = request.data;
  async function run(action: () => Promise<unknown>, message = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      request.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="settings-card archive-settings"
      id="settings-archive"
      aria-busy={busy}
    >
      <h2>
        <ArchiveRestore size={20} /> 档案与备份
      </h2>
      <ReadStatus {...request} />
      {!status ? (
        <p>桌面程序启动后可管理本地档案。</p>
      ) : (
        <>
          <p>
            MineChronicle {status.version} · 最近备份：
            {status.policy.records.length
              ? new Date(
                  status.policy.records.at(-1)!.created_at,
                ).toLocaleString()
              : '尚无备份'}
          </p>
          <details>
            <summary>实际档案位置与备份目录</summary>
            <p className="world-path">{status.database_path}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void run(() => openArchiveFolder(false))}
            >
              <FolderOpen size={14} /> 打开档案目录
            </button>
            <label>
              备份目录
              <input
                value={directory ?? status.policy.directory}
                onChange={(e) => setDirectory(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    configureBackups(
                      status.policy.enabled,
                      status.policy.retention,
                      directory ?? status.policy.directory,
                    ),
                  '备份目录已保存',
                )
              }
            >
              保存目录
            </button>
          </details>
          <div className="backup-controls">
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={status.policy.enabled}
                disabled={busy}
                onChange={(e) =>
                  void run(
                    () =>
                      configureBackups(
                        e.target.checked,
                        status.policy.retention,
                        status.policy.directory,
                      ),
                    '自动备份设置已保存',
                  )
                }
              />{' '}
              自动备份
            </label>
            <label>
              保留自动备份
              <select
                value={status.policy.retention}
                disabled={busy}
                onChange={(e) =>
                  void run(
                    () =>
                      configureBackups(
                        status.policy.enabled,
                        Number(e.target.value),
                        status.policy.directory,
                      ),
                    '保留数量已保存',
                  )
                }
              >
                {[7, 14, 30].map((n) => (
                  <option key={n} value={n}>
                    {n} 份
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => void run(createBackup, '手动备份已保存')}
            >
              <Save size={14} /> 立即备份
            </button>
            <button
              className="secondary-button"
              onClick={() => void run(() => openArchiveFolder(true))}
            >
              <FolderOpen size={14} /> 打开备份目录
            </button>
          </div>
          <p className="scan-note">
            程序运行时每小时检查；每天有数据变化时最多备份一次。手动备份与恢复前备份不会自动删除。仅备份本软件档案和设置，不包含
            Minecraft 游戏文件。
          </p>
          {status.policy.last_attempt && (
            <p className="scan-note">
              最近备份检查：
              {new Date(status.policy.last_attempt).toLocaleString()}
            </p>
          )}
          {(status.operation_error || status.policy.error) && (
            <p role="alert" className="scan-error">
              备份操作失败：{status.operation_error || status.policy.error}
            </p>
          )}
          <details>
            <summary>选择备份并恢复</summary>
            <label>
              已有备份
              <select value={path} onChange={(e) => selectPath(e.target.value)}>
                <option value="">选择一份备份</option>
                {[...status.policy.records].reverse().map((b) => (
                  <option key={b.path} value={b.path}>
                    {new Date(b.created_at).toLocaleString()} ·{' '}
                    {b.kind === 'auto'
                      ? '自动'
                      : b.kind === 'manual'
                      ? '手动'
                      : '恢复前'}{' '}
                    · {b.worlds} 个世界
                  </option>
                ))}
              </select>
            </label>
            <label>
              或输入备份文件完整路径
              <input
                value={path}
                onChange={(e) => selectPath(e.target.value)}
                placeholder="例如 D:\\备份\\minechronicle.sqlite3"
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const selected = await chooseBackup();
                  if (selected) selectPath(selected);
                })
              }
            >
              <FolderOpen size={14} /> 浏览备份文件
            </button>
            <button
              className="secondary-button"
              disabled={busy || !path.trim()}
              onClick={() =>
                void run(async () => {
                  const id = ++inspection.current;
                  setPreview(undefined);
                  setConfirm(false);
                  try {
                    const result = await inspectBackup(path.trim());
                    if (id === inspection.current) setPreview(result);
                  } catch (e) {
                    if (id === inspection.current) throw e;
                  }
                })
              }
            >
              校验并预览
            </button>
            {preview && preview.path === path.trim() && (
              <div className="restore-preview">
                <p className="world-path">恢复文件：{preview.path}</p>
                <p>
                  文件时间：{new Date(preview.created_at).toLocaleString()} ·{' '}
                  {preview.worlds} 个世界 · {preview.observations} 条观测 ·
                  档案格式 {preview.schema}（兼容）
                </p>
                <p>
                  恢复将替换当前档案和其中的设置。会先保留当前档案；游戏或扫描运行中不能恢复。
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />{' '}
                  我已确认要恢复这份档案
                </label>
                <button
                  disabled={busy || !confirm || status.pending_restore}
                  onClick={() =>
                    void run(
                      () => restoreBackup(preview.path, preview.digest),
                      '档案已准备好，重启后完成恢复',
                    )
                  }
                >
                  备份当前档案并准备恢复
                </button>
              </div>
            )}
          </details>
          {status.pending_restore && (
            <p role="status">
              已准备待恢复档案。
              {status.pending && (
                <span className="world-path">
                  {status.pending.source} ·{' '}
                  {status.pending.scheduled_at
                    ? new Date(status.pending.scheduled_at).toLocaleString()
                    : '较早版本安排'}
                </span>
              )}
              <button disabled={busy} onClick={() => void run(restartRestore)}>
                重启并完成恢复
              </button>
              <button
                disabled={busy}
                className="secondary-button"
                onClick={() =>
                  void run(cancelRestore, '已取消恢复，当前档案保持不变')
                }
              >
                取消待恢复
              </button>
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="scan-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="save-feedback">
          {notice}
        </p>
      )}
    </section>
  );
}
