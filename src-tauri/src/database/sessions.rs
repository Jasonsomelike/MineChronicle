use super::{DbResult, Repository};
use crate::launcher::running::ActiveInstance;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ObservedSession {
    pub id: i64,
    pub game_root: String,
    pub instance_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    /// Seconds of this run with no world progress: play whose statistics live
    /// somewhere the archive cannot see (a server). Filled in by
    /// `tracking_summary`, which owns the attribution rule; `observed_sessions`
    /// alone leaves it at zero.
    #[serde(default)]
    pub pseudo_seconds: String,
    pub missing_baseline: bool,
    /// `None` for an end the observer recorded, `Some("manual")` for one the
    /// user supplied. The UI needs this to mark the value and offer an undo:
    /// a typed end time is an estimate, and presenting it as observed would be
    /// indistinguishable from the real thing.
    #[serde(default)]
    pub ended_source: Option<String>,
    /// When the manual edit was made. An audit trail only; never read by the
    /// attribution calculation.
    #[serde(default)]
    pub edited_at: Option<String>,
    #[serde(skip)]
    pub(crate) local_date: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Deserialize)]
#[serde(default)]
pub struct ObservationQuery {
    pub game_root: String,
    pub from: String,
    pub to: String,
    pub status: String,
    pub boundary: Option<i64>,
    pub snapshot: Option<String>,
    /// Which page of each instance's own records to return, newest first.
    ///
    /// Absent means page 1. This replaced a page number that addressed the whole
    /// filtered set: one pager over every instance could only ever describe a
    /// list spanning instances the reader was not looking at.
    pub group_page: Option<i64>,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ObservationInstance {
    pub game_root: String,
    pub name: String,
}

/// One instance's sessions, as a group the UI can collapse.
///
/// Grouping happens here rather than in the frontend because an instance's sessions
/// can outnumber a page: the reference archive has one instance with 19 sessions and
/// a page holds 20, so any grouping done per page would split a single instance
/// across two pages and show it twice with partial totals.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ObservationGroup {
    pub game_root: String,
    pub name: String,
    /// Sessions in this group on this group's own page, newest first.
    pub sessions: Vec<ObservedSession>,
    /// Total sessions for this instance across all history, not just this page.
    pub session_count: i64,
    /// Summed `pseudo_seconds` across every session in the group, so a collapsed
    /// row still shows the instance's real total. Empty, not `0`, when no session
    /// in the group had a measurable duration (every run ended unobserved or lacks
    /// a baseline): `0 秒` would claim a measurement the archive does not have, so
    /// an empty reading means unknown and the UI prints its unknown marker.
    pub seconds: String,
    /// Sessions excluded from `seconds` because their end was never observed.
    pub unknown_sessions: i64,
    /// Sessions excluded because a first local baseline could not be attributed.
    pub baseline_sessions: i64,
    /// Which page of *this instance's* records `sessions` holds.
    pub page: i64,
    /// How many pages this instance's records span at the current page size.
    pub page_count: i64,
}

/// Fill in each group's own page: how many pages it spans, which one is showing,
/// and the rows that belong to it.
///
/// Every instance is paged on its own cursor, so advancing one instance leaves the
/// others where they were. That is the whole point: a single pager spanning every
/// instance is what made 「第 1 / 3 页 · 共 43 条」 describe a list the reader was
/// not looking at.
///
/// `group_page` is one number for all groups because a reader moves one pager at a
/// time. A group that does not span the requested page clamps to its own last
/// page, so every rendered pager still shows a page that exists.
pub(crate) fn assign_group_pages(
    groups: Vec<ObservationGroup>,
    filtered: &[ObservedSession],
    group_page: Option<i64>,
    page_size: i64,
) -> Vec<ObservationGroup> {
    let size = page_size.max(1);
    let requested = group_page.unwrap_or(1).max(1);
    let pages = |count: i64| ((count + size - 1) / size).max(1);
    groups
        .into_iter()
        .map(|mut group| {
            // `filtered` is the whole filtered set in the same newest-first order
            // the group's rows are in, so an instance's own page is a skip/take
            // over its occurrences and needs no knowledge of any other instance.
            let rows = filtered
                .iter()
                .filter(|session| session.game_root == group.game_root);
            let count = rows.clone().count() as i64;
            group.page = requested.min(pages(count));
            group.page_count = pages(count);
            group.sessions = rows
                .skip(((group.page - 1) * size) as usize)
                .take(size as usize)
                .cloned()
                .collect();
            group
        })
        .collect()
}

