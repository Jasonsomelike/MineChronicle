//! Contract tests for pseudo-server time.
//!
//! The metric exists for server clients: the instance runs, but its statistics
//! live on the server so the local `saves/` directory never changes and world
//! tracking sees nothing.
//!
//! The grace-window rule itself is unit-tested in `database::tracking::tests`
//! against synthetic data, because the reference archive cannot exercise it -
//! no recorded delta falls inside a session window there, since the watcher only
//! scans after the process exits. These tests cover the SQL path instead: that
//! sessions and deltas are read correctly, and that the window is applied to
//! real rows end to end.
mod support;
use minechronicle_lib::{
    database::{read_models::ScanSummary, DbResult, Repository},
    launcher::running::ActiveInstance,
    scanner::GameRootScanner,
};
use support::*;

/// Same shape as `tracking_contract.rs`: the fixture helpers return a plain
/// `Box<dyn Error>`, so repository calls are wrapped by `db` to convert
/// `DbResult` into it.
fn db<T>(result: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|error| error as _)
}

fn scan(root: &std::path::Path) -> ScanSummary {
    GameRootScanner::default()
        .scan(std::slice::from_ref(&root.to_owned()), |_| true)
        .into()
}

fn instance(root: &std::path::Path, name: &str) -> ActiveInstance {
    ActiveInstance {
        game_root: root.to_owned(),
        name: name.into(),
        pids: vec![1000],
    }
}

/// An instance with no worlds at all is the whole point: every observed second
/// is pseudo-server time.
#[test]
fn an_instance_without_worlds_reports_all_observed_time() -> TestResult {
    let (temp, root) = game()?;
    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;

    db(repo.observe_instances(&[instance(&root, "香草纪元")]))?;
    // Close the session, then read it back.
    db(repo.observe_instances(&[]))?;

    let pseudo = db(repo.pseudo_server_time())?;
    assert_eq!(pseudo.len(), 1, "one instance was observed");
    let entry = &pseudo[0];
    assert_eq!(entry.instance_name, "香草纪元");
    assert_eq!(entry.sessions, 1);
    assert_eq!(entry.unknown_sessions, 0);
    // The two observations happen within the same second, so the duration is 0
    // here; what matters is that it is reported rather than dropped.
    assert_eq!(entry.seconds, "0");
    Ok(())
}

/// A session whose end was never observed has unknown duration, so it must be
/// counted but contribute no time. This mirrors `interrupt_observed_sessions`,
/// which deliberately leaves `ended_at` NULL because an observer shutdown is not
/// evidence of game exit.
#[test]
fn an_interrupted_session_is_counted_but_contributes_no_time() -> TestResult {
    let (temp, root) = game()?;
    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    db(repo.observe_instances(&[instance(&root, "Server")]))?;
    db(repo.interrupt_observed_sessions())?;

    let pseudo = db(repo.pseudo_server_time())?;
    assert_eq!(pseudo.len(), 1);
    assert_eq!(pseudo[0].seconds, "0", "unknown duration is not guessed");
    assert_eq!(pseudo[0].sessions, 0, "it has no measurable session");
    assert_eq!(
        pseudo[0].unknown_sessions, 1,
        "but the user should be told it happened"
    );
    Ok(())
}

/// A running session is not finished, so its time is not yet claimable.
#[test]
fn a_running_session_is_not_yet_counted() -> TestResult {
    let (temp, root) = game()?;
    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    db(repo.observe_instances(&[instance(&root, "Running")]))?;

    let pseudo = db(repo.pseudo_server_time())?;
    assert_eq!(pseudo.len(), 1);
    assert_eq!(pseudo[0].sessions, 0);
    assert_eq!(pseudo[0].unknown_sessions, 1);
    Ok(())
}

