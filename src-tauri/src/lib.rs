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

mod app_paths {
    //! Windows 上可通过 `MINECHRONICLE_DATA_DIR` 把 Tauri 的 `%APPDATA%/<identifier>`
    //! 固定到指定数据目录（例如放到别的盘）；未设置该环境变量时维持系统默认。
    //! 设置后首次启动会把旧 Roaming 数据整体迁移到新目录，并把原位置链接过去，
    //! 保证历史档案、备份与配置不丢失。

    #[cfg(windows)]
    const DATA_DIR_ENV: &str = "MINECHRONICLE_DATA_DIR";

    #[cfg(windows)]
    pub fn redirect_app_data() {
        use std::path::PathBuf;

        let Some(target) = std::env::var_os(DATA_DIR_ENV)
            .map(PathBuf::from)
            .filter(|target| !target.as_os_str().is_empty())
        else {
            return;
        };
        let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) else {
            return;
        };
        let legacy = roaming.join("dev.minechronicle.desktop");

        if let Err(error) = std::fs::create_dir_all(&target) {
            eprintln!(
                "MineChronicle could not create data directory {}: {error}",
                target.display()
            );
            return;
        }

        // Tauri resolves app_data_dir() from APPDATA + identifier. 把数据迁到目标目录
        // 后在原位置留一个 junction，这样旧路径仍然可用，且历史文件只有一份。
        if legacy.exists()
            && !legacy.join("storage.json").exists()
            && legacy.read_dir().is_ok_and(|mut d| d.next().is_none())
        {
            let _ = std::fs::remove_dir(&legacy);
        }
        if legacy.exists() && !is_link(&legacy) && !target.join("minechronicle.sqlite3").exists() {
            if let Err(error) = move_tree(&legacy, &target) {
                eprintln!(
                    "MineChronicle could not migrate app data to {}: {error}",
                    target.display()
                );
            }
        }
        if !legacy.exists() {
            if let Err(error) = symlink_dir(&target, &legacy) {
                eprintln!(
                    "MineChronicle could not link app data directory; keeping {}: {error}",
                    legacy.display()
                );
                return;
            }
        }
        std::env::set_var("APPDATA", roaming);
    }

    #[cfg(windows)]
    fn is_link(path: &std::path::Path) -> bool {
        std::fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }

    #[cfg(windows)]
    fn move_tree(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let name = entry.file_name();
            let from = entry.path();
            let to = target.join(&name);
            if to.exists() {
                continue;
            }
            if entry.file_type()?.is_dir() {
                copy_dir(&from, &to)?;
                std::fs::remove_dir_all(&from)?;
            } else {
                std::fs::rename(&from, &to).or_else(|_| {
                    std::fs::copy(&from, &to).and_then(|_| std::fs::remove_file(&from))
                })?;
            }
        }
        Ok(())
    }

    #[cfg(windows)]
    fn copy_dir(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
        std::fs::create_dir_all(target)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            let from = entry.path();
            let to = target.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                copy_dir(&from, &to)?;
            } else {
                std::fs::copy(&from, &to)?;
            }
        }
        Ok(())
    }

    #[cfg(windows)]
    fn symlink_dir(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
        // Prefer a junction (no admin needed); fall back to a directory symlink.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()?;
        if status.success() {
            return Ok(());
        }
        std::os::windows::fs::symlink_dir(target, link)
    }

    #[cfg(not(windows))]
    pub fn redirect_app_data() {}
}

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
    app_paths::redirect_app_data();
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
