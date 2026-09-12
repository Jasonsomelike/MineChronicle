//! Periodic PCL metadata reconciliation. All Minecraft/configuration inputs are read-only.
use super::{
    pcl_folders::{self, PclLink},
    DiscoveredInstance, PclAdapter,
};
use crate::{
    commands::{ScanControl, ScanPermit},
    database::{read_models::ScanSummary, DbResult, Repository},
    scanner::{discover_and_scan_linked, ScanIssue},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct SyncStatus {
    pub enabled: bool,
    pub running: bool,
    pub pcl_running: bool,
    pub source: String,
    pub launcher: Option<PathBuf>,
    pub link: Option<PclLink>,
    pub last_checked: Option<String>,
    pub last_synced: Option<String>,
    pub revision: u64,
    pub added: usize,
    pub changed: usize,
    pub current_instances: Vec<PathBuf>,
    pub issues: Vec<String>,
}
#[derive(Default)]
pub struct PclSync {
    status: Arc<Mutex<SyncStatus>>,
    requested: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    abort: Arc<AtomicBool>,
    database: Option<PathBuf>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Drop for PclSync {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let deadline = Instant::now() + Duration::from_millis(500);
            while !worker.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            if worker.is_finished() {
                let _ = worker.join();
            }
        }
    }
}
impl PclSync {
    pub fn start(database: PathBuf, control: ScanControl) -> Self {
        Self::start_with(
            database,
            control,
            pcl_folders::discover,
            Duration::from_secs(15),
        )
    }
    /// A provider permits real-directory integration tests without consulting this computer's registry.
    pub fn start_with<F>(
        database: PathBuf,
        control: ScanControl,
        discover: F,
        interval: Duration,
    ) -> Self
    where
        F: Fn() -> std::io::Result<PclLink> + Send + 'static,
    {
        let mut service = Self::default();
        service.database = Some(database.clone());
        let state = Arc::clone(&service.status);
        let request = Arc::clone(&service.requested);
        let shutdown = Arc::clone(&service.shutdown);
        let abort = Arc::clone(&service.abort);
        service.worker = Some(std::thread::spawn(move || {
            let mut last = Instant::now() - interval;
            let mut signature = Repository::open(&database)
                .and_then(|r| r.setting("pcl_metadata_signature"))
                .ok()
                .flatten()
                .unwrap_or_default();
            loop {
                if shutdown.load(Ordering::Acquire) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
                let force = request.swap(false, Ordering::AcqRel);
                if !force && last.elapsed() < interval {
                    continue;
                }
                last = Instant::now();
                abort.store(false, Ordering::Release);
                let result = (|| -> DbResult<()> {
                    let mut repo = Repository::open(&database)?;
                    let enabled = repo.setting("pcl_sync_enabled")?.as_deref() != Some("false");
                    state.lock().map_err(|_| "PCL 状态锁无效")?.enabled = enabled;
                    if !enabled && !force {
                        return Ok(());
                    }
                    let link = discover()?;
                    let previous_instances = repo.load_instances()?;
                    let selected = repo.setting("pcl_launcher")?.map(PathBuf::from);
                    let (launcher, source) = choose_launcher(&link, &previous_instances, selected);
                    let mut issues = Vec::new();
                    if launcher.is_none() && !link.folders.is_empty() {
                        issues.push("未确定唯一 PCL 配置目录，请打开 PCL 或选择启动器。".into());
                    }
                    let mut instances = Vec::new();
                    let mut metadata_issues: Vec<ScanIssue> = Vec::new();
                    if let Some(launcher) = &launcher {
                        for folder in &link.folders {
                            if !folder.available {
                                issues.push(format!("文件夹暂不可访问：{}", folder.name));
                                continue;
                            }
                            let found = PclAdapter.scan_linked_container(
                                &folder.path,
                                &folder.path,
                                Some(launcher),
                                || {
                                    !shutdown.load(Ordering::Acquire)
                                        && !abort.load(Ordering::Acquire)
                                        && !control.foreground.load(Ordering::Acquire)
                                },
                            );
                            instances.extend(found.instances);
                            metadata_issues.extend(found.issues);
                        }
                    }
                    instances.sort_by(|a, b| a.instance_path.cmp(&b.instance_path));
                    instances.dedup_by(|a, b| a.instance_path == b.instance_path);
                    issues.extend(metadata_issues.iter().map(|i| i.message.clone()));
                    issues.sort();
                    issues.dedup();
                    let complete = launcher.is_some()
                        && metadata_issues.is_empty()
                        && !abort.load(Ordering::Acquire)
                        && !shutdown.load(Ordering::Acquire)
                        && !control.foreground.load(Ordering::Acquire);
                    let hash = blake3::hash(&serde_json::to_vec(&(
                        &link.folders,
                        &launcher,
                        &instances,
                    ))?)
                    .to_hex()
                    .to_string();
                    {
                        let mut s = state.lock().map_err(|_| "PCL 状态锁无效")?;
                        s.link = Some(link.clone());
                        s.launcher = launcher.clone();
                        s.source = source;
                        s.pcl_running = !link.launchers.is_empty();
                        s.last_checked = Some(repo.now()?);
                        s.last_synced = repo.setting("pcl_last_synced")?;
                        s.issues = issues;
                        if complete {
                            s.current_instances =
                                instances.iter().map(|i| i.instance_path.clone()).collect();
                        }
                    }
                    if !complete || (!force && hash == signature) {
                        return Ok(());
                    }
                    if control.foreground.load(Ordering::Acquire)
                        || control
                            .running
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_err()
                    {
                        last = Instant::now() - interval;
                        if force {
                            request.store(true, Ordering::Release);
                        }
                        return Ok(());
                    }
                    let _permit = ScanPermit(Arc::clone(&control.running));
                    let previous = repo.load()?;
                    state.lock().map_err(|_| "PCL 状态锁无效")?.running = true;
                    let roots: Vec<_> = link
                        .folders
                        .iter()
                        .filter(|f| f.available)
                        .map(|f| f.path.clone())
                        .collect();
                    if roots.is_empty() {
                        return Ok(());
                    }
                    let mut summary: ScanSummary =
                        discover_and_scan_linked(&roots, launcher.as_deref(), |_| {
                            !shutdown.load(Ordering::Acquire)
                                && !abort.load(Ordering::Acquire)
                                && !control.foreground.load(Ordering::Acquire)
                        })
                        .into();
                    if summary.cancelled {
                        if force
                            && !abort.load(Ordering::Acquire)
                            && !shutdown.load(Ordering::Acquire)
                        {
                            request.store(true, Ordering::Release);
                        }
                        return Ok(());
                    }
                    let mut inputs = repo.inputs()?;
                    for root in &roots {
                        if !inputs.contains(root) {
                            inputs.push(root.clone());
                        }
                    }
                    for root in &mut summary.roots {
                        let names =
                            crate::scanner::local_names(&root.path, &roots, &mut summary.issues);
                        for player in root.worlds.iter_mut().flat_map(|w| &mut w.players) {
                            if let Ok(uuid) = uuid::Uuid::parse_str(&player.uuid) {
                                if let Some(name) = names.get(&uuid) {
                                    player.preferred_name = Some(name.clone());
                                    player.name_source = Some("usercache".into());
                                }
                            }
                        }
                    }
                    summary.issues.extend(
                        previous
                            .issues
                            .iter()
                            .filter(|i| !roots.iter().any(|r| i.path.starts_with(r)))
                            .cloned(),
                    );
                    let added = instances
                        .iter()
                        .filter(|i| {
                            !previous
                                .instances
                                .iter()
                                .any(|old| old.instance_path == i.instance_path)
                        })
                        .count();
                    let changed = instances
                        .iter()
                        .filter(|i| {
                            previous.instances.iter().any(|old| {
                                old.instance_path == i.instance_path
                                    && serde_json::to_value(old).ok()
                                        != serde_json::to_value(i).ok()
                            })
                        })
                        .count();
                    if abort.load(Ordering::Acquire)
                        || shutdown.load(Ordering::Acquire)
                        || control.foreground.load(Ordering::Acquire)
                    {
                        return Ok(());
                    }
                    repo.import(&summary, &inputs)?;
                    let now = repo.now()?;
                    repo.set_setting("pcl_last_synced", &now)?;
                    repo.set_setting("pcl_metadata_signature", &hash)?;
                    if let Some(path) = launcher {
                        repo.set_setting("pcl_launcher", &path.to_string_lossy())?;
                    }
                    signature = hash;
                    let mut s = state.lock().map_err(|_| "PCL 状态锁无效")?;
                    s.revision += 1;
                    s.added = added;
                    s.changed = changed;
                    s.last_synced = Some(now);
                    Ok(())
                })();
                if let Ok(mut s) = state.lock() {
                    s.running = false;
                    if let Err(e) = result {
                        s.issues = vec![format!("PCL 同步失败：{e}")];
                    }
                }
            }
        }));
        service
    }
    pub fn status(&self) -> SyncStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }
    pub fn request(&self) {
        self.requested.store(true, Ordering::Release);
    }
    pub fn set_enabled(&self, enabled: bool) -> DbResult<()> {
        if !enabled {
            self.abort.store(true, Ordering::Release);
        }
        if let Some(path) = &self.database {
            Repository::open(path)?
                .set_setting("pcl_sync_enabled", if enabled { "true" } else { "false" })?;
        }
        self.status.lock().map_err(|_| "PCL 状态锁无效")?.enabled = enabled;
        if enabled {
            self.request();
        }
        Ok(())
    }
    pub fn select_launcher(&self, path: PathBuf) -> DbResult<()> {
        let path = pcl_folders::validate_launcher(&path)?;
        if let Some(db) = &self.database {
            Repository::open(db)?.set_setting("pcl_launcher", &path.to_string_lossy())?;
        }
        self.request();
        Ok(())
    }
}
pub fn choose_launcher(
    link: &PclLink,
    instances: &[DiscoveredInstance],
    selected: Option<PathBuf>,
) -> (Option<PathBuf>, String) {
    if let Some(path) = selected.and_then(|p| pcl_folders::validate_launcher(&p).ok()) {
        return (Some(path), "已保存的 PCL 配置".into());
    }
    if link.launchers.len() == 1 {
        return (
            link.launchers
                .first()
                .and_then(|p| pcl_folders::validate_launcher(p).ok()),
            "正在运行的 PCL".into(),
        );
    }
    if link.launchers.len() > 1 {
        return (None, "多个 PCL，等待选择".into());
    }
    let paths: std::collections::HashSet<_> = instances
        .iter()
        .filter_map(|i| pcl_folders::validate_launcher(&i.launcher_path).ok())
        .collect();
    if paths.len() == 1 {
        return (paths.into_iter().next(), "已导入实例的 PCL 配置".into());
    }
    (None, "尚未连接".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_sync_waits_for_scan_permit_even_when_auto_sync_is_paused() -> DbResult<()> {
        let temp = tempfile::tempdir()?;
        let launcher = temp.path().join("launcher");
        let root = temp.path().join("game");
        std::fs::create_dir_all(launcher.join("PCL"))?;
        std::fs::write(launcher.join("PCL/Setup.ini"), "LaunchArgumentIndieV2:4")?;
        std::fs::create_dir_all(root.join("versions/One"))?;
        std::fs::write(
            root.join("versions/One/One.json"),
            br#"{"id":"One","type":"release"}"#,
        )?;
        let database = temp.path().join("db");
        Repository::open(&database)?.set_setting("pcl_sync_enabled", "false")?;
        let link = PclLink {
            folders: vec![pcl_folders::PclFolder {
                name: "Fixture".into(),
                path: std::fs::canonicalize(root)?,
                available: true,
            }],
            launchers: vec![launcher],
            issues: vec![],
        };
        let control = ScanControl::default();
        control.running.store(true, Ordering::Release);
        let service = PclSync::start_with(
            database.clone(),
            control.clone(),
            move || Ok(link.clone()),
            Duration::from_millis(200),
        );
        service.request();
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(service.status().revision, 0);
        control.running.store(false, Ordering::Release);
        let deadline = Instant::now() + Duration::from_secs(10);
        while service.status().revision == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(service.status().revision, 1);
        assert!(!service.status().enabled);
        assert_eq!(Repository::open(&database)?.load()?.instances.len(), 1);
        Ok(())
    }
}
