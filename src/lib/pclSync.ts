import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PclLink } from './scan';
export interface PclSyncStatus {
  enabled: boolean;
  running: boolean;
  pcl_running: boolean;
  source: string;
  launcher: string | null;
  link: PclLink | null;
  last_checked: string | null;
  last_synced: string | null;
  revision: number;
  added: number;
  changed: number;
  current_instances: string[];
  issues: string[];
}
export function loadPclSync() {
  return isTauri()
    ? invoke<PclSyncStatus>('pcl_sync_status')
    : Promise.resolve(null);
}
export function syncPclNow() {
  return invoke<void>('sync_pcl_now');
}
export function setPclSync(enabled: boolean) {
  return invoke<void>('set_pcl_sync', { enabled });
}
export function selectPclLauncher(path: string) {
  return invoke<void>('select_pcl_launcher', { path });
}
