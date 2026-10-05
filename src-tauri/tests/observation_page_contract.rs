mod support;
use minechronicle_lib::{
    database::{
        read_models::ScanSummary,
        sessions::{ObservationQuery, ObservedSessionsPage},
        DbResult, Repository,
    },
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
    // The import stamps the wall clock, and a runner whose clock steps mid-run
    // (GitHub runners resync NTP aggressively) can push that first observation
    // past the 900-second grace, which turns the session into a full hour of
    // pseudo server time. Pin every stamp to fixed times: an observation five
    // seconds after the session's end still sits inside the grace, so the
    // baseline rule the test exercises survives without depending on the clock.
    conn.execute(
        "UPDATE stat_snapshots SET observed_at='2026-01-01T01:00:05.000Z'",
        [],
    )?;
    conn.execute(
        "UPDATE observed_sessions SET started_at='2026-01-01T00:00:00Z', ended_at='2026-01-01T01:00:00Z'",
        [],
    )?;
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

/// Insert one closed session for `game_root`, oldest first.
fn insert_session(conn: &rusqlite::Connection, game_root: &str, started_at: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) \
         VALUES(?,'Instance','[]',?,?,'closed')",
        rusqlite::params![game_root, started_at, started_at],
    )?;
    Ok(())
}

/// `(game_root, page, page_count, rows on page)` for one group.
///
/// Indexed rather than searched: `group_sessions` preserves first-appearance order,
/// so the order the rows were inserted decides the group order. That is a real
/// property of the reply, and pinning it here means a reordering shows up as a
/// failure instead of being papered over by a lookup.
fn group_at(page: &ObservedSessionsPage, index: usize) -> (String, i64, i64, usize) {
    let group = &page.groups[index];
    (
        group.game_root.clone(),
        group.page,
        group.page_count,
        group.sessions.len(),
    )
}

/// One instance's page must not move another's.
///
/// This is the contract behind 「翻页应针对具体实例而不是针对全部」. Before
/// `group_page`, one pager addressed every record at once: an instance with 25
/// records and an instance with 1 shared a single cursor, so the small one
/// vanished from its own page the moment the large one advanced.
///
/// Returns `DbResult` rather than `TestResult` so the boxed `Send + Sync` error
/// the repository produces can be propagated with `?`.
#[test]
fn each_instance_pages_its_own_records() -> DbResult<()> {
    let (temp, root) = game()?;
    let archive = temp.path().join("archive.sqlite3");
    let repo = Repository::open(&archive)?;
    let conn = rusqlite::Connection::open(&archive)?;
    let big = root.to_string_lossy().to_string();
    let small = format!("{big}-other");
    for minute in 0..25 {
        insert_session(&conn, &big, &format!("2026-09-01T00:{minute:02}:00Z"))?;
    }
    insert_session(&conn, &small, "2026-09-02T00:00:00Z")?;

    let query = |group_page: Option<i64>| -> DbResult<ObservedSessionsPage> {
        repo.observed_sessions_query(
            1,
            &ObservationQuery {
                group_page,
                ..Default::default()
            },
        )
    };
    // Groups follow first appearance in the filtered set, and the filtered set is
    // id-descending, so the instance with the newest record comes first. `small`
    // was inserted last and so holds the highest id.
    let small_group = 0;
    let big_group = 1;

    // Page 1 of both: the large instance is capped at the page size, the small
    // one is complete.
    let first = query(None)?;
    assert_eq!(first.groups.len(), 2, "one group per instance");
    assert_eq!(group_at(&first, small_group), (small.clone(), 1, 1, 1));
    assert_eq!(group_at(&first, big_group), (big.clone(), 1, 2, 20));

    // Page 2 of the large instance leaves the small one on page 1.
    let second = query(Some(2))?;
    assert_eq!(group_at(&second, small_group), (small.clone(), 1, 1, 1));
    assert_eq!(group_at(&second, big_group), (big.clone(), 2, 2, 5));

    // A page beyond an instance's own last page clamps instead of emptying it,
    // so a pager never renders a page that does not exist.
    let clamped = query(Some(9))?;
    assert_eq!(group_at(&clamped, small_group), (small.clone(), 1, 1, 1));
    assert_eq!(group_at(&clamped, big_group), (big.clone(), 2, 2, 5));

    // The two instances' pages never share rows.
    let ids = |page: &ObservedSessionsPage, index: usize| {
        page.groups[index]
            .sessions
            .iter()
            .map(|session| session.id)
            .collect::<std::collections::HashSet<_>>()
    };
    assert!(ids(&second, big_group).is_disjoint(&ids(&second, small_group)));
    Ok(())
}