/// What a manual end time is allowed to be, for one session.
///
/// Returned to the UI so the input can be constrained before submitting, and
/// recomputed inside `set_session_end` because a form hint is not a guarantee:
/// the row can change between opening the dialog and pressing save.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ManualEndBounds {
    pub started_at: String,
    /// Start of the next session for the same instance, if there is one.
    /// `None` means the only upper limit is the current time.
    pub max_ended_at: Option<String>,
    pub status: String,
}

/// Parse the stored form `YYYY-MM-DDTHH:MM:SSZ` into epoch seconds.
///
/// Validated in Rust rather than handed to SQLite, because SQLite normalises an
/// impossible date (2026-02-30 becomes 2026-03-02) instead of rejecting it. A
/// user typing a date that does not exist should be told, not have a nearby
/// instant silently substituted.
///
/// The form is fixed-width UTC, matching the 20-character convention
/// `sessions_contract.rs` already asserts for these columns.
fn parse_timestamp(value: &str) -> DbResult<i64> {
    let invalid = || -> Box<dyn std::error::Error + Send + Sync> {
        format!("时间格式应为 YYYY-MM-DDTHH:MM:SSZ，收到 {value}").into()
    };
    let bytes = value.as_bytes();
    if bytes.len() != 20 || bytes[19] != b'Z' {
        return Err(invalid());
    }
    for (index, byte) in bytes.iter().enumerate() {
        let separator = match index {
            4 | 7 => Some(b'-'),
            10 => Some(b'T'),
            13 | 16 => Some(b':'),
            19 => Some(b'Z'),
            _ => None,
        };
        match separator {
            Some(want) if *byte != want => return Err(invalid()),
            Some(_) => {}
            None if !byte.is_ascii_digit() => return Err(invalid()),
            None => {}
        }
    }
    // The separators and lengths were validated above, so every slice below is
    // in range and holds only ASCII digits. Parsing still returns a `Result`
    // rather than unwrapping: a panic in a command handler would take the whole
    // window down, and this function exists precisely to reject bad input.
    let number = |start: usize, len: usize| -> DbResult<i64> {
        value[start..start + len].parse().map_err(|_| invalid())
    };
    let (year, month, day) = (number(0, 4)?, number(5, 2)?, number(8, 2)?);
    let (hour, minute, second) = (number(11, 2)?, number(14, 2)?, number(17, 2)?);
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return Err(invalid());
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if leap {
                29
            } else {
                28
            }
        }
    };
    if day < 1 || day > days {
        return Err(invalid());
    }
    // Days since the Unix epoch, so the comparisons below are plain integers.
    // The civil-from-days algorithm, run in reverse.
    let shifted_year = if month <= 2 { year - 1 } else { year };
    let era = shifted_year.div_euclid(400);
    let year_of_era = shifted_year - era * 400;
    let shifted_month = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Ok(days * 86_400 + hour * 3600 + minute * 60 + second)
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ObservedSessionsPage {
    pub sessions: Vec<ObservedSession>,
    /// The same rows grouped by instance, for the collapsible view. Each group
    /// carries its own totals across all history so a collapsed instance is still
    /// informative.
    pub groups: Vec<ObservationGroup>,
    pub total: i64,
    pub history_total: i64,
    pub snapshot: Option<String>,
    pub history_changed: bool,
    pub filtered_seconds: String,
    pub boundary: i64,
    pub new_records: i64,
    pub instances: Vec<ObservationInstance>,
    pub page: i64,
    pub page_size: i64,
    pub total_seconds: String,
    pub unknown_sessions: usize,
    pub baseline_sessions: usize,
    pub running_sessions: i64,
}

