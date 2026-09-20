mod support;
use minechronicle_lib::{
    database::{read_models::ScanSummary, Repository},
    launcher::running::ActiveInstance,
    scanner::GameRootScanner,
};
use support::*;

#[test]
fn new_local_world_is_unknown_not_an_hour_of_server_time() -> TestResult {
    let (temp, root) = game()?;
    let archive = temp.path().join("archive.sqlite3");
    let mut repo =
        Repository::open(&archive).map_err(|error| error as Box<dyn std::error::Error>)?;
    repo.observe_instances(&[ActiveInstance {
        game_root: root.clone(),
        name: "Local".into(),
        pids: vec![1],
    }])
    .map_err(|error| error as Box<dyn std::error::Error>)?;
    let world = root.join("saves/new_world");
    level(&world, "New local world")?;
    stats(&world, "stats", PLAYER, 72000)?;
    repo.observe_instances(&[])
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    let conn = rusqlite::Connection::open(&archive)?;
    conn.execute("UPDATE observed_sessions SET started_at=strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour'), ended_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')", [])?;
    let report: ScanSummary = GameRootScanner::default()
        .scan(std::slice::from_ref(&root), |_| true)
        .into();
    repo.import(&report, std::slice::from_ref(&root))
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    let page = repo
        .observed_sessions_page(1)
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    assert_eq!(page.total_seconds, "0");
    assert_eq!(page.baseline_sessions, 1);
    assert!(page.sessions[0].missing_baseline);
    assert_eq!(
        repo.pseudo_server_time()
            .map_err(|error| error as Box<dyn std::error::Error>)?[0]
            .baseline_sessions,
        1
    );

    // Additional progress cannot retrospectively establish a baseline at the
    // beginning of the first run. Nor should the uncertainty poison later runs.
    stats(&world, "stats", PLAYER, 73200)?;
    let report: ScanSummary = GameRootScanner::default()
        .scan(std::slice::from_ref(&root), |_| true)
        .into();
    repo.import(&report, std::slice::from_ref(&root))
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    assert!(
        repo.observed_sessions_page(1)
            .map_err(|error| error as Box<dyn std::error::Error>)?
            .sessions[0]
            .missing_baseline
    );
    conn.execute(
        "UPDATE stat_snapshots SET observed_at='2026-01-01T00:30:00.000Z'",
        [],
    )?;
    conn.execute(
        "UPDATE tracked_deltas SET observed_at='2026-01-01T00:40:00.000Z'",
        [],
    )?;
    conn.execute("UPDATE observed_sessions SET started_at='2026-01-01T00:00:00Z',ended_at='2026-01-01T01:00:00Z'", [])?;
    conn.execute("INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) SELECT game_root,instance_name,'[]','2026-01-02T00:00:00Z','2026-01-02T00:01:00Z','closed' FROM observed_sessions LIMIT 1", [])?;
    let page = repo
        .observed_sessions_page(1)
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    assert_eq!(page.total_seconds, "60");
    assert!(!page.sessions[0].missing_baseline);
    assert!(page.sessions[1].missing_baseline);
    Ok(())
}

#[test]
fn all_history_is_reachable_and_totals_do_not_change_with_page() -> TestResult {
    let (temp, root) = game()?;
    let archive = temp.path().join("archive.sqlite3");
    let repo = Repository::open(&archive).map_err(|error| error as Box<dyn std::error::Error>)?;
    let empty = repo
        .observed_sessions_page(99)
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    assert_eq!((empty.page, empty.total), (1, 0));
    let conn = rusqlite::Connection::open(&archive)?;
    for _ in 0..51 {
        conn.execute("INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) VALUES(?,'Server','[]','2026-09-01T00:00:00Z','2026-09-01T00:01:00Z','closed')", [root.to_string_lossy().as_ref()])?;
    }
    let mut ids = std::collections::HashSet::new();
    for (page_number, count) in [(1, 20), (2, 20), (3, 11)] {
        let page = repo
            .observed_sessions_page(page_number)
            .map_err(|error| error as Box<dyn std::error::Error>)?;
        assert_eq!(page.total, 51);
        assert_eq!(page.total_seconds, "3060");
        assert_eq!(page.sessions.len(), count);
        for row in page.sessions {
            assert!(ids.insert(row.id));
        }
    }
    assert_eq!(ids.len(), 51);
    assert_eq!(
        repo.observed_sessions_page(i64::MAX)
            .map_err(|error| error as Box<dyn std::error::Error>)?
            .page,
        3
    );
    assert_eq!(
        repo.observed_sessions_page(i64::MIN)
            .map_err(|error| error as Box<dyn std::error::Error>)?
            .page,
        1
    );
    assert_eq!(
        repo.observed_sessions_page(0)
            .map_err(|error| error as Box<dyn std::error::Error>)?
            .page,
        1
    );
    conn.execute(
        "UPDATE observed_sessions SET ended_at=NULL,status='interrupted' WHERE id=1",
        [],
    )?;
    conn.execute(
        "UPDATE observed_sessions SET ended_at=NULL,status='running' WHERE id=2",
        [],
    )?;
    let page = repo
        .observed_sessions_page(1)
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    assert_eq!(page.total_seconds, "2940");
    assert_eq!(page.unknown_sessions, 2);
    assert_eq!(page.running_sessions, 1);
    let summary = repo
        .tracking_summary()
        .map_err(|error| error as Box<dyn std::error::Error>)?;
    assert_eq!(summary.pseudo[0].seconds, page.total_seconds);
    Ok(())
}
