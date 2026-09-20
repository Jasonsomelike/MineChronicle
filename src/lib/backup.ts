import { invoke, isTauri } from '@tauri-apps/api/core';
export interface BackupInfo {
  path: string;
  created_at: string;
  kind: string;
  bytes: number;
  worlds: number;
  observations: number;
  schema: number;
  digest: string;
}
export interface BackupPolicy {
  enabled: boolean;
  retention: number;
  directory: string;
  last_day: string;
  error: string;
  records: BackupInfo[];
  last_attempt?: string;
  last_success?: string;
}
export interface ArchiveStatus {
  database_path: string;
  version: string;
  policy: BackupPolicy;
  pending_restore: boolean;
  pending?: { source: string; scheduled_at: string } | null;
  operation_error?: string | null;
}
export const archiveStatus = () =>
  isTauri()
    ? invoke<ArchiveStatus>('archive_status')
    : Promise.resolve<ArchiveStatus | null>(null);
export const configureBackups = (
  enabled: boolean,
  retention: number,
  directory: string,
) => invoke('configure_backups', { enabled, retention, directory });
export const createBackup = () => invoke<BackupInfo>('create_archive_backup');
export const inspectBackup = (path: string) =>
  invoke<BackupInfo>('inspect_archive_backup', { path });
export const restoreBackup = (path: string, expectedDigest: string) =>
  invoke('schedule_archive_restore', { path, expectedDigest });
export const cancelRestore = () => invoke('cancel_archive_restore');
export const chooseBackup = () =>
  invoke<string | null>('choose_archive_backup');
export const restartRestore = () => invoke('restart_after_restore');
export const openArchiveFolder = (backups: boolean) =>
  invoke('open_archive_folder', { backups });
