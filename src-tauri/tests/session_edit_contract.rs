//! Contract tests for manually filling in an unobserved session end.
//!
//! When the observer stops before the game does, `interrupted` rows carry no
//! end time and contribute to no total. The user is the only remaining source
//! for that value, so these tests pin down what may be entered and what the
//! database does with it.
//!
//! Rows are inserted through a separate `rusqlite::Connection`, as
//! `observation_page_contract.rs` does, so the timestamps are deterministic
//! instead of "now".
//!
//! Panics in fixtures are intentional: a test that cannot build its input should
//! stop there rather than report a misleading pass.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use minechronicle_lib::database::Repository;
use std::path::PathBuf;

/// Wider than the shared test alias because `Repository` and the helpers below
/// return `Box<dyn Error + Send + Sync>`, and a trait object cannot be narrowed
/// back to `Box<dyn Error>`.
type TestResult = std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>;

struct Archive {
    _temp: tempfile::TempDir,
    path: PathBuf,
}

fn open() -> Archive {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("archive.sqlite3");
    Repository::open(&path).unwrap();
    Archive { _temp: temp, path }
}

impl Archive {
    fn repo(&self) -> Result<Repository, Box<dyn std::error::Error + Send + Sync>> {
        Repository::open(&self.path)
    }

    /// A connection that stays open, for observing `PRAGMA data_version`.
    ///
    /// `data_version` is a counter for *this* connection, incremented when
    /// another connection commits. Opening a fresh connection for each read
    /// would always report 1 and could never detect a write.
    fn watcher(&self) -> Result<rusqlite::Connection, Box<dyn std::error::Error + Send + Sync>> {
        Ok(rusqlite::Connection::open(&self.path)?)
    }

    fn insert(
        &self,
        root: &str,
        started: &str,
        ended: Option<&str>,
        status: &str,
    ) -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        let connection = rusqlite::Connection::open(&self.path)?;
        connection.execute(
            "INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,ended_at,status) \
             VALUES(?,'Instance','[]',?,?,?)",
            rusqlite::params![root, started, ended, status],
        )?;
        Ok(connection.last_insert_rowid())
    }

    fn field(
        &self,
        id: i64,
        column: &str,
    ) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
        let connection = rusqlite::Connection::open(&self.path)?;
        Ok(connection.query_row(
            &format!("SELECT {column} FROM observed_sessions WHERE id=?"),
            [id],
            |r| r.get(0),
        )?)
    }
}

/// The whole point: an unmeasured session gains a duration and enters the total.
#[test]
fn admitting_an_end_makes_an_interrupted_session_count() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;

    let before = repo.pseudo_server_time()?;
    assert_eq!(before[0].seconds, "0", "no end means no measurable time");
    assert_eq!(before[0].unknown_sessions, 1);

    repo.set_session_end(id, "2026-09-18T14:22:20Z")?;

    let after = repo.pseudo_server_time()?;
    assert_eq!(after[0].seconds, "1800", "half an hour becomes measurable");
    assert_eq!(after[0].unknown_sessions, 0);
    Ok(())
}

/// `ended_at` and `status` are constrained together by 006_sessions.sql, so a
/// write touching only one is rejected by the database. This asserts the
/// implementation still changes both at once: it is the regression guard for the
/// most likely way to break this feature.
#[test]
fn the_end_time_and_status_change_together() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;
    repo.set_session_end(id, "2026-09-18T14:22:20Z")?;
    assert_eq!(archive.field(id, "status")?.as_deref(), Some("closed"));
    assert_eq!(
        archive.field(id, "ended_at")?.as_deref(),
        Some("2026-09-18T14:22:20Z")
    );

    // The database's own rule, checked on a row that is still interrupted: that
    // is the state this feature starts from, and the only one where setting
    // `ended_at` alone violates the constraint.
    let untouched = archive.insert("other", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let connection = rusqlite::Connection::open(&archive.path)?;
    let violated = connection.execute(
        "UPDATE observed_sessions SET ended_at='2026-09-18T15:00:00Z' WHERE id=?",
        [untouched],
    );
    assert!(
        violated.is_err(),
        "the CHECK must still reject an end time without a status"
    );
    let flipped = connection.execute(
        "UPDATE observed_sessions SET status='closed' WHERE id=?",
        [untouched],
    );
    assert!(
        flipped.is_err(),
        "and a status without an end time, from the other side"
    );
    Ok(())
}

