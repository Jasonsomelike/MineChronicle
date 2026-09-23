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
    missing_baseline?: boolean;
    /**
     * `'manual'` when the end time was typed by the user rather than observed.
     * A typed value is an estimate, so the table marks it and offers an undo.
     */
    ended_source?: string | null;
    /** When a manual edit was made; an audit trail, never used in totals. */
    edited_at?: string | null;
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
    baseline_sessions?: number;
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
export interface ObservedSessionsPage {
  sessions: NonNullable<TrackingSummary['sessions']>;
  /**
   * The same rows grouped by instance, so a collapsed group can show its real
   * totals. Built server-side because an instance's sessions can outnumber a page
   * (one archive holds 19 sessions for a single instance against a page size of
   * 20), and grouping per page would split an instance and show it twice.
   */
  groups?: ObservationGroup[];
  total: number;
  history_total?: number;
  filtered_seconds?: string;
  boundary?: number;
  new_records?: number;
  snapshot?: string;
  history_changed?: boolean;
  instances?: { game_root: string; name: string }[];
  page: number;
  page_size: number;
  total_seconds: string;
  unknown_sessions: number;
  baseline_sessions: number;
  running_sessions: number;
}
export interface ObservationQuery {
  game_root: string;
  from: string;
  to: string;
  status: string;
  boundary?: number;
  snapshot?: string;
  /**
   * Which page of each instance's own records to read, newest first, keyed by
   * `game_root`. A missing key means page 1.
   *
   * This replaced a page number that addressed every record at once. One pager
   * over all instances reads as 「第 1 / 3 页 · 共 43 条」 while the reader is
   * looking at one instance, so the number described a list they were not
   * looking at.
   *
   * Only paged instances appear here, so an instance the reader never touched
   * stays on page 1 instead of following someone else's cursor.
   */
  group_page?: Record<string, number> | null;
}

export interface ObservationGroup {
  game_root: string;
  name: string;
  /** This instance's records on its own current page. */
  sessions: NonNullable<TrackingSummary['sessions']>;
  /** Sessions for this instance across all history, not just this page. */
  session_count: number;
  /** Summed seconds across the whole group, so a collapsed row stays informative. */
  seconds: string;
  unknown_sessions: number;
  baseline_sessions: number;
  /** Which page of this instance's records `sessions` holds. */
  page?: number;
  /** How many pages this instance's records span at `page_size`. */
  page_count?: number;
}
export function loadObservedSessionsPage(
  page: number,
  query?: ObservationQuery,
) {
  return isTauri()
    ? invoke<ObservedSessionsPage>('observed_sessions_page', { page, query })
    : Promise.resolve<ObservedSessionsPage>({
        sessions: [],
        groups: [],
        total: 0,
        page: 1,
        page_size: 20,
        total_seconds: '0',
        unknown_sessions: 0,
        baseline_sessions: 0,
        running_sessions: 0,
      });
}
export function loadTrackingSummary() {
  return isTauri()
    ? invoke<TrackingSummary>('tracking_summary')
    : Promise.resolve(null);
}

/** The range a manual end time may fall in, for one session. */
export interface ManualEndBounds {
  started_at: string;
  /**
   * Start of the next session for the same instance. Sessions of one instance
   * cannot overlap, or the same minutes would be counted twice.
   */
  max_ended_at: string | null;
  status: string;
}

export function loadSessionBounds(id: number) {
  return invoke<ManualEndBounds>('observed_session_bounds', { id });
}

/**
 * Record a user-supplied end time.
 *
 * The value must already be the stored form (`YYYY-MM-DDTHH:MM:SSZ`, UTC); the
 * dialog converts from the local time the user typed. The backend re-validates
 * regardless, because a form hint is not a guarantee.
 *
 * The key is camelCase (`endedAt`) to match the Rust parameter `ended_at`: Tauri
 * converts camelCase to snake_case when reading arguments, and only in that
 * direction. Sending `ended_at` fails with "missing required key endedAt".
 */
export function setSessionEnd(id: number, endedAt: string) {
  return invoke<void>('set_observed_session_end', { id, endedAt });
}

/** Undo a manual end time, returning the session to 观测中断. */
export function clearSessionEnd(id: number) {
  return invoke<void>('clear_observed_session_end', { id });
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
      baseline: sum.baseline + (entry.baseline_sessions ?? 0),
      instances: sum.instances + (BigInt(entry.seconds) > 0n ? 1 : 0),
    }),
    {
      seconds: 0n,
      week: 0n,
      month: 0n,
      sessions: 0,
      unknown: 0,
      baseline: 0,
      instances: 0,
    },
  );
}
