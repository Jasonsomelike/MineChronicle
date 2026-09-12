mod support;
use minechronicle_lib::{
    commands::ScanControl,
    database::{read_models::ScanSummary, DbResult, Repository},
    scanner::{stable_stats::read_stats, GameRootScanner, ScanIssueKind},
    tracker::{ledger::normalized_hash, watcher::Tracker},
};
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};
use support::*;
fn db<T>(r: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    r.map_err(|e| e as _)
}
fn import(repo: &mut Repository, root: &Path) -> TestResult {
    let report: ScanSummary = GameRootScanner::default()
        .scan(&[root.to_owned()], |_| true)
        .into();
    db(repo.import(&report, &[root.to_owned()]))?;
    Ok(())
}
fn total(repo: &Repository) -> Result<String, Box<dyn std::error::Error>> {
    Ok(db(repo.tracking_summary())?
        .players
        .first()
        .map(|p| p.ticks.clone())
        .unwrap_or_else(|| "0".into()))
}
#[test]
fn positive_deltas_survive_rollback_restarts_and_missing_data() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Archive")?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    for ticks in [100, 100, 200, 180, 183] {
        stats(&world, "stats", PLAYER, ticks)?;
        import(&mut repo, &root)?;
    }
    let summary = db(repo.tracking_summary())?;
    assert_eq!(total(&repo)?, "103");
    assert_eq!(summary.observations, 4);
    assert_eq!(summary.rollback_count, 1);
    assert_eq!(summary.rollbacks[0].old_ticks, "200");
    assert_eq!(summary.rollbacks[0].new_ticks, "180");
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    fs::write(world.join(format!("stats/{PLAYER}.json")), b"")?;
    import(&mut repo, &root)?;
    let report = db(repo.load())?;
    assert_eq!(report.historical_ticks, "100");
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::EmptyStats));
    assert!(report.roots[0].worlds[0].players[0].play_ticks.is_none());
    assert_eq!(total(&repo)?, "103");
    drop(repo);
    let mut repo = db(Repository::open(&path))?;
    stats(&world, "stats", PLAYER, 210)?;
    import(&mut repo, &root)?;
    assert_eq!(total(&repo)?, "130");
    fs::remove_dir_all(&world)?;
    import(&mut repo, &root)?;
    assert_eq!(total(&repo)?, "130");
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM stat_snapshots WHERE kind='initial_import'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        1
    );
    Ok(())
}
#[test]
fn normalized_hash_ignores_recursive_key_order_but_retains_unknown_data() -> TestResult {
    assert_eq!(
        db(normalized_hash(r#"{"b":[{"y":2,"x":1}],"a":4}"#))?,
        db(normalized_hash(r#"{"a":4,"b":[{"x":1,"y":2}]}"#))?
    );
    assert_ne!(
        db(normalized_hash(r#"{"unknown":1}"#))?,
        db(normalized_hash(r#"{"unknown":2}"#))?
    );
    assert!(normalized_hash("{").is_err());
    Ok(())
}

#[test]
fn period_totals_use_observation_dates_and_wide_integer_sums() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Periods")?;
    stats(&world, "stats", PLAYER, 0)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    import(&mut repo, &root)?;
    let conn = rusqlite::Connection::open(path)?;
    conn.execute("INSERT INTO tracked_deltas(world_id,player_uuid,delta_ticks,observed_at) SELECT id,?,100,'2000-01-01T00:00:00Z' FROM worlds",[PLAYER])?;
    for _ in 0..2 {
        conn.execute("INSERT INTO tracked_deltas(world_id,player_uuid,delta_ticks,observed_at) SELECT id,?,9223372036854775807,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM worlds",[PLAYER])?;
    }
    let result = db(repo.tracking_summary())?;
    assert_eq!(result.players[0].ticks, "18446744073709551714");
    assert_eq!(result.players[0].week_ticks, "18446744073709551614");
    assert_eq!(result.players[0].month_ticks, "18446744073709551614");
    Ok(())
}

#[test]
fn changed_non_time_counter_creates_snapshot_without_delta() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Counters")?;
    stats(&world, "stats", PLAYER, 100)?;
    let mut repo = db(Repository::open(&temp.path().join("library.sqlite3")))?;
    import(&mut repo, &root)?;
    let path = world.join(format!("stats/{PLAYER}.json"));
    fs::write(
        &path,
        r#"{"stats":{"minecraft:custom":{"minecraft:jump":2,"minecraft:play_time":100}}}"#,
    )?;
    import(&mut repo, &root)?;
    fs::write(
        &path,
        r#"{"stats":{"minecraft:custom":{"minecraft:play_time":100,"minecraft:jump":2}}}"#,
    )?;
    import(&mut repo, &root)?;
    assert_eq!(db(repo.tracking_summary())?.observations, 2);
    assert_eq!(total(&repo)?, "0");
    Ok(())
}
#[test]
fn stable_reads_distinguish_empty_from_invalid_and_retry_transient_writes() -> TestResult {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("stats.json");
    fs::write(&path, " \r\n\t")?;
    assert_eq!(
        read_stats(&path).err().map(|e| e.0),
        Some(ScanIssueKind::EmptyStats)
    );
    fs::write(&path, "{")?;
    assert_eq!(
        read_stats(&path).err().map(|e| e.0),
        Some(ScanIssueKind::CorruptedStats)
    );
    let next = path.clone();
    let writer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(140));
        fs::write(
            next,
            r#"{"stats":{"minecraft:custom":{"minecraft:play_time":364}}}"#,
        )
    });
    assert!(read_stats(&path).is_ok());
    writer.join().map_err(|_| "writer failed")??;
    Ok(())
}
fn wait_for(mut ready: impl FnMut() -> bool) -> TestResult {
    let start = Instant::now();
    while !ready() {
        if start.elapsed() > Duration::from_secs(12) {
            return Err("watcher timeout".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}
#[test]
fn native_watcher_debounces_tracks_new_worlds_and_resumes() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Live")?;
    stats(&world, "stats", PLAYER, 100)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    import(&mut repo, &root)?;
    let active_root = fs::canonicalize(&root)?;
    let tracker = Tracker::start_with_activity(path.clone(), ScanControl::default(), move || {
        Ok(vec![minechronicle_lib::launcher::running::ActiveInstance {
            game_root: active_root.clone(),
            name: "Live".into(),
            pids: vec![1],
        }])
    });
    wait_for(|| tracker.status().revision > 0 && tracker.status().watched_directories >= 4)?;
    stats(&world, "stats", PLAYER, 200)?;
    std::thread::sleep(Duration::from_millis(450));
    assert_eq!(total(&repo)?, "0");
    wait_for(|| total(&repo).is_ok_and(|v| v == "100"))?;
    stats(&world, "stats", PLAYER, 180)?;
    wait_for(|| repo.tracking_summary().is_ok_and(|s| s.rollback_count == 1))?;
    stats(&world, "stats", PLAYER, 183)?;
    wait_for(|| total(&repo).is_ok_and(|v| v == "103"))?;
    let newer = root.join("saves/new");
    level(&newer, "New")?;
    stats(&newer, "players/stats", OTHER, 50)?;
    wait_for(|| tracker.status().watched_directories >= 7)?;
    stats(&newer, "players/stats", OTHER, 70)?;
    wait_for(|| {
        repo.tracking_summary()
            .is_ok_and(|s| s.players.iter().any(|p| p.uuid == OTHER && p.ticks == "20"))
    })?;
    db(tracker.set_enabled(false))?;
    wait_for(|| !tracker.status().running && tracker.status().watched_directories == 0)?;
    stats(&world, "stats", PLAYER, 203)?;
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(total(&repo)?, "103");
    db(tracker.set_enabled(true))?;
    wait_for(|| total(&repo).is_ok_and(|v| v == "123"))?;
    db(tracker.set_enabled(false))?;
    drop(tracker);
    let reopened = Tracker::start(path, ScanControl::default());
    assert!(!reopened.status().enabled);
    drop(reopened);
    Ok(())
}
#[test]
fn schema_two_upgrade_establishes_observation_without_counting_unobserved_gap() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Old")?;
    stats(&world, "stats", PLAYER, 100)?;
    let path = temp.path().join("library.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    import(&mut repo, &root)?;
    drop(repo);
    let conn = rusqlite::Connection::open(&path)?;
    conn.execute_batch("DROP TABLE observed_sessions; DROP TABLE clone_evidence; DROP TABLE lineage_details; DROP TABLE health_reviews; DROP TABLE analysis_status; DROP TABLE tracking_cursors; DROP TABLE stat_rollbacks; DROP INDEX one_delta_per_snapshot; DROP INDEX deltas_by_time; ALTER TABLE tracked_deltas DROP COLUMN snapshot_id; ALTER TABLE stat_snapshots DROP COLUMN normalized_hash; DELETE FROM stat_snapshots WHERE kind='observation'; PRAGMA user_version=2;")?;
    drop(conn);
    let mut repo = db(Repository::open(&path))?;
    stats(&world, "stats", PLAYER, 200)?;
    import(&mut repo, &root)?;
    assert_eq!(total(&repo)?, "0");
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    stats(&world, "stats", PLAYER, 220)?;
    import(&mut repo, &root)?;
    assert_eq!(total(&repo)?, "20");
    Ok(())
}