#[test]
fn a_manual_end_is_recorded_as_manual_and_stamped() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    assert_eq!(archive.field(id, "ended_source")?, None);
    archive
        .repo()?
        .set_session_end(id, "2026-09-18T14:22:20Z")?;
    assert_eq!(
        archive.field(id, "ended_source")?.as_deref(),
        Some("manual"),
        "a typed value must be distinguishable from an observed one"
    );
    let edited = archive.field(id, "edited_at")?.expect("edit is stamped");
    assert_eq!(edited.len(), 20, "UTC timestamps keep second precision");
    Ok(())
}

/// The next session of the SAME instance caps the end time. Without this, two
/// rows would cover the same wall-clock minutes and every total would double
/// count them.
#[test]
fn the_next_session_of_the_same_instance_caps_the_end() -> TestResult {
    let archive = open();
    let first = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    archive.insert(
        "root",
        "2026-09-18T14:25:23Z",
        Some("2026-09-18T15:00:00Z"),
        "closed",
    )?;
    let repo = archive.repo()?;

    let bounds = repo.manual_end_bounds(first)?;
    assert_eq!(
        bounds.max_ended_at.as_deref(),
        Some("2026-09-18T14:25:23Z"),
        "the cap is the next start"
    );

    // Exactly the next start is allowed: the intervals touch without overlapping.
    repo.set_session_end(first, "2026-09-18T14:25:23Z")?;

    // One second later is not. This must be the SAME instance as the session at
    // 14:25:23, or there is nothing to overlap with.
    let later = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let error = repo
        .set_session_end(later, "2026-09-18T14:25:24Z")
        .expect_err("a later end would overlap the next session");
    assert!(
        error.to_string().contains("14:25:23"),
        "the message must name the limit, got: {error}"
    );
    Ok(())
}

/// A later session of a DIFFERENT instance is unrelated and must not cap this one.
#[test]
fn another_instances_session_does_not_cap_the_end() -> TestResult {
    let archive = open();
    let mine = archive.insert("mine", "2026-09-18T13:00:00Z", None, "interrupted")?;
    archive.insert(
        "theirs",
        "2026-09-18T13:05:00Z",
        Some("2026-09-18T13:30:00Z"),
        "closed",
    )?;
    let repo = archive.repo()?;
    assert_eq!(
        repo.manual_end_bounds(mine)?.max_ended_at,
        None,
        "only the same instance constrains the end"
    );
    repo.set_session_end(mine, "2026-09-18T14:00:00Z")?;
    Ok(())
}

#[test]
fn an_end_at_or_before_the_start_is_refused_and_changes_nothing() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;
    for value in ["2026-09-18T13:52:20Z", "2026-09-18T13:00:00Z"] {
        assert!(
            repo.set_session_end(id, value).is_err(),
            "{value} is not after the start"
        );
    }
    assert_eq!(archive.field(id, "ended_at")?, None, "the row is untouched");
    assert_eq!(archive.field(id, "status")?.as_deref(), Some("interrupted"));
    Ok(())
}

#[test]
fn a_future_end_is_refused() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;
    assert!(repo.set_session_end(id, "2099-01-01T00:00:00Z").is_err());
    assert_eq!(archive.field(id, "ended_at")?, None);
    Ok(())
}

/// A live session is owned by the periodic observer. Handing it a manual end
/// would be contradicted on the next poll.
#[test]
fn a_running_session_cannot_be_given_an_end() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "running")?;
    let repo = archive.repo()?;
    let error = repo
        .set_session_end(id, "2026-09-18T13:52:30Z")
        .expect_err("a running session has no end to set");
    assert!(error.to_string().contains("正在运行"), "got: {error}");
    assert_eq!(archive.field(id, "status")?.as_deref(), Some("running"));
    Ok(())
}

/// An observed end must be marked as manual once overwritten, because the
/// original value is gone.
#[test]
fn an_observed_end_can_be_corrected_and_is_then_marked_manual() -> TestResult {
    let archive = open();
    let id = archive.insert(
        "root",
        "2026-09-18T13:00:00Z",
        Some("2026-09-18T13:10:00Z"),
        "closed",
    )?;
    assert_eq!(archive.field(id, "ended_source")?, None);
    archive
        .repo()?
        .set_session_end(id, "2026-09-18T13:20:00Z")?;
    assert_eq!(
        archive.field(id, "ended_at")?.as_deref(),
        Some("2026-09-18T13:20:00Z")
    );
    assert_eq!(
        archive.field(id, "ended_source")?.as_deref(),
        Some("manual")
    );
    Ok(())
}