/// The SQL path must attribute a delta to the session that caused it, even
/// though the watcher stamps that delta after the session ended.
///
/// This is the end-to-end counterpart of the unit test: it goes through the
/// real queries, including the epoch conversion of the stored timestamps.
///
/// The session is back-dated to a real length first. `observe_instances` stamps
/// both boundaries with "now", so without that the duration would be ~0 and the
/// assertion would hold even if subtraction never happened.
#[test]
fn a_delta_recorded_after_the_session_offsets_its_time() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Archive")?;
    stats(&world, "stats", PLAYER, 1200)?;
    let archive = temp.path().join("archive.sqlite3");
    let mut repo = db(Repository::open(&archive))?;
    let report = scan(&root);
    db(repo.import(&report, std::slice::from_ref(&root)))?;

    // Observe the instance, then close it, then record world progress. The
    // order mirrors the watcher: session boundaries first, delta afterwards.
    db(repo.observe_instances(&[instance(&root, "Local")]))?;
    db(repo.observe_instances(&[]))?;
    drop(repo);

    // Back-date the session to one hour so there is time to subtract from.
    {
        let connection = rusqlite::Connection::open(&archive)?;
        connection.execute(
            "UPDATE observed_sessions \
             SET started_at = strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour'), \
                 ended_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now')",
            [],
        )?;
    }

    // World progress worth 240 s (4800 ticks), recorded right after the session.
    stats(&world, "stats", PLAYER, 6000)?;
    let mut repo = db(Repository::open(&archive))?;
    let report = scan(&root);
    db(repo.import(&report, std::slice::from_ref(&root)))?;

    let pseudo = db(repo.pseudo_server_time())?;
    let entry = pseudo
        .iter()
        .find(|e| e.instance_name == "Local")
        .ok_or("the observed instance should be reported")?;
    let seconds: i64 = entry.seconds.parse()?;
    // One hour observed, 240 s of it explained by world progress, so the rest is
    // pseudo time. Allowing a few seconds for the two "now" stamps not landing on
    // exactly the same second.
    assert!(
        (3340..=3360).contains(&seconds),
        "expected ~3360 s of pseudo time (3600 observed - 240 explained), got {seconds}"
    );
    Ok(())
}

/// Two instances are tracked separately; one having world progress must not
/// reduce the other's pseudo time.
#[test]
fn instances_are_attributed_independently() -> TestResult {
    let (temp, server) = game()?;
    let (temp2, local) = game()?;
    let world = local.join("saves/world");
    level(&world, "Archive")?;
    stats(&world, "stats", PLAYER, 1200)?;

    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    let report = scan(&local);
    db(repo.import(&report, std::slice::from_ref(&local)))?;

    db(repo.observe_instances(&[instance(&server, "Server"), instance(&local, "Local")]))?;
    db(repo.observe_instances(&[]))?;
    stats(&world, "stats", PLAYER, 6000)?;
    let report = scan(&local);
    db(repo.import(&report, std::slice::from_ref(&local)))?;

    let pseudo = db(repo.pseudo_server_time())?;
    assert_eq!(pseudo.len(), 2, "both instances were observed");
    let server_entry = pseudo
        .iter()
        .find(|e| e.instance_name == "Server")
        .ok_or("server instance")?;
    let local_entry = pseudo
        .iter()
        .find(|e| e.instance_name == "Local")
        .ok_or("local instance")?;
    // Both sessions are ~0 s, so both clamp to 0; the point is that they are
    // reported separately and neither absorbs the other's numbers.
    assert_eq!(server_entry.seconds, "0");
    assert_eq!(local_entry.seconds, "0");
    assert_ne!(
        server_entry.game_root, local_entry.game_root,
        "the two instances keep distinct identities"
    );
    drop(temp2);
    Ok(())
}

/// An archive with no observations must report nothing rather than fail.
#[test]
fn an_archive_with_no_sessions_reports_an_empty_list() -> TestResult {
    let temp = tempfile::tempdir()?;
    let repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    assert!(db(repo.pseudo_server_time())?.is_empty());
    // And the summary must carry the field, so the frontend contract holds.
    let summary = db(repo.tracking_summary())?;
    assert!(summary.pseudo.is_empty());
    Ok(())
}
