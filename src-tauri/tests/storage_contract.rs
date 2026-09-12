use minechronicle_lib::database::{
    storage::{archive_path, migrate_archive},
    Repository,
};
type Result = std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>;
#[test]
fn moves_archive_without_losing_aliases_and_keeps_source_backup() -> Result {
    let temp = tempfile::tempdir()?;
    let app = temp.path().join("appdata");
    std::fs::create_dir(&app)?;
    let source = app.join("minechronicle.sqlite3");
    Repository::open(&source)?.set_alias("00000000-0000-4000-8000-000000000001", "Builder")?;
    let mut repo = Repository::open(&source)?;
    repo.set_setting("self_player_identity", "Builder")?;
    repo.observe_instances(&[minechronicle_lib::launcher::running::ActiveInstance {
        game_root: temp.path().join("game"),
        name: "Persistent instance".into(),
        pids: vec![123],
    }])?;
    repo.observe_instances(&[])?;
    drop(repo);
    let before = std::fs::read(&source)?;
    let target = temp.path().join("another-drive/archive.sqlite3");
    assert_eq!(migrate_archive(&app, &target)?, target);
    assert_eq!(archive_path(&app)?, target);
    let repo = Repository::open(&target)?;
    assert_eq!(
        repo.setting("self_player_identity")?.as_deref(),
        Some("Builder")
    );
    assert_eq!(repo.observed_sessions()?.len(), 1);
    assert_eq!(repo.observed_sessions()?[0].status, "closed");
    drop(repo);
    assert_eq!(std::fs::read(source)?, before);
    let conn = rusqlite::Connection::open(&target)?;
    assert_eq!(
        conn.query_row("SELECT preferred_name FROM players", [], |r| r
            .get::<_, String>(0))?,
        "Builder"
    );
    assert_eq!(migrate_archive(&app, &target)?, target);
    Ok(())
}
#[test]
fn refuses_overwrite_and_unavailable_configured_drive() -> Result {
    let temp = tempfile::tempdir()?;
    let app = temp.path().join("appdata");
    std::fs::create_dir(&app)?;
    Repository::open(&app.join("minechronicle.sqlite3"))?;
    let target = temp.path().join("existing.sqlite3");
    std::fs::write(&target, b"precious")?;
    assert!(migrate_archive(&app, &target).is_err());
    assert_eq!(std::fs::read(&target)?, b"precious");
    assert!(!app.join("storage.json").exists());
    std::fs::write(
        app.join("storage.json"),
        serde_json::to_vec(
            &serde_json::json!({"database_path":temp.path().join("unavailable/archive.sqlite3")}),
        )?,
    )?;
    assert!(archive_path(&app).is_err());
    Ok(())
}
