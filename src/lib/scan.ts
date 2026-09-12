import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { FRONTEND_VERSION } from './version';

export interface RuntimeInfo {
  version: string;
  executable: string;
  database_path: string;
  embedded_assets: boolean;
  pcl_instances: number;
}

export async function runtimeInfo(): Promise<RuntimeInfo | null> {
  if (!isTauri()) return null;
  const info = await invoke<RuntimeInfo>('runtime_info');
  if (info.version !== FRONTEND_VERSION)
    throw new Error(
      `界面版本 ${FRONTEND_VERSION} 与程序版本 ${info.version} 不一致，请使用完整构建的程序。`,
    );
  return info;
}

export async function acknowledgeView(report: ScanSummary): Promise<void> {
  if (!isTauri()) return;
  return invoke('acknowledge_view', {
    receipt: {
      frontend_version: FRONTEND_VERSION,
      page_url: window.location.href,
      database_path: report.database_path ?? '',
      pcl_instances: report.instances?.length ?? 0,
      pcl_panel_visible: !!document.querySelector('.pcl-instances'),
    },
  });
}

export interface ScanProgress {
  roots_done: number;
  roots_total: number;
  worlds_scanned: number;
  player_files_scanned: number;
}
export interface PlayerSummary {
  uuid: string;
  preferred_name: string | null;
  name_source: 'manual' | 'usercache' | null;
  initial_play_ticks: string | null;
  play_ticks: string | null;
  source_paths: string[];
  conflicting: boolean;
}
export interface WorldSummary {
  path: string;
  name: string;
  status: 'Present' | 'Degraded' | 'Missing';
  data_version: number | null;
  minecraft_version: string | null;
  players: PlayerSummary[];
}
export interface ScanSummary {
  instances: {
    launcher_path: string;
    instance_path: string;
    name: string;
    game_root: string;
    minecraft_version: string | null;
    mod_loader: { name: string; version: string | null } | null;
    isolation: string;
  }[];
  roots: {
    path: string;
    requested_paths: string[];
    enumeration_complete: boolean;
    worlds: WorldSummary[];
  }[];
  issues: { kind: string; path: string; message: string }[];
  cancelled: boolean;
  saved: boolean;
  database_path: string | null;
  last_scan: string | null;
  historical_ticks: string;
}

export function parseRootInput(input: string): string[] {
  const paths = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1) : line,
    );
  if (!paths.length || paths.length > 32 || paths.some((path) => !path.trim()))
    throw new Error('请输入 1–32 个游戏根目录，每行一个。');
  return paths;
}

export async function scanGameRoots(
  paths: string[],
  onProgress: (progress: ScanProgress) => void,
  launcher?: string,
): Promise<ScanSummary> {
  if (!isTauri())
    throw new Error(
      '浏览器预览无法读取本地存档，请打开 MineChronicle 桌面版。',
    );
  const channel = new Channel<ScanProgress>();
  channel.onmessage = onProgress;
  return invoke<ScanSummary>(launcher ? 'scan_pcl_roots' : 'scan_game_roots', {
    paths,
    onProgress: channel,
    ...(launcher ? { launcher } : {}),
  });
}

export interface PclLink {
  folders: { name: string; path: string; available: boolean }[];
  launchers: string[];
  issues: string[];
}
export async function discoverPclFolders(): Promise<PclLink> {
  if (!isTauri()) throw new Error('请在 MineChronicle 桌面版中读取 PCL。');
  return invoke('discover_pcl_folders');
}

export async function cancelScan(): Promise<void> {
  return invoke('cancel_scan');
}

export async function loadLibrary(): Promise<{
  report: ScanSummary;
  inputs: string[];
} | null> {
  if (!isTauri()) return null;
  return invoke('load_library');
}

export async function setPlayerAlias(
  uuid: string,
  name: string,
): Promise<ScanSummary> {
  return invoke('set_player_alias', { uuid, name });
}
