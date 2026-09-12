use minechronicle_lib::{
    commands::{acknowledge_view, runtime_info, ViewReceipt},
    database::DatabaseState,
};
use tauri::{
    test::{mock_builder, mock_context, noop_assets},
    Manager,
};
#[test]
fn runtime_reports_actual_archive_and_bounded_view_receipt(
) -> Result<(), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let database = temp.path().join("archive.sqlite3");
    let app = minechronicle_lib::configure(mock_builder())
        .manage(DatabaseState {
            path: database.clone(),
        })
        .build(mock_context(noop_assets()))?;
    let info = runtime_info(app.state())?;
    assert_eq!(info.database_path, database);
    assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    assert_eq!(info.embedded_assets, !tauri::is_dev());
    assert_eq!(info.pcl_instances, 0);
    let receipt = |version: String| ViewReceipt {
        frontend_version: version,
        page_url: "http://tauri.localhost/".into(),
        database_path: database.to_string_lossy().into_owned(),
        pcl_instances: 0,
        pcl_panel_visible: false,
    };
    assert!(acknowledge_view(receipt("x".repeat(33)), app.state()).is_err());
    assert!(!temp.path().join("last-view.json").exists());
    acknowledge_view(receipt(info.version.into()), app.state())?;
    let saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(temp.path().join("last-view.json"))?)?;
    assert_eq!(saved["frontend_version"], env!("CARGO_PKG_VERSION"));
    Ok(())
}
