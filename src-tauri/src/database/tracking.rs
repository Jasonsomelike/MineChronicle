use super::{DbResult, Repository};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::BTreeMap;

/// How long after a session ends a world delta may still be attributed to it.
///
/// The watcher only scans *after* a game process exits (`EXIT_DRAIN`, then the
/// reconcile pass), so a delta caused by a session is always stamped later than
/// that session's `ended_at`. Measured on the reference archive: 0 of 5 recorded
/// deltas fall inside a session window, so without this grace every local
/// single-player session would read as 100% pseudo-server time - a plausible
/// looking number that is entirely wrong.
///
/// The window is also capped by the next session's start, so a long gap cannot
/// let one run claim progress that happened during a later one.
const DELTA_GRACE_SECONDS: i64 = 900;

/// One observed session, with times already converted to Unix epoch seconds.
#[derive(Debug, Clone)]
pub(crate) struct SessionWindow {
    /// Row id, so attribution can be reported per session as well as per
    /// instance.
    pub id: i64,
    pub game_root: String,
    pub started: i64,
    /// End of the observed run. Sessions with no observed end are excluded
    /// before this point: their duration is unknown, not zero.
    pub ended: i64,
    /// When the next session for the same root began, if there is one.
    pub next_start: Option<i64>,
}

/// One recorded world play-time increase.
#[derive(Debug, Clone)]
pub(crate) struct DeltaAt {
    pub game_root: String,
    pub world_id: i64,
    pub observed: i64,
    pub ticks: i64,
}

/// Attributes each world delta to the observed session that caused it.
///
/// Returns the attributed ticks per session, in the same order as `sessions`.
///
/// Split out as a pure function because the grace window cannot be exercised
/// against the real archive - no recorded delta falls inside a session there -
/// so an integration test would pass even with the window removed entirely.
pub(crate) fn attribute_deltas(
    sessions: &[SessionWindow],
    deltas: &[DeltaAt],
    grace_seconds: i64,
) -> Vec<i64> {
    // Two players in one world each write a delta at the same instant for the
    // same wall-clock progress, so take the largest rather than the sum. The
    // reference archive only has single-player worlds today, which is exactly
    // why summing would go unnoticed until a shared world appeared.
    let mut merged: BTreeMap<(&str, i64, i64), i64> = BTreeMap::new();
    for delta in deltas {
        merged
            .entry((delta.game_root.as_str(), delta.world_id, delta.observed))
            .and_modify(|ticks| *ticks = (*ticks).max(delta.ticks))
            .or_insert(delta.ticks);
    }
    // Group by root and time; each delta is consumed at most once. Preserve
    // the original caller order when windows overlap (first claim wins).
    let mut by_root: BTreeMap<&str, BTreeMap<(i64, i64), i64>> = BTreeMap::new();
    for ((root, world, observed), ticks) in merged {
        by_root
            .entry(root)
            .or_default()
            .insert((observed, world), ticks);
    }
    let mut attributed = vec![0i64; sessions.len()];
    for (index, session) in sessions.iter().enumerate() {
        let last = session
            .next_start
            .map_or(session.ended.saturating_add(grace_seconds), |next| {
                session
                    .ended
                    .saturating_add(grace_seconds)
                    .min(next.saturating_sub(1))
            });
        if last < session.started {
            continue;
        }
        if let Some(entries) = by_root.get_mut(session.game_root.as_str()) {
            let keys: Vec<_> = entries
                .range((session.started, i64::MIN)..=(last, i64::MAX))
                .map(|(key, _)| *key)
                .collect();
            for key in keys {
                if let Some(ticks) = entries.remove(&key) {
                    attributed[index] = attributed[index].saturating_add(ticks);
                }
            }
        }
    }
    attributed
}

/// Pseudo-server time per instance: observed running, but its worlds did not
/// progress.
///
/// This is the case for a server client, where the statistics live on the
/// server so the local `saves/` directory stays empty and world tracking sees
/// nothing at all.
#[derive(Serialize)]
pub struct InstancePseudo {
    pub game_root: String,
    pub instance_name: String,
    /// Decimal seconds. Not ticks: the value is a wall-clock measurement, and
    /// seconds keep the arithmetic in one unit from SQL through to the UI.
    pub seconds: String,
    pub week_seconds: String,
    pub month_seconds: String,
    pub sessions: usize,
    /// Sessions for this instance whose end was never observed. Their time is
    /// unknown, so it is excluded rather than guessed.
    pub unknown_sessions: usize,
    pub baseline_sessions: usize,
}

