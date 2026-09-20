use crate::database::backup::{BackupInfo, BackupPolicy, BackupStore, PendingRestoreInfo};
use crate::{
    commands::{ScanControl, ScanPermit},
    database::DatabaseState,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::State;

#[derive(Clone)]
pub struct ArchiveService {
    pub store: BackupStore,
    gate: Arc<Mutex<()>>,
    failure: Arc<Mutex<Option<String>>>,
}
pub struct BackupWorker {
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Drop for BackupWorker {
    fn drop(&mut self) {
        let _ = crate::shutdown::shutdown_worker(&self.stop, self.worker.take());
    }
}
impl ArchiveService {
    pub fn new(store: BackupStore) -> Self {
        Self {
            store,
            gate: Arc::new(Mutex::new(())),
            failure: Arc::new(Mutex::new(None)),
        }
    }
    pub fn start(&self) -> BackupWorker {
        let service = self.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let worker = std::thread::spawn(move || {
            let mut last = Instant::now() - Duration::from_secs(3600);
            while !stopped.load(Ordering::Acquire) {
                if last.elapsed() >= Duration::from_secs(3600) {
                    if let Ok(_guard) = service.gate.lock() {
                        let result = service.store.create("auto");
                        service.record_failure(&result);
                    }
                    last = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        });
        BackupWorker {
            stop,
            worker: Some(worker),
        }
    }
    fn record_failure(&self, result: &crate::database::DbResult<Option<BackupInfo>>) {
        if let Ok(mut error) = self.failure.lock() {
            match result {
                Err(cause) => *error = Some(cause.to_string()),
                Ok(Some(_)) => *error = None,
                Ok(None) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remembers_failure_when_policy_cannot_be_written() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("archive.sqlite3");
        crate::database::Repository::open(&database).unwrap();
        let service = ArchiveService::new(BackupStore {
            app_data: dir.path().into(),
            database,
        });
        // Atomic metadata writer cannot replace this directory with a file.
        std::fs::create_dir(dir.path().join("backup-policy.writing")).unwrap();
        let result = service.store.create("auto");
        assert!(result.is_err());
        service.record_failure(&result);
        assert!(service.failure.lock().unwrap().is_some());
        service.record_failure(&Ok(None));
        assert!(service.failure.lock().unwrap().is_some());
    }
}
#[derive(Serialize)]
pub struct ArchiveStatus {
    database_path: PathBuf,
    version: &'static str,
    policy: BackupPolicy,
    pending_restore: bool,
    pending: Option<PendingRestoreInfo>,
    operation_error: Option<String>,
}
#[tauri::command]
pub async fn archive_status(service: State<'_, ArchiveService>) -> Result<ArchiveStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = service.gate.lock().map_err(|e| e.to_string())?;
        let pending = service.store.pending_restore().map_err(|e| e.to_string())?;
        Ok(ArchiveStatus {
            database_path: service.store.database.clone(),
            version: env!("CARGO_PKG_VERSION"),
            policy: service.store.policy().map_err(|e| e.to_string())?,
            pending_restore: pending.is_some(),
            pending,
            operation_error: service.failure.lock().map_err(|e| e.to_string())?.clone(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn configure_backups(
    enabled: bool,
    retention: usize,
    directory: PathBuf,
    service: State<'_, ArchiveService>,
) -> Result<BackupPolicy, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = service.gate.lock().map_err(|e| e.to_string())?;
        service
            .store
            .configure(enabled, retention, directory)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn create_archive_backup(
    service: State<'_, ArchiveService>,
) -> Result<Option<BackupInfo>, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = service.gate.lock().map_err(|e| e.to_string())?;
        let result = service.store.create("manual");
        service.record_failure(&result);
        result.map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn inspect_archive_backup(path: PathBuf) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::database::backup::inspect(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn schedule_archive_restore(
    path: PathBuf,
    expected_digest: String,
    service: State<'_, ArchiveService>,
    control: State<'_, ScanControl>,
) -> Result<(), String> {
    // Hold the existing scan permit for the entire staging operation.
    if control.foreground.load(Ordering::Acquire) {
        return Err("扫描正在进行，请完成后恢复".into());
    }
    control
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "后台扫描正在进行，请稍后恢复".to_owned())?;
    let permit = ScanPermit(control.running.clone());
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let _guard = service.gate.lock().map_err(|e| e.to_string())?;
        if !crate::launcher::running::running_games()?.is_empty() {
            return Err("游戏正在运行，请退出游戏后恢复档案".into());
        }
        service
            .store
            .schedule_verified_restore(&path, &expected_digest)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cancel_archive_restore(service: State<'_, ArchiveService>) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = service.gate.lock().map_err(|e| e.to_string())?;
        service.store.cancel_restore().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn choose_archive_backup<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<PathBuf>, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let owner = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as usize)
            .unwrap_or(0);
        tauri::async_runtime::spawn_blocking(move || {
            use std::os::windows::ffi::OsStringExt;
            use windows_sys::Win32::UI::Controls::Dialogs::{
                CommDlgExtendedError, GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST,
                OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST, OPENFILENAMEW,
            };
            let mut file = vec![0u16; 32768];
            let filter: Vec<u16> = "SQLite 档案\0*.sqlite3;*.sqlite;*.db\0所有文件\0*.*\0\0"
                .encode_utf16()
                .collect();
            let title: Vec<u16> = "选择 MineChronicle 备份\0".encode_utf16().collect();
            let mut dialog: OPENFILENAMEW = unsafe { std::mem::zeroed() };
            dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
            dialog.hwndOwner = owner as _;
            dialog.lpstrFile = file.as_mut_ptr();
            dialog.nMaxFile = file.len() as u32;
            dialog.lpstrFilter = filter.as_ptr();
            dialog.lpstrTitle = title.as_ptr();
            dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
            if unsafe { GetOpenFileNameW(&mut dialog) } != 0 {
                let end = file.iter().position(|c| *c == 0).unwrap_or(file.len());
                Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(
                    &file[..end],
                ))))
            } else {
                let error = unsafe { CommDlgExtendedError() };
                if error == 0 {
                    Ok(None)
                } else {
                    Err(format!("文件选择器错误：{error}"))
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("当前平台请使用备份列表或输入完整路径".into())
    }
}
#[tauri::command]
pub fn restart_after_restore<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    service: State<'_, ArchiveService>,
    control: State<'_, ScanControl>,
) -> Result<(), String> {
    if control.running.load(Ordering::Acquire) || control.foreground.load(Ordering::Acquire) {
        return Err("扫描正在进行，请完成后重启恢复".into());
    }
    if !service.store.app_data.join("pending-restore.json").exists() {
        return Err("没有待恢复档案".into());
    }
    if !crate::launcher::running::running_games()?.is_empty() {
        return Err("游戏正在运行，请退出游戏后重启恢复".into());
    }
    app.restart();
}
#[tauri::command]
pub fn open_archive_folder(
    backups: bool,
    service: State<'_, ArchiveService>,
    database: State<'_, DatabaseState>,
) -> Result<(), String> {
    let path = if backups {
        service.store.policy().map_err(|e| e.to_string())?.directory
    } else {
        database.path.parent().ok_or("档案目录不可用")?.to_owned()
    };
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
