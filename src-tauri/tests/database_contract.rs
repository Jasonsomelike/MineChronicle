mod support;
use minechronicle_lib::{
    database::{read_models::ScanSummary, DbResult, Repository},
    domain::WorldStatus,
    scanner::GameRootScanner,
};
use std::{fs, path::Path};
use support::*;

fn db<T>(result: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|e| e as _)
}
fn scan(root: &Path) -> ScanSummary {
    GameRootScanner::default()
        .scan(&[root.to_owned()], |_| true)
        .into()
}

/// An archive left at an older schema must be upgraded in place by open(),
/// including the version-1 baseline that only 001_initial.sql had applied.
/// This is the path the single-list migrate() replaced, so pin it here.
#[test]
fn legacy_archive_upgrades_from_initial_schema_to_latest() -> TestResult {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("legacy.sqlite3");
    {
        let connection = rusqlite::Connection::open(&path)?;
        connection.execute_batch(include_str!("../src/database/001_initial.sql"))?;
        assert_eq!(
            connection.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
            1
        );
    }
    let repo = db(Repository::open(&path))?;
    let connection = rusqlite::Connection::open(&path)?;
    assert_eq!(
        connection.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
        6
    );
    for table in [
        "instances",
        "tracking_cursors",
        "stat_rollbacks",
        "clone_evidence",
        "lineage_details",
        "health_reviews",
        "analysis_status",
        "observed_sessions",
    ] {
        assert_eq!(
            connection.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",
                [table],
                |r| r.get::<_, i64>(0)
            )?,
            1,
            "missing table after upgrade: {table}"
        );
    }
    // The upgraded archive must be readable through the normal path.
    let library = db(repo.load())?;
    assert!(library.roots.is_empty());
    assert_eq!(
        connection.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))?,
        "ok"
    );
    Ok(())
}

#[test]
fn migrations_are_versioned_and_reopening_preserves_settings() -> TestResult {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    db(repo.import(
        &ScanSummary::from(minechronicle_lib::scanner::ScanReport::default()),
        &[temp.path().to_owned()],
    ))?;
    drop(repo);
    let reopened = db(Repository::open(&path))?;
    assert_eq!(db(reopened.inputs())?, vec![temp.path().to_owned()]);
    let conn = rusqlite::Connection::open(&path)?;
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
        6
    );
    for table in [
        "launcher_installations",
        "game_roots",
        "instances",
        "worlds",
        "instance_world_links",
        "players",
        "world_players",
        "stat_snapshots",
        "tracked_deltas",
        "anomalies",
        "clone_candidates",
        "world_lineages",
        "settings",
        "observed_sessions",
    ] {
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",
                [table],
                |r| r.get::<_, i64>(0)
            )?,
            1
        );
    }
    conn.execute_batch("PRAGMA user_version=99;")?;
    assert!(Repository::open(&path).is_err());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM settings", [], |r| r.get::<_, i64>(0))?,
        1
    );
    Ok(())
}

#[test]
fn first_import_is_immutable_across_repeats_increases_and_rollbacks() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Archive")?;
    stats(&world, "stats", PLAYER, 72000)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    for ticks in [72000, 72000, 144000, 20] {
        stats(&world, "stats", PLAYER, ticks)?;
        db(repo.import(&scan(&root), std::slice::from_ref(&root)))?;
        let report = db(repo.load())?;
        assert_eq!(report.historical_ticks, "72000");
        assert_eq!(
            report.roots[0].worlds[0].players[0].play_ticks,
            Some(ticks.to_string())
        );
        assert_eq!(
            report.roots[0].worlds[0].players[0]
                .initial_play_ticks
                .as_deref(),
            Some("72000")
        );
    }
    drop(repo);
    let report = db(db(Repository::open(&path))?.load())?;
    assert_eq!(report.roots[0].worlds[0].name, "Archive");
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM stat_snapshots WHERE kind='initial_import'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        1
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM tracked_deltas", [], |r| r
            .get::<_, i64>(0))?,
        1
    );
    let stored: String = conn.query_row(
        "SELECT stats FROM stat_snapshots WHERE kind='initial_import'",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stored)?["play_ticks"],
        72000
    );
    Ok(())
}

#[test]
fn missing_world_retains_history_and_restores_without_another_initial_import() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Returns")?;
    stats(&world, "stats", PLAYER, 400)?;
    let mut repo = db(Repository::open(&temp.path().join("library.sqlite3")))?;
    db(repo.import(&scan(&root), &[]))?;
    let moved = temp.path().join("temporarily-away");
    fs::rename(&world, &moved)?;
    db(repo.import(&scan(&root), &[]))?;
    let missing = db(repo.load())?;
    assert_eq!(missing.roots[0].worlds[0].status, WorldStatus::Missing);
    assert_eq!(missing.historical_ticks, "400");
    fs::rename(moved, &world)?;
    stats(&world, "stats", PLAYER, 900)?;
    db(repo.import(&scan(&root), &[]))?;
    let restored = db(repo.load())?;
    assert_eq!(restored.roots[0].worlds[0].status, WorldStatus::Present);
    assert_eq!(restored.historical_ticks, "400");
    Ok(())
}

