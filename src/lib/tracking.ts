import { invoke, isTauri } from '@tauri-apps/api/core';
import { selectedPlayer } from './players';
import type { PlayerSelection } from './players';
export interface TrackingStatus {
  enabled: boolean;
  running: boolean;
  watched_directories: number;
  finalizing_instances?: number;
  revision: number;
  error: string | null;
  active_instances: { name: string; game_root: string; pids: number[] }[];
}
export interface TrackingSummary {
  sessions?: {
    id: number;
    game_root: string;
    instance_name: string;
    started_at: string;
    ended_at: string | null;
    status: 'running' | 'closed' | 'interrupted';
    /** Seconds of this run with no world progress. Absent on older archives. */
    pseudo_seconds?: string;
  }[];
  players: {
    uuid: string;
    ticks: string;
    week_ticks: string;
    month_ticks: string;
  }[];
  rollbacks: {
    world_path: string;
    world_name: string;
    uuid: string;
    old_ticks: string;
    new_ticks: string;
    detected_at: string;
  }[];
  rollback_count: number;
  observations: number;
  started_at: string | null;
  /**
   * Per-instance time observed running while its worlds did not progress, i.e.
   * play whose statistics live somewhere this archive cannot see (a server).
   * Seconds, not ticks: it is a wall-clock measurement.
   */
  pseudo: {
    game_root: string;
    instance_name: string;
    seconds: string;
    week_seconds: string;
    month_seconds: string;
    sessions: number;
    unknown_sessions: number;
  }[];
}
export async function loadTracking() {
  if (!isTauri()) return null;
  const [status, summary] = await Promise.all([
    invoke<TrackingStatus>('tracking_status'),
    invoke<TrackingSummary>('tracking_summary'),
  ]);
  return { status, summary };
}
export function loadTrackingStatus() {
  return isTauri()
    ? invoke<TrackingStatus>('tracking_status')
    : Promise.resolve(null);
}
export function loadObservedSessions() {
  return isTauri()
    ? invoke<NonNullable<TrackingSummary['sessions']>>('observed_sessions')
    : Promise.resolve([]);
}
export function loadTrackingSummary() {
  return isTauri()
    ? invoke<TrackingSummary>('tracking_summary')
    : Promise.resolve(null);
}
export function setTrackingEnabled(enabled: boolean) {
  return invoke<TrackingStatus>('set_tracking_enabled', { enabled });
}
export function trackingTotals(
  summary: TrackingSummary | null,
  uuid: PlayerSelection = '',
) {
  const rows = (summary?.players ?? []).filter((p) =>
    selectedPlayer(p.uuid, uuid),
  );
  return rows.reduce(
    (sum, p) => ({
      ticks: sum.ticks + BigInt(p.ticks),
      week: sum.week + BigInt(p.week_ticks),
      month: sum.month + BigInt(p.month_ticks),
    }),
    { ticks: 0n, week: 0n, month: 0n },
  );
}

/**
 * Pseudo-server time across every instance.
 *
 * Deliberately not filtered by player: `observed_sessions` records which
 * instance ran, not who was playing, so there is no uuid to filter on. The
 * dashboard's player selector therefore cannot narrow this figure, which is why
 * it is presented as an instance-level measurement rather than a player stat.
 */
export function pseudoTotals(summary: TrackingSummary | null) {
  const rows = summary?.pseudo ?? [];
  return rows.reduce(
    (sum, entry) => ({
      seconds: sum.seconds + BigInt(entry.seconds),
      week: sum.week + BigInt(entry.week_seconds),
      month: sum.month + BigInt(entry.month_seconds),
      sessions: sum.sessions + entry.sessions,
      unknown: sum.unknown + entry.unknown_sessions,
      instances: sum.instances + (BigInt(entry.seconds) > 0n ? 1 : 0),
    }),
    {
      seconds: 0n,
      week: 0n,
      month: 0n,
      sessions: 0,
      unknown: 0,
      instances: 0,
    },
  );
}
