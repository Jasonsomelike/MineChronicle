//! Contract tests for merging consecutive play-time increments.
//!
//! The observer records an increment every reconcile pass (300s), so an evening of
//! play arrived as dozens of separate "+ 5 分钟" rows. The timeline now merges runs
//! of increments that are close together, per world and player.
//!
//! Rows are inserted through a separate connection so the timestamps are exact;
//! relying on "now" cannot express a 9-minute gap.
mod support;
use minechronicle_lib::database::{
    activity::ActivityFilter, read_models::ScanSummary, DbResult, Repository,
};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use support::*;

/// Mirrors the threshold in `database::activity`; duplicated so a change there
/// cannot silently make these tests pass for the wrong reason.
const MERGE_GAP: i64 = 600;

/// `support::TestResult` is `Box<dyn Error>`, which a `DbResult` cannot widen into,
/// so repository calls go through this.
fn db<T>(result: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|error| error as _)
}

struct Archive {
    _temp: tempfile::TempDir,
    path: PathBuf,
}

fn open() -> TestResult2<Archive> {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "World")?;
    stats(&world, "stats", PLAYER, 20)?;
    let path = temp.path().join("archive.sqlite3");
    let report: ScanSummary = minechronicle_lib::scanner::GameRootScanner::default()
        .scan(std::slice::from_ref(&root), |_| true)
        .into();
    let mut repo = db(Repository::open(&path))?;
    db(repo.import(&report, std::slice::from_ref(&root)))?;
    Ok(Archive { _temp: temp, path })
}

/// The tests need `std::io::Error`-compatible ergonomics from `game()` plus the
/// repository's error type, so a local alias keeps both usable.
type TestResult2<T> = Result<T, Box<dyn std::error::Error>>;

impl Archive {
    fn world_id(&self) -> TestResult2<i64> {
        let connection = Connection::open(&self.path)?;
        Ok(connection.query_row("SELECT id FROM worlds LIMIT 1", [], |r| r.get(0))?)
    }

    /// Insert one increment at an explicit offset, in seconds from a fixed base.
    ///
    /// Both timestamps are set: the timeline keeps reading
    /// `stat_snapshots.observed_at` (the moment the scan ran), while
    /// `tracked_deltas.observed_at` is what the row's own delta is stamped with.
    /// Setting only the latter leaves every snapshot at "now", so nothing merges by
    /// time and the gap tests measure nothing.
    fn increment(&self, offset_seconds: i64, ticks: i64) -> TestResult2<()> {
        self.increment_for(offset_seconds, ticks, PLAYER)
    }

    fn increment_for(&self, offset_seconds: i64, ticks: i64, uuid: &str) -> TestResult2<()> {
        let world = self.world_id()?;
        let connection = Connection::open(&self.path)?;
        let snapshot: i64 = connection.query_row(
            "INSERT INTO stat_snapshots(world_id,player_uuid,kind,play_ticks,stats,normalized_hash,observed_at) \
             VALUES(?1,?2,'observation',?3,'{}','hash', \
                    strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d seconds',?4))) RETURNING id",
            params![world, uuid, ticks, offset_seconds],
            |r| r.get(0),
        )?;
        connection.execute(
            "INSERT INTO tracked_deltas(world_id,player_uuid,delta_ticks,observed_at,snapshot_id) \
             VALUES(?1,?2,?3, \
                    strftime('%Y-%m-%dT%H:%M:%SZ','2026-01-01',printf('+%d seconds',?4)),?5)",
            params![world, uuid, ticks, offset_seconds, snapshot],
        )?;
        Ok(())
    }

    fn timeline(&self) -> TestResult2<minechronicle_lib::database::activity::TimelinePage> {
        let repo = db(Repository::open(&self.path))?;
        db(repo.timeline(&ActivityFilter {
            kind: "increment".into(),
            ..Default::default()
        }))
    }

    fn timeline_page(
        &self,
        offset: u32,
    ) -> TestResult2<minechronicle_lib::database::activity::TimelinePage> {
        let repo = db(Repository::open(&self.path))?;
        db(repo.timeline(&ActivityFilter {
            kind: "increment".into(),
            offset,
            ..Default::default()
        }))
    }
}

/// Consecutive increments inside the threshold become one row whose total is the
/// sum, which is the whole point of the change.
#[test]
fn increments_within_the_threshold_merge_into_one_row() -> TestResult2<()> {
    let archive = open()?;
    for step in 0..5 {
        archive.increment(step * 300, 100)?;
    }
    let page = archive.timeline()?;
    assert_eq!(page.total, 1, "five increments 5 minutes apart are one run");
    let event = &page.events[0];
    assert_eq!(event.merged_count, 5);
    assert_eq!(event.delta_ticks, "500", "the run reports its total");
    assert_eq!(event.parts.len(), 5, "each observation is still available");
    Ok(())
}

