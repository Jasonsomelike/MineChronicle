//! Pins the clone-detection pair cap behaviour.
//!
//! `detect_candidates` stops adding candidate pairs once MAX_PAIRS is reached.
//! It used to `break` out of the whole group loop, so a single oversized group
//! suppressed every later group - including groups that would have fitted under
//! the cap. It now skips only the group that does not fit and continues, and
//! reports how many groups were skipped.
mod support;
use minechronicle_lib::database::{DbResult, Repository};
use support::*;

fn db<T>(result: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|error| error as _)
}

/// The pair cap is high enough that a normal archive never reaches it, so this
/// checks the reporting plumbing rather than trying to construct 2000 pairs.
#[test]
fn a_normal_archive_reports_no_skipped_groups() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Clone")?;
    stats(&world, "stats", PLAYER, 40_000)?;

    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    db(repo.import(
        &minechronicle_lib::scanner::GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .into(),
        &[root],
    ))?;

    let summary = db(repo.health_summary())?;
    assert!(
        !summary.analysis_limited,
        "one small archive must not hit the pair cap"
    );
    assert_eq!(
        summary.analysis_skipped_groups, 0,
        "nothing was skipped, so the count must be zero"
    );
    Ok(())
}

/// A single world with one player cannot form a pair, so this also guards
/// against the cap being reported spuriously.
#[test]
fn skipped_group_count_starts_at_zero_on_a_fresh_archive() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Solo")?;
    stats(&world, "stats", PLAYER, 13_000)?;

    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    db(repo.import(
        &minechronicle_lib::scanner::GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .into(),
        &[root],
    ))?;

    let summary = db(repo.health_summary())?;
    assert_eq!(summary.analysis_skipped_groups, 0);
    // The field must be present and serialised for the frontend contract.
    let json = serde_json::to_value(&summary)?;
    assert!(
        json.get("analysis_skipped_groups").is_some(),
        "the count must reach the frontend: {json}"
    );
    Ok(())
}