#[derive(Debug, Clone, Default)]
pub struct SessionEstimate {
    pub seconds: i64,
    pub missing_baseline: bool,
}

type Attribution = (Vec<InstancePseudo>, BTreeMap<i64, SessionEstimate>);

#[derive(Serialize)]
pub struct PlayerTracking {
    pub uuid: String,
    pub ticks: String,
    pub week_ticks: String,
    pub month_ticks: String,
}
#[derive(Serialize)]
pub struct Rollback {
    pub world_path: String,
    pub world_name: String,
    pub uuid: String,
    pub old_ticks: String,
    pub new_ticks: String,
    pub detected_at: String,
}
#[derive(Serialize)]
pub struct TrackingSummary {
    pub sessions: Vec<super::sessions::ObservedSession>,
    pub players: Vec<PlayerTracking>,
    pub rollbacks: Vec<Rollback>,
    pub rollback_count: i64,
    pub observations: i64,
    pub started_at: Option<String>,
    /// Per-instance time observed running with no world progress, i.e. play
    /// whose statistics live somewhere this archive cannot see (a server).
    pub pseudo: Vec<InstancePseudo>,
}
impl Repository {
    pub fn tracking_enabled(&self) -> DbResult<bool> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key='tracking_enabled'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .as_deref()
            != Some("false"))
    }
    pub fn set_tracking_enabled(&self, enabled: bool) -> DbResult<()> {
        self.connection.execute("INSERT INTO settings(key,value) VALUES ('tracking_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[if enabled{"true"}else{"false"}])?;
        Ok(())
    }
    pub fn tracking_summary(&self) -> DbResult<TrackingSummary> {
        let mut totals: BTreeMap<String, (i128, i128, i128)> = BTreeMap::new();
        let mut query=self.connection.prepare("SELECT player_uuid,delta_ticks,datetime(observed_at,'localtime')>=datetime('now','localtime','start of day',printf('-%d days',(cast(strftime('%w','now','localtime') as integer)+6)%7)),datetime(observed_at,'localtime')>=datetime('now','localtime','start of month') FROM tracked_deltas")?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })? {
            let (uuid, ticks, week, month) = row?;
            let item = totals.entry(uuid).or_default();
            item.0 += i128::from(ticks);
            if week {
                item.1 += i128::from(ticks);
            }
            if month {
                item.2 += i128::from(ticks);
            }
        }
        let players = totals
            .into_iter()
            .map(|(uuid, (ticks, week, month))| PlayerTracking {
                uuid,
                ticks: ticks.to_string(),
                week_ticks: week.to_string(),
                month_ticks: month.to_string(),
            })
            .collect();
        let mut query=self.connection.prepare("SELECT w.path,w.payload,r.player_uuid,r.old_ticks,r.new_ticks,r.detected_at FROM stat_rollbacks r JOIN worlds w ON w.id=r.world_id ORDER BY r.id DESC LIMIT 50")?;
        let mut rollbacks = Vec::new();
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })? {
            let (world_path, payload, uuid, old, new, detected_at) = row?;
            let world: super::read_models::WorldSummary = serde_json::from_str(&payload)?;
            rollbacks.push(Rollback {
                world_path,
                world_name: world.name,
                uuid,
                old_ticks: old.to_string(),
                new_ticks: new.to_string(),
                detected_at,
            });
        }
        let (pseudo, estimates) = self.pseudo_attribution()?;
        let mut sessions = self.observed_sessions()?;
        for session in &mut sessions {
            if let Some(estimate) = estimates.get(&session.id) {
                session.pseudo_seconds = estimate.seconds.to_string();
                session.missing_baseline = estimate.missing_baseline;
            }
        }
        Ok(TrackingSummary {
            sessions,
            players,
            rollbacks,
            rollback_count: self.connection.query_row(
                "SELECT count(*) FROM stat_rollbacks",
                [],
                |r| r.get(0),
            )?,
            observations: self.connection.query_row(
                "SELECT count(*) FROM stat_snapshots WHERE kind='observation'",
                [],
                |r| r.get(0),
            )?,
            started_at: self.connection.query_row(
                "SELECT min(observed_at) FROM stat_snapshots WHERE kind='observation'",
                [],
                |r| r.get(0),
            )?,
            pseudo,
        })
    }

    /// Time each instance was observed running without its worlds progressing.
    ///
    /// Reads the sessions and deltas, then hands them to `attribute_deltas`,
    /// which owns the grace-window rule. Splitting it this way keeps the rule
    /// testable with synthetic data, because the reference archive cannot
    /// exercise it (no recorded delta falls inside a session there).
    ///
    /// Sessions with no observed end are counted but contribute no time: an
    /// interrupted observation cannot attest to when the game stopped, which is
    /// the same position `interrupt_observed_sessions` already takes.
    pub fn pseudo_server_time(&self) -> DbResult<Vec<InstancePseudo>> {
        Ok(self.pseudo_parts()?.0)
    }

    /// Pseudo time per instance, plus the same figure per session row.
    ///
    /// One computation serves both: the session table shows each run's own
    /// number, and the instance totals must agree with those rows, so deriving
    /// them separately would risk the two drifting apart.
    pub fn pseudo_attribution(&self) -> DbResult<Attribution> {
        self.pseudo_parts()
    }

    fn pseudo_parts(&self) -> DbResult<Attribution> {
        // Epoch seconds keep the arithmetic in one unit. `strftime` returns TEXT
        // in SQLite, so it is read as a string and parsed; an unparseable
        // timestamp yields NULL and those rows are counted as unknown rather
        // than silently becoming 0 (which would read as a zero-length session).
        let mut windows = Vec::new();
        let mut unknown: BTreeMap<String, usize> = BTreeMap::new();
        let mut names: BTreeMap<String, String> = BTreeMap::new();
        // The key is for comparison; this keeps the original path for display,
        // so the frontend still shows the instance's real directory.
        let mut display: BTreeMap<String, String> = BTreeMap::new();
        // Session id -> pseudo seconds, so the session list can show the figure
        // per row without the frontend re-deriving the attribution rule.
        let mut per_session = BTreeMap::new();
        let mut query = self.connection.prepare(
            "SELECT id, game_root, instance_name, \
             strftime('%s', started_at), strftime('%s', ended_at), \
             lead(strftime('%s', started_at)) OVER (PARTITION BY game_root ORDER BY started_at) \
             FROM observed_sessions ORDER BY game_root, started_at",
        )?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })? {
            let (id, game_root, instance_name, started, ended, next_start) = row?;
            // Sessions and deltas reach the archive in different path forms (the
            // scanner canonicalises, the process probe does not), so both sides
            // are compared through the same key. Joining on the raw string would
            // silently match nothing and report zero pseudo time.
            let key = crate::scanner::path_identity::comparison_key(&game_root);
            names.entry(key.clone()).or_insert(instance_name);
            display.entry(key.clone()).or_insert(game_root);
            let (Some(started), Some(ended)) = (
                started.and_then(|v| v.parse::<i64>().ok()),
                ended.and_then(|v| v.parse::<i64>().ok()),
            ) else {
                *unknown.entry(key).or_default() += 1;
                continue;
            };
            // A clock change could store an end before the start; treat it as
            // zero-length rather than subtracting into negative time.
            if ended < started {
                continue;
            }
            windows.push(SessionWindow {
                id,
                game_root: key,
                started,
                ended,
                next_start: next_start.and_then(|v| v.parse::<i64>().ok()),
            });
        }
        let mut deltas = Vec::new();
        let mut query = self.connection.prepare(
            "SELECT g.path, d.world_id, strftime('%s', d.observed_at), d.delta_ticks \
             FROM tracked_deltas d \
             JOIN worlds w ON w.id = d.world_id \
             JOIN game_roots g ON g.id = w.game_root_id",
        )?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })? {
            let (game_root, world_id, observed, ticks) = row?;
            let Some(observed) = observed.and_then(|v| v.parse::<i64>().ok()) else {
                continue;
            };
            deltas.push(DeltaAt {
                game_root: crate::scanner::path_identity::comparison_key(&game_root),
                world_id,
                observed,
                ticks,
            });
        }
        let attributed = attribute_deltas(&windows, &deltas, DELTA_GRACE_SECONDS);

        // A first local observation establishes a cursor; it is not a delta.
        // We cannot infer how much of that world's initial history belongs to
        // this run. Keep the entire run out of the numeric residual total.
        let mut first_observations: BTreeMap<String, Vec<i64>> = BTreeMap::new();
        let mut query = self.connection.prepare(
            "SELECT g.path, strftime('%s', min(s.observed_at)) FROM stat_snapshots s \
             JOIN worlds w ON w.id=s.world_id JOIN game_roots g ON g.id=w.game_root_id \
             WHERE s.kind='observation' GROUP BY s.world_id,s.player_uuid",
        )?;
        for row in query.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })? {
            let (root, first) = row?;
            if let Some(first) = first.and_then(|v| v.parse::<i64>().ok()) {
                first_observations
                    .entry(crate::scanner::path_identity::comparison_key(&root))
                    .or_default()
                    .push(first);
            }
        }

        for times in first_observations.values_mut() {
            times.sort_unstable();
        }
        // Week and month windows reuse the same local-date rule as the player
        // totals, so both figures agree on what "this week" means.
        //
        // SQLite's dynamic typing means `strftime` yields TEXT for a single
        // call but INTEGER once the values are subtracted, so the column is
        // read as a `Value` and converted either way.
        let epoch_of = |sql: &str| -> DbResult<i64> {
            let value: rusqlite::types::Value = self.connection.query_row(sql, [], |r| r.get(0))?;
            Ok(match value {
                rusqlite::types::Value::Integer(number) => number,
                rusqlite::types::Value::Text(text) => text.parse().unwrap_or(0),
                _ => 0,
            })
        };
        let mut week_start = epoch_of(
            "SELECT strftime('%s','now','localtime','start of day', \
             printf('-%d days',(cast(strftime('%w','now','localtime') as integer)+6)%7))",
        )?;
        let mut month_start = epoch_of("SELECT strftime('%s','now','localtime','start of month')")?;
        // SQLite computes those in local time; the session timestamps are stored
        // in UTC, so the bounds are shifted by the same offset before comparing.
        let offset = epoch_of("SELECT strftime('%s','now','localtime') - strftime('%s','now')")?;
        week_start -= offset;
        month_start -= offset;

        let mut totals: BTreeMap<String, (i64, i64, i64, usize, usize, usize)> = BTreeMap::new();
        for (index, session) in windows.iter().enumerate() {
            let entry = totals.entry(session.game_root.clone()).or_default();
            let last = session
                .next_start
                .map_or(session.ended + DELTA_GRACE_SECONDS, |next| {
                    (session.ended + DELTA_GRACE_SECONDS).min(next - 1)
                });
            let missing_baseline =
                first_observations
                    .get(&session.game_root)
                    .is_some_and(|times| {
                        let index = times.partition_point(|first| *first < session.started);
                        times.get(index).is_some_and(|first| *first <= last)
                    });
            if missing_baseline {
                per_session.insert(
                    session.id,
                    SessionEstimate {
                        seconds: 0,
                        missing_baseline: true,
                    },
                );
                entry.5 += 1;
                continue;
            }
            let observed = session.ended - session.started;
            let pseudo = (observed - attributed[index] / 20).max(0);
            // Kept so the session table can show the same figure per row rather
            // than re-deriving it in the frontend.
            per_session.insert(
                session.id,
                SessionEstimate {
                    seconds: pseudo,
                    missing_baseline: false,
                },
            );
            entry.0 += pseudo;
            if session.started >= week_start {
                entry.1 += pseudo;
            }
            if session.started >= month_start {
                entry.2 += pseudo;
            }
            entry.3 += 1;
        }
        for (game_root, count) in unknown {
            totals.entry(game_root).or_default().4 = count;
        }
        Ok((
            totals
                .into_iter()
                .map(
                    |(
                        key,
                        (seconds, week, month, sessions, unknown_sessions, baseline_sessions),
                    )| {
                        let instance_name = names.remove(&key).unwrap_or_default();
                        // Fall back to the key when a session had no display path
                        // (only possible if every session for it was unreadable).
                        let game_root = display.remove(&key).unwrap_or_else(|| key.clone());
                        InstancePseudo {
                            game_root,
                            instance_name,
                            seconds: seconds.to_string(),
                            week_seconds: week.to_string(),
                            month_seconds: month.to_string(),
                            sessions,
                            unknown_sessions,
                            baseline_sessions,
                        }
                    },
                )
                .collect(),
            per_session,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};

    /// Session ids are only used to key the per-session result, so the tests
    /// assign them sequentially.
    static NEXT_ID: AtomicI64 = AtomicI64::new(1);

    fn session(root: &str, started: i64, ended: i64, next: Option<i64>) -> SessionWindow {
        SessionWindow {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            game_root: root.into(),
            started,
            ended,
            next_start: next,
        }
    }

    fn delta(root: &str, world: i64, observed: i64, ticks: i64) -> DeltaAt {
        DeltaAt {
            game_root: root.into(),
            world_id: world,
            observed,
            ticks,
        }
    }

    #[test]
    fn a_session_with_no_world_progress_attributes_nothing() {
        let sessions = [session("root", 1000, 4600, None)];
        let attributed = attribute_deltas(&sessions, &[], DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![0]);
    }

    #[test]
    fn a_delta_inside_the_window_is_attributed() {
        let sessions = [session("root", 1000, 4600, None)];
        let deltas = [delta("root", 1, 2000, 600)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![600]);
    }

    /// The case the whole grace window exists for: the watcher scans after the
    /// process exits, so the delta is stamped after `ended`.
    #[test]
    fn a_delta_after_the_session_end_is_still_attributed() {
        let sessions = [session("root", 1000, 4600, None)];
        // Five minutes after the end, inside the 15-minute grace.
        let deltas = [delta("root", 1, 4900, 600)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(
            attributed,
            vec![600],
            "the post-exit scan must be credited to the run that caused it"
        );
    }

    #[test]
    fn a_delta_beyond_the_grace_is_not_attributed() {
        let sessions = [session("root", 1000, 4600, None)];
        // Twenty minutes after the end, outside the 15-minute grace.
        let deltas = [delta("root", 1, 5800, 600)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![0]);
    }

    /// Without the cap, a long idle gap would let an earlier run claim progress
    /// that actually happened during a later one.
    #[test]
    fn the_next_session_caps_the_grace_window() {
        // Session 1 ends at 4600; session 2 starts 120 s later. A delta at 4700
        // is inside session 1's grace but before session 2 begins, so session 1
        // claims it. A delta at 4730 belongs to session 2.
        let sessions = [
            session("root", 1000, 4600, Some(4720)),
            session("root", 4720, 9000, None),
        ];
        let deltas = [delta("root", 1, 4700, 600), delta("root", 1, 4730, 900)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![600, 900]);
    }

    #[test]
    fn a_delta_is_claimed_by_only_one_session() {
        // Overlapping windows: the delta must not be counted twice.
        let sessions = [
            session("root", 1000, 4600, None),
            session("root", 1000, 4600, None),
        ];
        let deltas = [delta("root", 1, 2000, 600)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed.iter().sum::<i64>(), 600);
    }

    /// Two players in one world record the same wall-clock progress twice.
    #[test]
    fn simultaneous_players_are_counted_once() {
        let sessions = [session("root", 1000, 4600, None)];
        let deltas = [
            delta("root", 1, 2000, 600),
            delta("root", 1, 2000, 590),
            delta("root", 1, 2000, 20),
        ];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![600], "take the largest, not the sum");
    }

    /// Two different worlds progressing at the same instant are independent.
    #[test]
    fn separate_worlds_at_the_same_instant_both_count() {
        let sessions = [session("root", 1000, 4600, None)];
        let deltas = [delta("root", 1, 2000, 600), delta("root", 2, 2000, 400)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![1000]);
    }

    #[test]
    fn another_instances_delta_is_ignored() {
        let sessions = [session("root-a", 1000, 4600, None)];
        let deltas = [delta("root-b", 1, 2000, 600)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![0]);
    }

    #[test]
    fn a_delta_before_the_session_started_is_ignored() {
        let sessions = [session("root", 1000, 4600, None)];
        let deltas = [delta("root", 1, 999, 600)];
        let attributed = attribute_deltas(&sessions, &deltas, DELTA_GRACE_SECONDS);
        assert_eq!(attributed, vec![0]);
    }
}

