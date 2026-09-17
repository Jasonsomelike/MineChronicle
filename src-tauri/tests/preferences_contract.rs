use minechronicle_lib::{
    commands::{self_player_identity, set_self_player_identity},
    database::DatabaseState,
};
use tauri::{
    async_runtime::block_on,
    test::{mock_builder, mock_context, noop_assets},
    Manager,
};

#[test]
fn identity_survives_app_recreation_and_clear_is_explicit() -> Result<(), Box<dyn std::error::Error>>
{
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.sqlite3");
    let create = || {
        minechronicle_lib::configure(mock_builder())
            .manage(DatabaseState { path: path.clone() })
            .build(mock_context(noop_assets()))
    };
    let app = create()?;
    assert_eq!(block_on(self_player_identity(app.state()))?, None);
    block_on(set_self_player_identity(
        " Jasonsomelike ".into(),
        app.state(),
    ))?;
    drop(app);
    let app = create()?;
    assert_eq!(
        block_on(self_player_identity(app.state()))?.as_deref(),
        Some("Jasonsomelike")
    );
    assert!(block_on(set_self_player_identity("x".repeat(257), app.state())).is_err());
    assert_eq!(
        block_on(self_player_identity(app.state()))?.as_deref(),
        Some("Jasonsomelike")
    );
    block_on(set_self_player_identity("".into(), app.state()))?;
    drop(app);
    let app = create()?;
    assert_eq!(
        block_on(self_player_identity(app.state()))?.as_deref(),
        Some("")
    );
    Ok(())
}