#[test]
fn incomplete_and_cancelled_scans_never_infer_missing_worlds() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Keep")?;
    stats(&world, "stats", PLAYER, 100)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    db(repo.import(&scan(&root), &[]))?;
    let mut partial = scan(&root);
    partial.roots[0].worlds.clear();
    partial.roots[0].enumeration_complete = false;
    db(repo.import(&partial, &[]))?;
    assert_eq!(
        db(repo.load())?.roots[0].worlds[0].status,
        WorldStatus::Present
    );
    partial.roots[0].enumeration_complete = true;
    partial.cancelled = true;
    db(repo.import(&partial, &[]))?;
    assert_eq!(
        db(repo.load())?.roots[0].worlds[0].status,
        WorldStatus::Present
    );
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row("SELECT count(*) FROM scan_runs", [], |r| r.get::<_, i64>(0))?,
        2
    );
    Ok(())
}

#[test]
fn failed_import_rolls_back_the_entire_scan() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Atomic")?;
    stats(&world, "stats", PLAYER, 100)?;
    stats(&world, "stats", OTHER, 200)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    let mut report = scan(&root);
    report.roots[0].worlds[0].players[1].play_ticks = Some("-1".into());
    assert!(repo.import(&report, &[]).is_err());
    assert!(db(repo.load())?.roots.is_empty());
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row("SELECT count(*) FROM scan_runs", [], |r| r.get::<_, i64>(0))?,
        0
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM stat_snapshots", [], |r| r
            .get::<_, i64>(0))?,
        0
    );
    Ok(())
}

#[test]
fn conflicting_sources_wait_for_resolution_before_creating_a_baseline() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Conflict")?;
    stats(&world, "stats", PLAYER, 100)?;
    stats(&world, "players/stats", PLAYER, 200)?;
    let mut repo = db(Repository::open(&temp.path().join("library.sqlite3")))?;
    db(repo.import(&scan(&root), &[]))?;
    let conflict = db(repo.load())?;
    assert_eq!(conflict.historical_ticks, "0");
    assert!(conflict.roots[0].worlds[0].players[0].conflicting);
    assert_eq!(conflict.roots[0].worlds[0].players[0].source_paths.len(), 2);
    stats(&world, "players/stats", PLAYER, 100)?;
    db(repo.import(&scan(&root), &[]))?;
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    Ok(())
}

#[test]
fn manual_alias_has_priority_and_survives_reopen_and_cache_changes() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Names")?;
    stats(&world, "stats", PLAYER, 100)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    db(repo.set_alias(PLAYER, "SyntheticBuilder"))?;
    let mut report = scan(&root);
    let player = &mut report.roots[0].worlds[0].players[0];
    player.preferred_name = Some("OldCacheName".into());
    player.name_source = Some("usercache".into());
    db(repo.import(&report, &[]))?;
    drop(repo);
    let mut repo = db(Repository::open(&path))?;
    let report = db(repo.load())?;
    let player = &report.roots[0].worlds[0].players[0];
    assert_eq!(player.preferred_name.as_deref(), Some("SyntheticBuilder"));
    assert_eq!(player.name_source.as_deref(), Some("manual"));
    assert!(repo.set_alias("bad-uuid", "Name").is_err());
    assert!(repo.set_alias(PLAYER, " invalid ").is_err());
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row("SELECT count(*) FROM player_aliases", [], |r| r
            .get::<_, i64>(0))?,
        2
    );
    Ok(())
}

#[test]
fn aggregate_preserves_precision_beyond_i64_and_shared_roots_import_once() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Large")?;
    stats(&world, "stats", PLAYER, i64::MAX)?;
    stats(&world, "stats", OTHER, i64::MAX)?;
    let mut repo = db(Repository::open(&temp.path().join("library.sqlite3")))?;
    let report: ScanSummary = GameRootScanner::default()
        .scan(&[root.clone(), root.join(".")], |_| true)
        .into();
    db(repo.import(&report, &[]))?;
    let saved = db(repo.load())?;
    assert_eq!(saved.roots.len(), 1);
    assert_eq!(saved.historical_ticks, "18446744073709551614");
    assert_eq!(
        saved.roots[0].worlds[0].players[0].play_ticks.as_deref(),
        Some("9223372036854775807")
    );
    Ok(())
}

#[cfg(windows)]
#[test]
fn canonical_case_aliases_across_scans_share_persistent_identity() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Case")?;
    stats(&world, "stats", PLAYER, 100)?;
    let mut repo = db(Repository::open(&temp.path().join("library.sqlite3")))?;
    db(repo.import(&scan(&root), &[]))?;
    db(repo.import(
        &scan(&std::path::PathBuf::from(
            root.to_string_lossy().to_uppercase(),
        )),
        &[],
    ))?;
    assert_eq!(db(repo.load())?.roots.len(), 1);
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    Ok(())
}