#[cfg(test)]
mod optimized_attribution_tests {
    use super::*;
    fn reference(sessions: &[SessionWindow], deltas: &[DeltaAt]) -> Vec<i64> {
        let mut merged = BTreeMap::new();
        for d in deltas {
            merged
                .entry((&d.game_root, d.world_id, d.observed))
                .and_modify(|v: &mut i64| *v = (*v).max(d.ticks))
                .or_insert(d.ticks);
        }
        let entries: Vec<_> = merged.into_iter().collect();
        let mut claimed = vec![false; entries.len()];
        let mut result = vec![0i64; sessions.len()];
        for (i, s) in sessions.iter().enumerate() {
            let last = s
                .next_start
                .map_or(s.ended + 900, |next| (s.ended + 900).min(next - 1));
            for (j, ((root, _, time), ticks)) in entries.iter().enumerate() {
                if !claimed[j] && **root == s.game_root && *time >= s.started && *time <= last {
                    claimed[j] = true;
                    result[i] = result[i].saturating_add(*ticks);
                }
            }
        }
        result
    }
    fn fixtures(n: usize) -> (Vec<SessionWindow>, Vec<DeltaAt>) {
        let sessions = (0..n)
            .map(|i| SessionWindow {
                id: i as i64,
                game_root: format!("root{}", i % 10),
                started: i as i64 * 1000,
                ended: i as i64 * 1000 + 100,
                next_start: Some(i as i64 * 1000 + 10000),
            })
            .collect();
        let deltas = (0..n * 5)
            .map(|i| DeltaAt {
                game_root: format!("root{}", (i / 5) % 10),
                world_id: (i % 3) as i64,
                observed: (i / 5) as i64 * 1000 + (i % 5) as i64 * 80,
                ticks: 40,
            })
            .collect();
        (sessions, deltas)
    }
    #[test]
    fn randomized_overlap_and_duplicate_claims_match_reference() {
        let mut seed = 42u64;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (seed >> 32) as i64
        };
        for _ in 0..60 {
            let sessions: Vec<_> = (0..50)
                .map(|id| {
                    let started = next() % 5000;
                    SessionWindow {
                        id,
                        game_root: format!("root{}", next() % 3),
                        started,
                        ended: started + next() % 1000,
                        next_start: if next() % 2 == 0 {
                            Some(started + next() % 2000)
                        } else {
                            None
                        },
                    }
                })
                .collect();
            let deltas: Vec<_> = (0..400)
                .map(|_| DeltaAt {
                    game_root: format!("root{}", next() % 3),
                    world_id: next() % 4,
                    observed: next() % 7000,
                    ticks: next() % 100000,
                })
                .collect();
            assert_eq!(
                attribute_deltas(&sessions, &deltas, 900),
                reference(&sessions, &deltas)
            );
        }
    }
    #[test]
    #[ignore = "same-machine performance report; run explicitly with --release --ignored --nocapture"]
    fn attribution_scale_report() {
        for n in [10, 1000, 10000] {
            let (sessions, deltas) = fixtures(n);
            let start = std::time::Instant::now();
            let old = reference(&sessions, &deltas);
            let old_ms = start.elapsed().as_secs_f64() * 1000.;
            let start = std::time::Instant::now();
            let new = attribute_deltas(&sessions, &deltas, 900);
            let new_ms = start.elapsed().as_secs_f64() * 1000.;
            assert_eq!(old, new);
            println!("working_set_bytes={}", super::super::working_set_bytes());
            println!("sessions={n} deltas={} reference_ms={old_ms:.3} optimized_ms={new_ms:.3} input_struct_bytes={}",deltas.len(),sessions.capacity()*std::mem::size_of::<SessionWindow>()+deltas.capacity()*std::mem::size_of::<DeltaAt>());
        }
    }
}
