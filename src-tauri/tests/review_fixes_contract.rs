#![allow(clippy::unwrap_used, clippy::expect_used)]
use minechronicle_lib::database::{
    backup::BackupStore, observation_cache::ObservationCache, sessions::ObservationQuery,
    Repository,
};
use rusqlite::Connection;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn directory_failure_is_visible_and_keeps_existing_backups() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("archive.sqlite3");
    Repository::open(&database).unwrap();
    let store = BackupStore {
        app_data: temp.path().into(),
        database,
    };
    let backup = store.create("manual").unwrap().unwrap();
    let directory = temp.path().join("unavailable");
    store.configure(true, 7, directory.clone()).unwrap();
    std::fs::remove_dir(&directory).unwrap();
    std::fs::write(&directory, b"not a directory").unwrap();
    assert!(store.create_for_day("auto", "2026-09-19").is_err());
    let policy = store.policy().unwrap();
    assert!(policy.error.contains("备份目录"));
    assert!(!policy.last_attempt.is_empty());
    assert!(backup.path.exists());
}

#[test]
fn restore_rejects_changed_preview_and_cancel_preserves_archive() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("archive.sqlite3");
    Repository::open(&database)
        .unwrap()
        .set_setting("self_player_identity", "Original")
        .unwrap();
    let store = BackupStore {
        app_data: temp.path().into(),
        database,
    };
    let backup = store.create("manual").unwrap().unwrap();
    Connection::open(&backup.path)
        .unwrap()
        .execute(
            "UPDATE settings SET value='Other' WHERE key='self_player_identity'",
            [],
        )
        .unwrap();
    assert!(store
        .schedule_verified_restore(&backup.path, &backup.digest)
        .unwrap_err()
        .to_string()
        .contains("已变化"));
    assert!(store.pending_restore().unwrap().is_none());
    let changed = minechronicle_lib::database::backup::inspect(&backup.path).unwrap();
    store
        .schedule_verified_restore(&backup.path, &changed.digest)
        .unwrap();
    assert_eq!(
        store.pending_restore().unwrap().unwrap().source,
        backup.path
    );
    store.cancel_restore().unwrap();
    store.cancel_restore().unwrap();
    store.apply_pending().unwrap();
    assert_eq!(
        Repository::open(&store.database)
            .unwrap()
            .setting("self_player_identity")
            .unwrap()
            .as_deref(),
        Some("Original")
    );
    assert!(store
        .policy()
        .unwrap()
        .records
        .iter()
        .any(|b| b.kind == "before-restore"));
}

#[test]
fn snapshot_survives_status_changes_and_reuses_attribution_until_revision_changes() {
    static ATTRIBUTIONS: AtomicUsize = AtomicUsize::new(0);
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("archive.sqlite3");
    Repository::open(&path).unwrap();
    let c = Connection::open(&path).unwrap();
    for id in 1..=51 {
        c.execute("INSERT INTO observed_sessions(id,game_root,instance_name,pids,started_at,ended_at,status) VALUES(?,'root','Instance','[]','2026-09-18T10:00:00Z',?,?)",rusqlite::params![id,if id==51 {None} else {Some("2026-09-18T10:01:00Z")},if id==51 {"running"} else {"closed"}]).unwrap();
    }
    let mut cache = ObservationCache::open(&path).unwrap();
    cache.trace_statements(|sql| {
        if sql.contains("lead(strftime") {
            ATTRIBUTIONS.fetch_add(1, Ordering::SeqCst);
        }
    });
    let mut query = ObservationQuery {
        status: "closed".into(),
        ..Default::default()
    };
    let first = cache.query(1, &query).unwrap();
    let calculations = ATTRIBUTIONS.load(Ordering::SeqCst);
    assert_eq!(calculations, 1);
    query.snapshot = first.snapshot.clone();
    cache.query(2, &query).unwrap();
    assert_eq!(ATTRIBUTIONS.load(Ordering::SeqCst), calculations);
    c.execute(
        "UPDATE observed_sessions SET status='closed',ended_at='2026-09-18T10:01:00Z' WHERE id=51",
        [],
    )
    .unwrap();
    let second = cache.query(2, &query).unwrap();
    assert!(!first
        .sessions
        .iter()
        .any(|a| second.sessions.iter().any(|b| a.id == b.id)));
    assert_eq!(second.sessions[0].id, 30);
    assert_eq!(second.total, 50);
    assert_eq!(second.new_records, 0);
    assert!(second.history_changed);
    assert_eq!(ATTRIBUTIONS.load(Ordering::SeqCst), calculations + 1);
    query.snapshot = None;
    let refreshed = cache.query(1, &query).unwrap();
    assert_eq!(refreshed.total, 51);
    assert_eq!(refreshed.sessions[0].id, 51);
    assert_eq!(ATTRIBUTIONS.load(Ordering::SeqCst), calculations + 1);
    query.snapshot = first.snapshot;
    query.status = "running".into();
    assert!(cache.query(1, &query).is_err());
}