#[test]
fn undoing_a_manual_end_restores_the_interrupted_state() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;
    repo.set_session_end(id, "2026-09-18T14:22:20Z")?;
    assert_eq!(repo.pseudo_server_time()?[0].seconds, "1800");

    repo.clear_session_end(id)?;

    assert_eq!(archive.field(id, "ended_at")?, None);
    assert_eq!(archive.field(id, "status")?.as_deref(), Some("interrupted"));
    assert_eq!(archive.field(id, "ended_source")?, None);
    assert_eq!(archive.field(id, "edited_at")?, None);
    let totals = archive.repo()?.pseudo_server_time()?;
    assert_eq!(totals[0].seconds, "0", "the total falls back");
    assert_eq!(totals[0].unknown_sessions, 1);
    Ok(())
}

/// Undo is only for typed values. Reverting an observed end would silently
/// relabel a recorded fact as never having happened.
#[test]
fn undoing_an_observed_end_is_refused() -> TestResult {
    let archive = open();
    let id = archive.insert(
        "root",
        "2026-09-18T13:00:00Z",
        Some("2026-09-18T13:10:00Z"),
        "closed",
    )?;
    assert!(archive.repo()?.clear_session_end(id).is_err());
    assert_eq!(
        archive.field(id, "ended_at")?.as_deref(),
        Some("2026-09-18T13:10:00Z"),
        "the observed value survives"
    );
    Ok(())
}

#[test]
fn an_unknown_session_is_refused() -> TestResult {
    let archive = open();
    let repo = archive.repo()?;
    assert!(repo.manual_end_bounds(999).is_err());
    assert!(repo.set_session_end(999, "2026-09-18T14:22:20Z").is_err());
    assert!(repo.clear_session_end(999).is_err());
    Ok(())
}

#[test]
fn a_malformed_end_is_refused_without_touching_the_row() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;
    for value in [
        "",
        "2026-09-18",
        "2026-09-18T14:22:20",
        "2026-09-18T14:22:20.000Z",
        "2026-02-30T00:00:00Z",
        "2026-09-18T14:22:20+08:00",
    ] {
        assert!(
            repo.set_session_end(id, value).is_err(),
            "should refuse {value:?}"
        );
    }
    assert_eq!(archive.field(id, "ended_at")?, None);
    Ok(())
}

/// The page the UI reads must carry the provenance, or a typed value would be
/// displayed exactly like an observed one.
#[test]
fn the_session_page_reports_provenance() -> TestResult {
    let archive = open();
    let observed = archive.insert(
        "a",
        "2026-09-18T13:00:00Z",
        Some("2026-09-18T13:10:00Z"),
        "closed",
    )?;
    let typed = archive.insert("b", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let repo = archive.repo()?;
    repo.set_session_end(typed, "2026-09-18T14:22:20Z")?;

    let page = archive.repo()?.observed_sessions_page(1)?;
    let find = |id: i64| {
        page.sessions
            .iter()
            .find(|s| s.id == id)
            .expect("session is on the page")
    };
    assert_eq!(
        find(observed).ended_source,
        None,
        "observed ends stay unmarked"
    );
    assert_eq!(find(typed).ended_source.as_deref(), Some("manual"));
    assert!(find(typed).edited_at.is_some());
    Ok(())
}

/// A manual edit must be visible to the observation cache, which decides whether
/// to rebuild its snapshot from `PRAGMA data_version`. If this regressed, the
/// table would keep showing the figure from before the edit.
///
/// The watcher connection is held open across the write: `data_version` is a
/// per-connection counter that only advances when *another* connection commits.
#[test]
fn a_manual_edit_changes_the_data_version_the_cache_watches() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    let watcher = archive.watcher()?;
    let read = |c: &rusqlite::Connection| -> rusqlite::Result<i64> {
        c.query_row("PRAGMA data_version", [], |r| r.get(0))
    };
    let before = read(&watcher)?;

    archive
        .repo()?
        .set_session_end(id, "2026-09-18T14:22:20Z")?;

    let after = read(&watcher)?;
    assert_ne!(
        before, after,
        "the write must be visible to another connection, or the page goes stale"
    );
    Ok(())
}

/// Sessions survive a reopen, and the migrated columns are readable afterwards.
#[test]
fn the_edit_persists_across_reopen() -> TestResult {
    let archive = open();
    let id = archive.insert("root", "2026-09-18T13:52:20Z", None, "interrupted")?;
    archive
        .repo()?
        .set_session_end(id, "2026-09-18T14:22:20Z")?;
    drop(archive.repo()?);

    let repo = archive.repo()?;
    let session = repo
        .observed_sessions()?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("session survives reopening")?;
    assert_eq!(session.ended_at.as_deref(), Some("2026-09-18T14:22:20Z"));
    assert_eq!(session.ended_source.as_deref(), Some("manual"));
    Ok(())
}
