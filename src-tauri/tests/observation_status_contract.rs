#![allow(clippy::unwrap_used, clippy::expect_used)]
//! A frozen observation page must not freeze a session's *status*.
//!
//! The snapshot exists so the filtered set and the page stay put between refreshes -
//! that is deliberate and tested in `review_fixes_contract`. But the same snapshot
//! also carried the session rows verbatim, so a session that closed after the
//! snapshot was taken kept rendering as "运行中 / 等待实例关闭" while the summary line
//! above it, which reads the live rows, reported 0 running. The page contradicted
//! itself on one screen.
//!
//! These tests pin the distinction: membership is frozen, status is not.
use minechronicle_lib::database::{
    observation_cache::ObservationCache, sessions::ObservationQuery, Repository,
};
use rusqlite::{params, Connection};

fn archive_with(sessions: usize, running_id: i64) -> (tempfile::TempDir, std::path::PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("archive.sqlite3");
    Repository::open(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    for id in 1..=sessions as i64 {
        let running = id == running_id;
        connection
            .execute(
                "INSERT INTO observed_sessions(id,game_root,instance_name,pids,started_at,\
                 ended_at,status) VALUES(?,'root','Instance','[]','2026-09-18T10:00:00Z',?,?)",
                params![
                    id,
                    if running {
                        None
                    } else {
                        Some("2026-09-18T10:01:00Z")
                    },
                    if running { "running" } else { "closed" }
                ],
            )
            .unwrap();
    }
    (temp, path)
}

/// The reported bug: the row keeps saying "running" after the observer closed it.
#[test]
fn a_frozen_page_reports_a_session_that_closed_after_it_was_taken() {
    let (_temp, path) = archive_with(3, 3);
    let mut cache = ObservationCache::open(&path).unwrap();
    let live = cache.query(1, &ObservationQuery::default()).unwrap();
    assert_eq!(live.running_sessions, 1);
    let snapshot = live.snapshot.clone();

    // The observer closes the session while the page is displayed.
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE observed_sessions SET status='closed',ended_at='2026-09-18T10:05:00Z' \
             WHERE id=3",
            [],
        )
        .unwrap();

    let frozen = cache
        .query(
            1,
            &ObservationQuery {
                snapshot,
                ..Default::default()
            },
        )
        .unwrap();

    // The summary already reads the live rows, so it must not claim a running session.
    assert_eq!(
        frozen.running_sessions, 0,
        "the summary must not report a session that has closed"
    );
    // The session itself must agree with the summary. This is the assertion that
    // failed before the fix: the row still said "running".
    let closed = frozen
        .sessions
        .iter()
        .find(|s| s.id == 3)
        .expect("the session is still part of the frozen page");
    assert_eq!(
        closed.status, "closed",
        "a frozen page must not show a closed session as running"
    );
    assert!(
        closed.ended_at.is_some(),
        "the end time must appear once it is known"
    );
}

/// The purpose of the snapshot is preserved: the set of sessions does not change.
#[test]
fn a_frozen_page_keeps_its_membership() {
    let (_temp, path) = archive_with(3, 3);
    let mut cache = ObservationCache::open(&path).unwrap();
    let live = cache.query(1, &ObservationQuery::default()).unwrap();
    let snapshot = live.snapshot.clone();
    let before: Vec<i64> = live.sessions.iter().map(|s| s.id).collect();

    // A brand new session appears; a frozen page must not adopt it.
    Connection::open(&path)
        .unwrap()
        .execute(
            "INSERT INTO observed_sessions(id,game_root,instance_name,pids,started_at,\
             ended_at,status) VALUES(9,'root','Instance','[]','2026-09-18T11:00:00Z',\
             '2026-09-18T11:01:00Z','closed')",
            [],
        )
        .unwrap();

    let frozen = cache
        .query(
            1,
            &ObservationQuery {
                snapshot,
                ..Default::default()
            },
        )
        .unwrap();
    let after: Vec<i64> = frozen.sessions.iter().map(|s| s.id).collect();
    assert_eq!(
        after, before,
        "a frozen page must keep the same sessions, ignoring new ones"
    );
    // And it still reports that the history moved, so the UI can offer a refresh.
    assert!(frozen.new_records >= 1);
}

/// An explicit refresh adopts everything, including the new status.
#[test]
fn a_refreshed_page_adopts_the_new_status() {
    let (_temp, path) = archive_with(3, 3);
    let mut cache = ObservationCache::open(&path).unwrap();
    let live = cache.query(1, &ObservationQuery::default()).unwrap();
    assert_eq!(live.running_sessions, 1);

    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE observed_sessions SET status='closed',ended_at='2026-09-18T10:05:00Z' \
             WHERE id=3",
            [],
        )
        .unwrap();

    // No snapshot token: this is what the refresh button sends.
    let refreshed = cache.query(1, &ObservationQuery::default()).unwrap();
    assert_eq!(refreshed.running_sessions, 0);
    assert_eq!(refreshed.sessions[0].status, "closed");
    assert!(refreshed.sessions[0].ended_at.is_some());
}