/// A pause longer than the threshold must end the run, or "this morning" and
/// "this evening" would collapse into one misleading row.
#[test]
fn a_gap_beyond_the_threshold_starts_a_new_row() -> TestResult2<()> {
    let archive = open()?;
    // Three increments at 0s, 300s, 600s, then one well past the threshold measured
    // from the last of them, not from zero.
    for step in 0..3 {
        archive.increment(step * 300, 100)?;
    }
    archive.increment(600 + MERGE_GAP + 60, 700)?;
    let page = archive.timeline()?;
    assert_eq!(page.total, 2, "the long pause separates the runs");
    // Newest first.
    assert_eq!(page.events[0].merged_count, 1);
    assert_eq!(page.events[0].delta_ticks, "700");
    assert_eq!(page.events[1].merged_count, 3);
    assert_eq!(page.events[1].delta_ticks, "300");
    Ok(())
}

/// Exactly at the threshold still merges: the comparison is "greater than", so the
/// boundary is inclusive and a test written the other way would be off by one.
#[test]
fn a_gap_exactly_at_the_threshold_still_merges() -> TestResult2<()> {
    let archive = open()?;
    archive.increment(0, 100)?;
    archive.increment(MERGE_GAP, 100)?;
    let page = archive.timeline()?;
    assert_eq!(page.total, 1);
    assert_eq!(page.events[0].merged_count, 2);
    Ok(())
}

/// A run carries its own span, and `observed_at` stays the newest moment so
/// ordering is unchanged.
#[test]
fn a_merged_run_reports_its_span() -> TestResult2<()> {
    let archive = open()?;
    archive.increment(0, 100)?;
    archive.increment(300, 100)?;
    archive.increment(600, 100)?;
    let page = archive.timeline()?;
    let event = &page.events[0];
    let first = event
        .first_observed_at
        .as_deref()
        .ok_or("run start missing")?;
    assert_eq!(first, "2026-01-01T00:00:00Z", "the run's earliest moment");
    assert_eq!(
        event.observed_at, "2026-01-01T00:10:00Z",
        "observed_at stays the newest moment"
    );
    Ok(())
}

/// A single event must not claim to be a merge, and must not repeat its own delta
/// as a one-element parts list.
#[test]
fn an_unmerged_event_reports_no_span_and_no_parts() -> TestResult2<()> {
    let archive = open()?;
    archive.increment(0, 250)?;
    let page = archive.timeline()?;
    let event = &page.events[0];
    assert_eq!(event.merged_count, 1);
    assert_eq!(event.delta_ticks, "250");
    assert!(event.first_observed_at.is_none());
    assert!(event.parts.is_empty());
    Ok(())
}

/// Two players in one world are two runs. Merging on world alone would combine
/// their totals, which double counts the same wall-clock minutes.
#[test]
fn different_players_in_one_world_do_not_merge() -> TestResult2<()> {
    let archive = open()?;
    {
        let connection = Connection::open(&archive.path)?;
        connection.execute(
            "INSERT OR IGNORE INTO players(uuid,preferred_name) VALUES(?1,'Other')",
            params![OTHER],
        )?;
    }
    for step in 0..3 {
        archive.increment_for(step * 300, 100 * (step + 1), PLAYER)?;
        archive.increment_for(step * 300 + 1, 100, OTHER)?;
    }
    let page = archive.timeline()?;
    assert_eq!(page.total, 2, "one run per player");
    assert!(
        page.events.iter().all(|e| e.merged_count == 3),
        "each player's three increments stay in their own run"
    );
    Ok(())
}

/// Pagination counts merged rows, so page 2 continues after the runs rather than
/// repeating or skipping raw events.
#[test]
fn pagination_counts_merged_rows() -> TestResult2<()> {
    let archive = open()?;
    // 60 runs, each of 2 increments, separated by a gap that breaks them.
    for run in 0..60 {
        let base = run * (MERGE_GAP + 100);
        archive.increment(base, 100)?;
        archive.increment(base + 60, 100)?;
    }
    let first = archive.timeline()?;
    let second = archive.timeline_page(50)?;
    assert_eq!(first.total, 60, "60 runs, not 120 events");
    assert_eq!(first.events.len(), 50);
    assert_eq!(second.events.len(), 10, "the remainder is on page 2");
    let first_ids: Vec<i64> = first.events.iter().map(|e| e.id).collect();
    assert!(
        second.events.iter().all(|e| !first_ids.contains(&e.id)),
        "pages must not repeat a run"
    );
    Ok(())
}