/// Group sessions by instance, using the estimates already attached to each row.
///
/// Shared by the direct query and the cache so both produce identical groups: the
/// cache slices a full-history page and would otherwise duplicate this, and two
/// implementations of the same totals is how a collapsed view and the totals line
/// start disagreeing.
///
/// Reads `pseudo_seconds` and `missing_baseline` off the row rather than a separate
/// estimate map, because every caller has already filled them in.
pub(crate) fn group_sessions(sessions: &[ObservedSession]) -> Vec<ObservationGroup> {
    let mut order: Vec<String> = Vec::new();
    let mut grouped: std::collections::BTreeMap<String, ObservationGroup> =
        std::collections::BTreeMap::new();
    for session in sessions {
        let ended = session.ended_at.is_some();
        let missing_baseline = session.missing_baseline;
        let seconds: i128 = session.pseudo_seconds.parse().unwrap_or(0);
        let entry = grouped.entry(session.game_root.clone()).or_insert_with(|| {
            order.push(session.game_root.clone());
            ObservationGroup {
                game_root: session.game_root.clone(),
                name: session.instance_name.clone(),
                sessions: Vec::new(),
                session_count: 0,
                seconds: String::new(),
                unknown_sessions: 0,
                baseline_sessions: 0,
                // Totals only. Which page of the instance's records to return is
                // decided by `assign_group_pages`, which is the only place that
                // knows the page size and the requested page.
                page: 1,
                page_count: 1,
            }
        });
        entry.session_count += 1;
        if !ended {
            // No observed end means no measurable duration.
            entry.unknown_sessions += 1;
        } else if missing_baseline {
            // A first local baseline cannot be attributed to this session.
            entry.baseline_sessions += 1;
        } else {
            let running: i128 = entry.seconds.parse().unwrap_or(0);
            entry.seconds = (running + seconds).to_string();
        }
    }
    order
        .into_iter()
        .filter_map(|key| grouped.remove(&key))
        .collect()
}

impl Repository {
    /// A stopped observer cannot attest to game termination. Preserve the start
    /// and leave the end unknown instead of inventing a game-exit timestamp.
    pub fn interrupt_observed_sessions(&self) -> DbResult<()> {
        self.connection.execute(
            "UPDATE observed_sessions SET status='interrupted' WHERE status='running'",
            [],
        )?;
        Ok(())
    }

