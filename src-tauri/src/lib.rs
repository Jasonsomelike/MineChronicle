//! `unwrap_used` / `expect_used` are denied in shipped code (see Cargo.toml).
//! Inline test modules assert against synthetic fixtures and legitimately
//! unwrap, so relax those two lints for test builds only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod commands;
pub mod database;
mod desktop;
pub mod domain;
pub mod launcher;
pub mod minecraft;
pub mod scanner;
mod shutdown;
pub mod tracker;
#[cfg(windows)]
mod wide;

pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(commands::ScanControl::default())
        .manage(commands::ObservationService::default())
        .manage(minecraft::runtime_resources::IconCacheDir::default())
        .invoke_handler(tauri::generate_handler![
            commands::phase_status,
            commands::archive_status,
            commands::configure_backups,
            commands::create_archive_backup,
            commands::inspect_archive_backup,
            commands::schedule_archive_restore,
            commands::cancel_archive_restore,
            commands::choose_archive_backup,
            commands::restart_after_restore,
            commands::open_archive_folder,
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
            commands::observed_sessions_page,
            commands::observed_session_bounds,
            commands::set_observed_session_end,
            commands::clear_observed_session_end,
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
            minecraft::runtime_resources::resolve_stat_icons,
            minecraft::runtime_resources::store_stat_icon
        ])
}

pub fn run() -> tauri::Result<()> {
    use tauri::Manager;
    #[cfg(windows)]
    let (_instance, outcome) = desktop::single_instance()?;
    #[cfg(windows)]
    if outcome != desktop::SecondLaunch::Primary {
        // Another instance owns the mutex. Say so when its window could not be
        // raised - previously this path returned Ok(()) with no message, so a
        // second double-click looked like nothing happened at all.
        desktop::report_second_launch(outcome);
        return Ok(());
    }
    configure(tauri::Builder::default())
        .setup(|app| {
            desktop::install(app)?;
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            app.state::<minecraft::runtime_resources::IconCacheDir>()
                .set(Some(directory.join("stat-icon-cache")));
            let path = database::storage::archive_path(&directory)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            let backup_store = database::backup::BackupStore {app_data: directory.clone(), database: path.clone()};
            backup_store.apply_pending().map_err(|e| std::io::Error::other(e.to_string()))?;
            database::Repository::open(&path).map_err(|e| std::io::Error::other(e.to_string()))?;
            let archive_service = commands::ArchiveService::new(backup_store);
            app.manage(archive_service.start());
            app.manage(archive_service);
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
                if window.app_handle().tray_by_id("minechronicle").is_some()
                    && window.hide().is_ok()
                {
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
}
