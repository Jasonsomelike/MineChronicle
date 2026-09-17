pub use crate::database::read_models::*;
use crate::{
    database::{DatabaseState, Repository},
    scanner::{discover_and_scan_linked, local_names, ScanProgress},
};
use std::time::{Duration, Instant};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{ipc::Channel, State};

#[derive(Default, Clone)]
pub struct ScanControl {
    pub(crate) running: Arc<AtomicBool>,
    pub(crate) foreground: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

pub(crate) struct ScanPermit(pub(crate) Arc<AtomicBool>);
impl Drop for ScanPermit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn scan_game_roots(
    paths: Vec<String>,
    on_progress: Channel<ScanProgress>,
    control: State<'_, ScanControl>,
    database: State<'_, DatabaseState>,
) -> Result<ScanSummary, String> {
    scan_impl(paths, on_progress, control, database, None).await
}

#[tauri::command]
pub fn discover_pcl_folders() -> Result<crate::launcher::pcl_folders::PclLink, String> {
    crate::launcher::pcl_folders::discover().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_pcl_roots(
    paths: Vec<String>,
    launcher: String,
    on_progress: Channel<ScanProgress>,
    control: State<'_, ScanControl>,
    database: State<'_, DatabaseState>,
) -> Result<ScanSummary, String> {
    let launcher = crate::launcher::pcl_folders::validate_launcher(std::path::Path::new(&launcher))
        .map_err(|e| e.to_string())?;
    scan_impl(paths, on_progress, control, database, Some(launcher)).await
}

async fn scan_impl(
    paths: Vec<String>,
    on_progress: Channel<ScanProgress>,
    control: State<'_, ScanControl>,
    database: State<'_, DatabaseState>,
    launcher: Option<PathBuf>,
) -> Result<ScanSummary, String> {
    if paths.is_empty()
        || paths.len() > crate::scanner::MAX_MANUAL_ROOTS
        || paths.iter().any(|p| p.trim().is_empty())
    {
        return Err(format!(
            "请提供 1–{} 个明确的游戏根目录。",
            crate::scanner::MAX_MANUAL_ROOTS
        ));
    }
    control
        .foreground
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "扫描正在进行，请等待完成或取消当前扫描。".to_owned())?;
    let foreground = ScanPermit(Arc::clone(&control.foreground));
    control.cancelled.store(false, Ordering::Release);
    let running = Arc::clone(&control.running);
    let cancelled = Arc::clone(&control.cancelled);
    let database_path = database.path.clone();
    let roots: Vec<_> = paths.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let _foreground = foreground;
        let waiting = Instant::now();
        while running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            if cancelled.load(Ordering::Acquire) {
                let mut report = ScanSummary::from(crate::scanner::ScanReport::default());
                report.cancelled = true;
                return Ok(report);
            }
            if waiting.elapsed() > Duration::from_secs(15) {
                return Err("后台扫描尚未释放目录，请稍后重试。".into());
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let _permit = ScanPermit(running);
        let launcher = launcher.or_else(|| resolve_pcl_context(&roots, &database_path));
        let mut last_progress = Instant::now() - Duration::from_secs(1);
        let mut final_progress = ScanProgress::default();
        let mut report = discover_and_scan_linked(&roots, launcher.as_deref(), |progress| {
            final_progress = progress.clone();
            if cancelled.load(Ordering::Acquire) {
                return false;
            }
            if last_progress.elapsed() < Duration::from_millis(75) {
                return true;
            }
            last_progress = Instant::now();
            on_progress.send(progress.clone()).is_ok()
        });
        if !report.cancelled && on_progress.send(final_progress).is_err() {
            report.cancelled = true;
        }
        let scopes: Vec<_> = roots
            .iter()
            .filter_map(|p| std::fs::canonicalize(p).ok())
            .collect();
        let mut summary = ScanSummary::from(report);
        if summary.cancelled {
            return Ok(summary);
        }
        for root in &mut summary.roots {
            if cancelled.load(Ordering::Acquire) {
                summary.cancelled = true;
                break;
            }
            let names = local_names(&root.path, &scopes, &mut summary.issues);
            for world in &mut root.worlds {
                for player in &mut world.players {
                    if let Ok(uuid) = uuid::Uuid::parse_str(&player.uuid) {
                        if let Some(name) = names.get(&uuid) {
                            player.preferred_name = Some(name.clone());
                            player.name_source = Some("usercache".into());
                        }
                    }
                }
            }
        }
        if summary.cancelled || cancelled.load(Ordering::Acquire) {
            summary.cancelled = true;
            return Ok(summary);
        }
        let mut repository = Repository::open(&database_path).map_err(|e| e.to_string())?;
        repository
            .import(&summary, &roots)
            .map_err(|e| e.to_string())?;
        repository.load().map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "扫描工作线程异常结束，请重试。".to_owned())?
}

/// Only reuse PCL context when every input is an explicitly registered folder.
pub fn resolve_pcl_context(roots: &[PathBuf], database: &std::path::Path) -> Option<PathBuf> {
    let link = crate::launcher::pcl_folders::discover().ok()?;
    if !roots
        .iter()
        .all(|p| std::fs::canonicalize(p).is_ok_and(|p| link.folders.iter().any(|f| f.path == p)))
    {
        return None;
    }
    if let Some(path) = Repository::open(database)
        .ok()?
        .setting("pcl_launcher")
        .ok()?
        .and_then(|p| {
            crate::launcher::pcl_folders::validate_launcher(std::path::Path::new(&p)).ok()
        })
    {
        return Some(path);
    }
    if link.launchers.len() == 1 {
        return link.launchers.into_iter().next();
    }
    if !link.launchers.is_empty() {
        return None;
    }
    let library = Repository::open(database).ok()?.load().ok()?;
    let known: std::collections::HashSet<_> = library
        .instances
        .into_iter()
        .map(|i| i.launcher_path)
        .filter(|p| crate::launcher::pcl_folders::validate_launcher(p).is_ok())
        .collect();
    if known.len() == 1 {
        known.into_iter().next()
    } else {
        None
    }
}

#[tauri::command]
pub fn cancel_scan(control: State<'_, ScanControl>) {
    control.cancelled.store(true, Ordering::Release);
}