    pub fn observe_instances(&mut self, active: &[ActiveInstance]) -> DbResult<()> {
        let tx = self.connection.transaction()?;
        let now: String = tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
            r.get(0)
        })?;
        let existing = {
            let mut query = tx.prepare(
                "SELECT id,game_root,pids FROM observed_sessions WHERE status='running'",
            )?;
            let rows = query.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut matched = std::collections::HashSet::new();
        for (id, root, pids) in existing {
            let previous: Vec<u32> = serde_json::from_str(&pids)?;
            let current = active.iter().enumerate().find(|(_, a)| {
                super::path_key(&a.game_root).is_some_and(|key| key == root)
                    && a.pids.iter().any(|pid| previous.contains(pid))
            });
            if let Some((index, instance)) = current {
                matched.insert(index);
                tx.execute(
                    "UPDATE observed_sessions SET pids=?,instance_name=? WHERE id=?",
                    params![serde_json::to_string(&instance.pids)?, instance.name, id],
                )?;
            } else {
                tx.execute(
                    "UPDATE observed_sessions SET status='closed',ended_at=? WHERE id=?",
                    params![now, id],
                )?;
            }
        }
        for (index, instance) in active.iter().enumerate() {
            if !matched.contains(&index) {
                // An instance whose root path cannot be stored is skipped rather
                // than failing the whole session update.
                let Some(game_root) = super::path_key(&instance.game_root) else {
                    continue;
                };
                tx.execute(
                    "INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,status) VALUES(?,?,?,?,'running')",
                    params![game_root, instance.name, serde_json::to_string(&instance.pids)?, now],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn observed_sessions(&self) -> DbResult<Vec<ObservedSession>> {
        self.session_rows(50, 0)
    }

    fn session_rows(&self, limit: i64, offset: i64) -> DbResult<Vec<ObservedSession>> {
        let mut query = self.connection.prepare(
            "SELECT id,game_root,instance_name,started_at,ended_at,status,date(started_at,'localtime'),ended_source,edited_at FROM observed_sessions ORDER BY id DESC LIMIT ? OFFSET ?",
        )?;
        let rows = query.query_map(params![limit, offset], |r| {
            Ok(ObservedSession {
                id: r.get(0)?,
                game_root: r.get(1)?,
                instance_name: r.get(2)?,
                started_at: r.get(3)?,
                ended_at: r.get(4)?,
                status: r.get(5)?,
                pseudo_seconds: "0".into(),
                missing_baseline: false,
                ended_source: r.get(7)?,
                edited_at: r.get(8)?,
                local_date: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// The same list with each run's pseudo-server time filled in.
    ///
    /// Kept separate from `observed_sessions` because attribution needs the
    /// deltas as well as the sessions, and callers that only want the raw
    /// boundaries should not pay for that.
    pub fn observed_sessions_with_pseudo(&self) -> DbResult<Vec<ObservedSession>> {
        let mut sessions = self.observed_sessions()?;
        let (_, per_session) = self.pseudo_attribution()?;
        for session in &mut sessions {
            if let Some(estimate) = per_session.get(&session.id) {
                session.pseudo_seconds = estimate.seconds.to_string();
                session.missing_baseline = estimate.missing_baseline;
            }
        }
        Ok(sessions)
    }

    pub fn observed_sessions_page(&self, requested_page: i64) -> DbResult<ObservedSessionsPage> {
        self.observed_sessions_query(requested_page, &ObservationQuery::default())
    }

    /// The range a manual end time may fall in, for one session.
    ///
    /// The upper bound is the next session's start for the *same* instance:
    /// two sessions of one instance cannot overlap, or the same wall-clock
    /// minutes would be counted twice in every total. Sessions of other
    /// instances are unrelated and do not constrain this one.
    pub fn manual_end_bounds(&self, id: i64) -> DbResult<ManualEndBounds> {
        let (game_root, started_at, status): (String, String, String) = self
            .connection
            .query_row(
                "SELECT game_root,started_at,status FROM observed_sessions WHERE id=?",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?
            .ok_or("找不到该观测记录")?;
        let next_start: Option<String> = self
            .connection
            .query_row(
                "SELECT min(started_at) FROM observed_sessions \
                 WHERE game_root=? AND id<>? AND started_at>?",
                params![game_root, id, started_at],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(ManualEndBounds {
            started_at,
            max_ended_at: next_start,
            status,
        })
    }

    /// Record a user-supplied end time.
    ///
    /// `ended_at` and `status` change in one statement on purpose:
    /// 006_sessions.sql constrains them together
    /// (`status='closed'` iff `ended_at IS NOT NULL`), so setting either alone
    /// is rejected by the database. Verified against a real archive.
    ///
    /// `AND status<>'running'` keeps a live session out of reach. Editing one
    /// would leave the periodic observer to close it again on its own terms,
    /// so the row would carry a manual end that the next poll contradicts.
    pub fn set_session_end(&self, id: i64, ended_at: &str) -> DbResult<()> {
        let bounds = self.manual_end_bounds(id)?;
        if bounds.status == "running" {
            return Err("正在运行的会话不能手动填写结束时间".into());
        }
        // Compared as parsed epoch seconds rather than strings: the stored form
        // is fixed-width UTC so string order happens to agree, but relying on
        // that would break the moment a value carried milliseconds.
        let started = parse_timestamp(&bounds.started_at)?;
        let ended = parse_timestamp(ended_at)?;
        if ended <= started {
            return Err("结束时间必须晚于开始时间".into());
        }
        if ended > parse_timestamp(&self.now_utc()?)? {
            return Err("结束时间不能晚于当前时间".into());
        }
        if let Some(max) = &bounds.max_ended_at {
            if ended > parse_timestamp(max)? {
                return Err(format!("不能晚于下一次会话开始时间 {max}").into());
            }
        }
        let changed = self.connection.execute(
            "UPDATE observed_sessions \
             SET ended_at=?,status='closed',ended_source='manual',\
                 edited_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') \
             WHERE id=? AND status<>'running'",
            params![ended_at, id],
        )?;
        if changed == 0 {
            // The row closed or was removed between reading bounds and writing.
            return Err("该会话状态已变化，请刷新后重试".into());
        }
        Ok(())
    }

    /// Undo a manual end, returning the session to the interrupted state.
    ///
    /// Both columns change together for the same CHECK reason as above, and
    /// `ended_source` is cleared so the row is once again indistinguishable
    /// from one the observer never closed.
    pub fn clear_session_end(&self, id: i64) -> DbResult<()> {
        let changed = self.connection.execute(
            "UPDATE observed_sessions \
             SET ended_at=NULL,status='interrupted',ended_source=NULL,edited_at=NULL \
             WHERE id=? AND ended_source='manual'",
            params![id],
        )?;
        if changed == 0 {
            return Err("该观测记录的结束时间不是手动填写的".into());
        }
        Ok(())
    }

    pub(crate) fn now_utc(&self) -> DbResult<String> {
        Ok(self
            .connection
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
                r.get(0)
            })?)
    }

    pub fn observed_sessions_query(
        &self,
        requested_page: i64,
        query: &ObservationQuery,
    ) -> DbResult<ObservedSessionsPage> {
        self.observed_sessions_query_sized(requested_page, query, 20)
    }
    pub(crate) fn validate_observation_query(&self, query: &ObservationQuery) -> DbResult<()> {
        if !["", "running", "closed", "interrupted"].contains(&query.status.as_str()) {
            return Err("不支持的观测状态".into());
        }
        for date in [&query.from, &query.to] {
            if !date.is_empty() {
                let valid: bool = self.connection.query_row(
                    "SELECT length(?)=10 AND coalesce(date(?)=?,0)",
                    params![date, date, date],
                    |r| r.get(0),
                )?;
                if !valid {
                    return Err("日期需要 YYYY-MM-DD 格式".into());
                }
            }
        }
        if !query.from.is_empty() && !query.to.is_empty() && query.from > query.to {
            return Err("开始日期不能晚于结束日期".into());
        }
        Ok(())
    }
    pub(crate) fn observation_ids(
        &self,
        query: &ObservationQuery,
        boundary: i64,
    ) -> DbResult<Vec<i64>> {
        self.validate_observation_query(query)?;
        let mut q = self.connection.prepare("SELECT id FROM observed_sessions WHERE id<=? AND (?='' OR game_root=?) AND (?='' OR date(started_at,'localtime')>=?) AND (?='' OR date(started_at,'localtime')<=?) AND (?='' OR status=?) ORDER BY id DESC")?;
        let ids = q
            .query_map(
                params![
                    boundary,
                    query.game_root,
                    query.game_root,
                    query.from,
                    query.from,
                    query.to,
                    query.to,
                    query.status,
                    query.status
                ],
                |r| r.get::<_, i64>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        drop(q);
        Ok(ids)
    }
    pub(crate) fn observed_sessions_query_sized(
        &self,
        requested_page: i64,
        query: &ObservationQuery,
        page_size: i64,
    ) -> DbResult<ObservedSessionsPage> {
        let tx = self.connection.unchecked_transaction()?;
        let maximum: i64 = tx.query_row(
            "SELECT coalesce(max(id),0) FROM observed_sessions",
            [],
            |r| r.get(0),
        )?;
        let boundary = query.boundary.unwrap_or(maximum).clamp(0, maximum);
        let all = self.session_rows(i64::MAX, 0)?;
        let ids = self.observation_ids(query, boundary)?;
        let total = ids.len() as i64;
        let page = requested_page.clamp(1, ((total + page_size - 1) / page_size).max(1));
        let page_ids: std::collections::HashSet<_> = ids
            .iter()
            .skip(((page - 1) * page_size) as usize)
            .take(page_size as usize)
            .copied()
            .collect();
        let (totals, estimates) = self.pseudo_attribution()?;
        let filtered_seconds = ids
            .iter()
            .filter_map(|id| estimates.get(id))
            .map(|v| i128::from(v.seconds))
            .sum::<i128>()
            .to_string();
        let mut instances = std::collections::BTreeMap::new();
        for session in &all {
            instances
                .entry(session.game_root.clone())
                .or_insert(session.instance_name.clone());
        }
        let history_total = all.len() as i64;
        let new_records = all.iter().filter(|s| s.id > boundary).count() as i64;
        let running_sessions = all.iter().filter(|s| s.status == "running").count() as i64;
        // Groups are built from every filtered session, not just this page, so a
        // collapsed instance shows its real totals rather than this page's share.
        let filtered: std::collections::HashSet<i64> = ids.iter().copied().collect();
        let mut sessions: Vec<_> = all
            .iter()
            .filter(|s| page_ids.contains(&s.id))
            .cloned()
            .collect();
        for session in &mut sessions {
            if let Some(estimate) = estimates.get(&session.id) {
                session.pseudo_seconds = estimate.seconds.to_string();
                session.missing_baseline = estimate.missing_baseline;
            }
        }
        // Totals come from the filtered set, rows from the page. Grouping the page
        // rows alone would report one page's worth of time under an instance that
        // spans several pages.
        let history: Vec<_> = all
            .iter()
            .filter(|s| filtered.contains(&s.id))
            .cloned()
            .map(|mut session| {
                if let Some(estimate) = estimates.get(&session.id) {
                    session.pseudo_seconds = estimate.seconds.to_string();
                    session.missing_baseline = estimate.missing_baseline;
                }
                session
            })
            .collect();
        let mut groups = group_sessions(&history);
        // Each instance slices its own records; no group's page depends on
        // another's, and the global `page` no longer moves group contents.
        groups = assign_group_pages(groups, &history, query.group_page, page_size);
        let result = ObservedSessionsPage {
            groups,
            sessions,
            total,
            history_total,
            snapshot: None,
            history_changed: false,
            filtered_seconds,
            boundary,
            new_records,
            instances: instances
                .into_iter()
                .map(|(game_root, name)| ObservationInstance { game_root, name })
                .collect(),
            page,
            page_size,
            total_seconds: estimates
                .values()
                .map(|v| i128::from(v.seconds))
                .sum::<i128>()
                .to_string(),
            unknown_sessions: totals.iter().map(|v| v.unknown_sessions).sum(),
            baseline_sessions: totals.iter().map(|v| v.baseline_sessions).sum(),
            running_sessions,
        };
        tx.commit()?;
        Ok(result)
    }
}

#[cfg(test)]
mod timestamp_tests {
    use super::parse_timestamp;

    /// Cross-checked against SQLite, which is the authority for every other
    /// timestamp in this archive. If these two disagree, a manual end time
    /// would sort differently from an observed one.
    #[test]
    fn parses_the_stored_form_exactly_like_sqlite() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        for value in [
            "1970-01-01T00:00:00Z",
            "2026-09-18T13:52:20Z",
            "2026-09-18T14:25:23Z",
            "2024-02-29T23:59:59Z",
            "2000-02-29T00:00:00Z",
            "2100-03-01T12:34:56Z",
            "1999-12-31T23:59:59Z",
        ] {
            let sqlite: i64 = connection
                .query_row("SELECT strftime('%s',?)", [value], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap()
                .parse()
                .unwrap();
            assert_eq!(
                parse_timestamp(value).unwrap(),
                sqlite,
                "disagrees with SQLite for {value}"
            );
        }
    }

    #[test]
    fn rejects_impossible_dates_instead_of_normalising_them() {
        // SQLite turns 2026-02-30 into 2026-03-02. Accepting that would silently
        // store a different instant than the user typed.
        for value in [
            "2026-02-30T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-00-10T00:00:00Z",
            "2026-01-00T00:00:00Z",
            "2026-04-31T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:60:00Z",
            "2026-01-01T00:00:60Z",
        ] {
            assert!(parse_timestamp(value).is_err(), "should reject {value}");
        }
    }

    #[test]
    fn accepts_a_leap_day_only_in_a_leap_year() {
        assert!(parse_timestamp("2024-02-29T00:00:00Z").is_ok());
        assert!(parse_timestamp("2025-02-29T00:00:00Z").is_err());
        assert!(parse_timestamp("1900-02-29T00:00:00Z").is_err());
        assert!(parse_timestamp("2000-02-29T00:00:00Z").is_ok());
    }

    #[test]
    fn rejects_anything_not_in_the_exact_stored_form() {
        for value in [
            "",
            "2026-09-18",
            "2026-09-18T13:52:20",
            "2026-09-18T13:52:20.000Z",
            "2026-09-18 13:52:20Z",
            "2026-09-18T13:52:20+08:00",
            "20260918T135220Z",
            "abcd-ef-ghTij:kl:mnZ",
        ] {
            assert!(parse_timestamp(value).is_err(), "should reject {value:?}");
        }
    }
}

#[cfg(test)]
mod query_tests {
    use super::*;
    #[test]
    fn frozen_boundary_prevents_duplicates_and_filters_by_root_date_status() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("archive.sqlite3");
        let repo = Repository::open(&path).unwrap();
        for i in 1..=51 {
            repo.connection.execute("INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) VALUES(?,'Same name','[]','2026-01-15T10:00:00Z','2026-01-15T10:01:00Z','closed')",[if i%2==0{"root-a"}else{"root-b"}]).unwrap();
        }
        let first = repo.observed_sessions_page(1).unwrap();
        repo.connection.execute("INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,status) VALUES('root-a','Same name','[]','2026-01-16T10:00:00Z','running')",[]).unwrap();
        let query = ObservationQuery {
            boundary: Some(first.boundary),
            ..Default::default()
        };
        let second = repo.observed_sessions_query(2, &query).unwrap();
        assert_eq!(second.new_records, 1);
        assert_eq!(second.total, 51);
        assert_eq!(second.history_total, 52);
        assert!(!first
            .sessions
            .iter()
            .any(|a| second.sessions.iter().any(|b| a.id == b.id)));
        let date: String = repo
            .connection
            .query_row("SELECT date('2026-01-15T10:00:00Z','localtime')", [], |r| {
                r.get(0)
            })
            .unwrap();
        let filtered = repo
            .observed_sessions_query(
                1,
                &ObservationQuery {
                    game_root: "root-a".into(),
                    from: date.clone(),
                    to: date,
                    status: "closed".into(),
                    ..query
                },
            )
            .unwrap();
        assert_eq!(filtered.total, 25);
        assert_eq!(filtered.filtered_seconds, "1500");
        assert_eq!(filtered.instances.len(), 2);
        assert!(repo
            .observed_sessions_query(
                1,
                &ObservationQuery {
                    from: "bad".into(),
                    ..Default::default()
                }
            )
            .is_err());
    }
    #[test]
    #[ignore = "explicit scale report"]
    fn observation_query_scale_report() {
        for count in [10, 1000, 10000] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("archive.sqlite3");
            let repo = Repository::open(&path).unwrap();
            repo.connection.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) SELECT 'root','Instance','[]',strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d minutes',x)),strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d minutes',x+1)),'closed' FROM n",[count]).unwrap();
            let start = std::time::Instant::now();
            let page = repo.observed_sessions_page(1).unwrap();
            let elapsed = start.elapsed().as_secs_f64() * 1000.;
            let database_bytes: i64 = repo
                .connection
                .query_row(
                    "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            println!(
                "query_sessions={count} session_rows_materialized={} matched_ids={count} response_rows={} query_ms={:.3} logical_database_bytes={}",
                count * 2,
                page.sessions.len(),
                elapsed,
                database_bytes
            );
            println!("working_set_bytes={}", super::super::working_set_bytes());
            assert_eq!(page.total, count);
        }
    }
}
