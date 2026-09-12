import { invoke, isTauri } from '@tauri-apps/api/core';
export interface CandidateWorld {
  id: number;
  path: string;
  name: string;
}
export interface CloneCandidate {
  id: number;
  status: 'pending' | 'deferred' | 'confirmed' | 'rejected';
  world_a: CandidateWorld;
  world_b: CandidateWorld;
  evidence: {
    uuid: string;
    ticks: string;
    stats_hash: string;
    metadata_fingerprint: string;
  }[];
  detected_at: string;
  parent_world_id: number | null;
  inherited_confidence: string | null;
}
export interface HealthSummary {
  items: {
    key: string;
    kind: string;
    path: string;
    detail: string;
    reviewed: boolean;
    target: string;
  }[];
  candidates: CloneCandidate[];
  pending_count: number;
  confirmed_lineages: number;
  analysis_limited: boolean;
}
export async function loadHealth() {
  return isTauri() ? invoke<HealthSummary>('health_summary') : null;
}
export function reviewHealth(key: string, reviewed: boolean) {
  return invoke<HealthSummary>('review_health', { key, reviewed });
}
export function decideClone(
  id: number,
  decision: string,
  parent: number | null = null,
) {
  return invoke<HealthSummary>('decide_clone', { id, decision, parent });
}
export const issueNames: Record<string, string> = {
  STAT_ROLLBACK: '统计回档',
  CORRUPTED_STATS: '统计文件损坏',
  UNKNOWN_STATS_FORMAT: '未知统计格式',
  WORLD_MISSING: '世界目录缺失',
  UNRESOLVED_PLAYER: '玩家名称待确认',
  INACCESSIBLE_DIRECTORY: '目录不可访问',
  CORRUPTED_LEVEL_DAT: '世界元数据损坏',
  MISSING_LEVEL_DAT: '缺少世界元数据',
  SCAN_LIMIT_REACHED: '扫描范围不完整',
  INVALID_LAUNCHER_METADATA: '启动器配置待确认',
  CONFLICTING_PLAYER_STATS: '玩家统计来源冲突',
  CONFLICTING_PLAY_TIME: '时长字段冲突',
  INVALID_PLAYER_CACHE: '名称缓存无效',
  SYMLINK_SKIPPED: '已跳过目录链接',
  INVALID_PLAYER_UUID: '玩家标识无效',
  INVALID_ROOT: '目录无效',
  SAVES_NOT_FOUND: '未发现存档',
};
