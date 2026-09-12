pub mod commands;
pub mod database;
pub mod domain;
pub mod launcher;
pub mod minecraft;
pub mod scanner;
pub mod tracker;
mod desktop;

pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(commands::ScanControl::default())
        .invoke_handler(tauri::generate_handler![
            commands::phase_status,
            commands::scan_game_roots,
            commands::discover_pcl_folders,
            commands::scan_pcl_roots,
            commands::cancel_scan,
            commands::load_library,
            commands::set_player_alias,
            commands::runtime_info,
            commands::acknowledge_view,
            commands::tracking_status,
            commands::set_tracking_enabled,
            commands::tracking_summary,
            commands::observed_sessions,
            commands::self_player_identity,
            commands::set_self_player_identity,
            commands::health_summary,
            commands::review_health,
            commands::decide_clone,
            commands::pcl_sync_status,
            commands::sync_pcl_now,
            commands::set_pcl_sync,
            commands::select_pcl_launcher,
            commands::timeline,
            commands::statistics,
            commands::startup_status,
            commands::set_startup_enabled,
            minecraft::runtime_resources::resolve_stat_icons
        ])
}

pub fn run() -> tauri::Result<()> {
    use tauri::Manager;
    #[cfg(windows)]
    let Some(_instance) = desktop::single_instance()? else { return Ok(()); };
    configure(tauri::Builder::default())
        .setup(|app| {
            desktop::install(app)?;
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let path = database::storage::archive_path(&directory)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            database::Repository::open(&path).map_err(|e| std::io::Error::other(e.to_string()))?;
            let state=database::DatabaseState {path};
            let startup=serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"executable":std::env::current_exe()?,"database_path":state.path,"embedded_assets":!tauri::is_dev()});
            if let Some(parent)=state.path.parent() {std::fs::write(parent.join("last-startup.json"),serde_json::to_vec_pretty(&startup)?)?;}
            let tracker=tracker::watcher::Tracker::start(state.path.clone(),app.state::<commands::ScanControl>().inner().clone());
            app.manage(tracker);
            app.manage(launcher::sync::PclSync::start(state.path.clone(),app.state::<commands::ScanControl>().inner().clone()));
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide only after successful tray initialization in setup.
                if window.app_handle().tray_by_id("minechronicle").is_some() {
                    if window.hide().is_ok() {
                        api.prevent_close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
}
