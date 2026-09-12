use crate::launcher::running::ActiveInstance;
use crate::{
    commands::ScanControl,
    database::{read_models::ScanSummary, Repository},
    scanner::{GameRootScanner, ScanLimits},
};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
type ActivityProbe = Box<dyn Fn() -> crate::database::DbResult<Vec<ActiveInstance>> + Send>;
const RECONCILE: Duration = Duration::from_secs(300);
const EXIT_DRAIN: Duration = Duration::from_secs(8);

#[derive(Default)]
struct State {
    enabled: AtomicBool,
    shutdown: AtomicBool,
    running: AtomicBool,
    watched: AtomicUsize,
    finalizing: AtomicUsize,
    revision: AtomicU64,
    error: Mutex<Option<String>>,
    active: Mutex<Vec<ActiveInstance>>,
}
pub struct Tracker {
    state: Arc<State>,
    worker: Option<std::thread::JoinHandle<()>>,
    database: Option<PathBuf>,
}
#[derive(Serialize)]
pub struct TrackerStatus {
    pub enabled: bool,
    pub running: bool,
    pub watched_directories: usize,
    pub finalizing_instances: usize,
    pub revision: u64,
    pub error: Option<String>,
    pub active_instances: Vec<ActiveInstance>,
}
impl Default for Tracker {
    fn default() -> Self {
        Self {
            state: Arc::new(State::default()),
            worker: None,
            database: None,
        }
    }
}
impl Drop for Tracker {
    fn drop(&mut self) {
        self.state.shutdown.store(true, Ordering::Release);
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
impl Tracker {
    pub fn start(database: PathBuf, control: ScanControl) -> Self {
        let archive = database.clone();
        Self::start_with_activity(database, control, move || {
            let games = crate::launcher::running::running_games().map_err(std::io::Error::other)?;
            if games.is_empty() {
                return Ok(Vec::new());
            }
            let instances = Repository::open(&archive)?.load_instances()?;
            Ok(crate::launcher::running::match_instances(
                &games, &instances,
            ))
        })
    }
    pub fn start_with_activity(
        database: PathBuf,
        control: ScanControl,
        probe: impl Fn() -> crate::database::DbResult<Vec<ActiveInstance>> + Send + 'static,
    ) -> Self {
        let mut tracker = Self::default();
        tracker.database = Some(database.clone());
        match Repository::open(&database).and_then(|r| r.tracking_enabled()) {
            Ok(enabled) => tracker.state.enabled.store(enabled, Ordering::Release),
            Err(e) => set_error(&tracker.state, Some(format!("无法读取追踪设置：{e}"))),
        }
        let state = Arc::clone(&tracker.state);
        tracker.worker = Some(std::thread::spawn(move || {
            run(database, control, state, Box::new(probe))
        }));
        tracker
    }
    pub fn status(&self) -> TrackerStatus {
        TrackerStatus {
            enabled: self.state.enabled.load(Ordering::Acquire),
            running: self.state.running.load(Ordering::Acquire),
            watched_directories: self.state.watched.load(Ordering::Acquire),
            finalizing_instances: self.state.finalizing.load(Ordering::Acquire),
            revision: self.state.revision.load(Ordering::Acquire),
            error: self.state.error.lock().ok().and_then(|e| e.clone()),
            active_instances: self
                .state
                .active
                .lock()
                .map(|a| a.clone())
                .unwrap_or_default(),
        }
    }
    pub fn set_enabled(&self, enabled: bool) -> crate::database::DbResult<()> {
        if let Some(path) = &self.database {
            Repository::open(path)?.set_tracking_enabled(enabled)?;
        }
        self.state.enabled.store(enabled, Ordering::Release);
        Ok(())
    }
}
fn set_error(state: &State, error: Option<String>) {
    if let Ok(mut slot) = state.error.lock() {
        *slot = error;
    }
}
fn safe_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .is_ok_and(|m| m.is_dir() && !crate::scanner::path_identity::is_link(&m))
}
/// Never recursively watch region trees. Watch each needed directory explicitly.
pub fn watch_paths(report: &ScanSummary) -> HashSet<PathBuf> {
    let mut paths = HashSet::new();
    for root in &report.roots {
        if !safe_dir(&root.path) {
            continue;
        }
        paths.insert(root.path.clone());
        if !safe_dir(&root.path.join("saves")) {
            continue;
        }
        paths.insert(root.path.join("saves"));
        for world in &root.worlds {
            if world.path.parent() != Some(root.path.join("saves").as_path())
                || !safe_dir(&world.path)
            {
                continue;
            }
            paths.insert(world.path.clone());
            for suffix in ["stats", "players"] {
                let path = world.path.join(suffix);
                if safe_dir(&path) {
                    paths.insert(path.clone());
                    if suffix == "players" && safe_dir(&path.join("stats")) {
                        paths.insert(path.join("stats"));
                    }
                }
            }
        }
    }
    paths
}
pub fn relevant(event: &notify::Event) -> bool {
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let stats = p
            .parent()
            .and_then(|p| p.file_name())
            .is_some_and(|n| n == "stats");
        stats
            || name == "level.dat"
            || name == "saves"
            || name == "stats"
            || name == "players"
            || matches!(
                event.kind,
                notify::EventKind::Create(_) | notify::EventKind::Remove(_)
            )
    })
}
fn path_under(path: &Path, root: &Path) -> bool {
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
    #[cfg(windows)]
    {
        fn key(path: &Path) -> String {
            let text = path.to_string_lossy();
            let text = if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{unc}")
            } else {
                text.trim_start_matches(r"\\?\").to_owned()
            };
            text.replace('\\', "/").trim_end_matches('/').to_lowercase()
        }
        let path = key(path);
        let root = key(root);
        path == root
            || path
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('/'))
    }
}
pub fn affected_roots(report: &ScanSummary, events: &HashSet<PathBuf>) -> Vec<PathBuf> {
    let mut selected = HashSet::new();
    for event in events {
        if let Some(root) = report
            .roots
            .iter()
            .filter(|r| path_under(event, &r.path))
            .max_by_key(|r| r.path.components().count())
        {
            selected.insert(root.path.clone());
        }
    }
    selected.into_iter().collect()
}
fn run(database: PathBuf, control: ScanControl, state: Arc<State>, probe: ActivityProbe) {
    let dirty = Arc::new(AtomicBool::new(false));
    let changed_paths = Arc::new(Mutex::new(HashSet::<PathBuf>::new()));
    let event_paths = Arc::clone(&changed_paths);
    let overflow = Arc::new(AtomicBool::new(false));
    let overflow_event = Arc::clone(&overflow);
    let changed = Arc::clone(&dirty);
    let errors = Arc::clone(&state);
    let watcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
            Ok(event) if relevant(&event) => {
                if let Ok(mut paths) = event_paths.lock() {
                    if paths.len() + event.paths.len() > 1024 {
                        paths.clear();
                        overflow_event.store(true, Ordering::Release);
                    } else {
                        paths.extend(event.paths);
                    }
                }
                changed.store(true, Ordering::Release);
            }
            Err(e) => {
                set_error(
                    &errors,
                    Some(format!("文件监控通知异常，将通过定期检查补偿：{e}")),
                );
                changed.store(true, Ordering::Release);
                overflow_event.store(true, Ordering::Release);
            }
            _ => {}
        });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            set_error(&state, Some(e.to_string()));
            state.enabled.store(false, Ordering::Release);
            return;
        }
    };
    let mut registered: HashSet<PathBuf> = HashSet::new();
    let mut last_scan = Instant::now() - RECONCILE;
    let mut last_full = last_scan;
    let mut pending: Option<Instant> = None;
    let mut was_enabled = false;
    let mut last_probe = Instant::now() - Duration::from_secs(3);
    let mut active_roots = HashSet::new();
    let mut closing_roots = HashMap::<PathBuf, Instant>::new();
    let mut opening_roots = HashSet::new();
    let mut last_import: Option<(Vec<PathBuf>, blake3::Hash, i64)> = None;
    let mut observed_active = Vec::new();
    let mut sessions_ready =
        match Repository::open(&database).and_then(|r| r.interrupt_observed_sessions()) {
            Ok(()) => true,
            Err(e) => {
                set_error(&state, Some(format!("观测记录恢复失败，将重试：{e}")));
                false
            }
        };
    while !state.shutdown.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(200));
        let enabled = state.enabled.load(Ordering::Acquire);
        if !enabled {
            if was_enabled {
                for path in registered.drain() {
                    let _ = watcher.unwatch(&path);
                }
                state.watched.store(0, Ordering::Release);
                active_roots.clear();
                closing_roots.clear();
                opening_roots.clear();
                state.finalizing.store(0, Ordering::Release);
                if let Ok(mut active) = state.active.lock() {
                    active.clear();
                }
            }
            if sessions_ready {
                match Repository::open(&database).and_then(|r| r.interrupt_observed_sessions()) {
                    Ok(()) => {
                        sessions_ready = false;
                        observed_active.clear();
                        state.revision.fetch_add(1, Ordering::AcqRel);
                    }
                    Err(e) => set_error(&state, Some(format!("观测记录保存失败：{e}"))),
                }
            }
            was_enabled = false;
            continue;
        }
        if !was_enabled {
            last_scan = Instant::now() - RECONCILE;
            last_full = last_scan;
            last_probe = Instant::now() - Duration::from_secs(3);
            last_import = None;
            was_enabled = true;
        }
        if last_probe.elapsed() >= Duration::from_secs(3) {
            last_probe = Instant::now();
            match probe() {
                Ok(active) => {
                    // Persist boundaries on process changes, not on every poll or save.
                    let sessions = (|| -> crate::database::DbResult<()> {
                        if !sessions_ready || active != observed_active {
                            let mut repo = Repository::open(&database)?;
                            if !sessions_ready {
                                repo.interrupt_observed_sessions()?;
                                sessions_ready = true;
                            }
                            repo.observe_instances(&active)?;
                            if active != observed_active {
                                state.revision.fetch_add(1, Ordering::AcqRel);
                            }
                            observed_active = active.clone();
                        }
                        Ok(())
                    })();
                    if let Err(e) = sessions {
                        set_error(&state, Some(format!("观测记录保存失败，将重试：{e}")));
                    }
                    let roots: HashSet<_> = active.iter().map(|a| a.game_root.clone()).collect();
                    if roots != active_roots {
                        for root in active_roots.difference(&roots) {
                            closing_roots.insert(root.clone(), Instant::now() + EXIT_DRAIN);
                        }
                        opening_roots.extend(roots.difference(&active_roots).cloned());
                        closing_roots.retain(|p, _| !roots.contains(p));
                        state
                            .finalizing
                            .store(closing_roots.len(), Ordering::Release);
                        active_roots = roots;
                        pending = Some(Instant::now());
                        last_import = None;
                    }
                    if let Ok(mut slot) = state.active.lock() {
                        *slot = active;
                    }
                }
                Err(e) => set_error(&state, Some(format!("游戏运行状态读取失败：{e}"))),
            }
        }
        if dirty.swap(false, Ordering::AcqRel) {
            // Bounded batching: continuous save notifications must not postpone
            // a scan forever.
            pending.get_or_insert_with(Instant::now);
        }
        if pending.is_some_and(|t| t.elapsed() < Duration::from_secs(2)) {
            continue;
        }
        if pending.is_none()
            && opening_roots.is_empty()
            && closing_roots.is_empty()
            && (active_roots.is_empty() || last_scan.elapsed() < RECONCILE)
        {
            continue;
        }
        if control.foreground.load(Ordering::Acquire) {
            continue;
        }
        if control
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            continue;
        }
        let _permit = crate::commands::ScanPermit(Arc::clone(&control.running));
        state.running.store(true, Ordering::Release);
        let result = (|| -> crate::database::DbResult<()> {
            let mut repo = Repository::open(&database)?;
            let mut library = repo.load()?;
            library
                .roots
                .retain(|r| active_roots.contains(&r.path) || closing_roots.contains_key(&r.path));
            let events = changed_paths
                .lock()
                .map(|mut paths| std::mem::take(&mut *paths))
                .unwrap_or_default();
            let full = last_full.elapsed() >= RECONCILE || overflow.swap(false, Ordering::AcqRel);
            let mut roots: Vec<_> = if full {
                library.roots.iter().map(|r| r.path.clone()).collect()
            } else {
                affected_roots(&library, &events)
            };
            roots.extend(opening_roots.iter().cloned());
            roots.extend(closing_roots.keys().cloned());
            roots.sort();
            roots.dedup();
            let mut desired = watch_paths(&library);
            for path in registered.difference(&desired) {
                let _ = watcher.unwatch(path);
            }
            registered.retain(|p| desired.contains(p));
            let mut failures = 0;
            for path in desired.difference(&registered.clone()) {
                match watcher.watch(path, RecursiveMode::NonRecursive) {
                    Ok(()) => {
                        registered.insert(path.clone());
                    }
                    Err(_) => {
                        failures += 1;
                    }
                }
            }
            state.watched.store(registered.len(), Ordering::Release);
            if failures > 0 {
                set_error(
                    &state,
                    Some(format!(
                        "{failures} 个目录暂时无法监控，将每 5 分钟补偿检查运行中的实例。"
                    )),
                );
            }
            if roots.is_empty() {
                return Ok(());
            }
            let report = GameRootScanner {
                limits: ScanLimits {
                    roots: 256,
                    ..Default::default()
                },
            }
            .scan(&roots, |_| {
                !state.shutdown.load(Ordering::Acquire)
                    && state.enabled.load(Ordering::Acquire)
                    && !control.foreground.load(Ordering::Acquire)
            });
            if report.cancelled {
                opening_roots.extend(roots);
                return Ok(());
            }
            let mut summary: ScanSummary = report.into();
            let inputs = repo.inputs()?;
            let scopes: Vec<_> = inputs
                .iter()
                .filter_map(|p| std::fs::canonicalize(p).ok())
                .collect();
            for root in &mut summary.roots {
                let names = crate::scanner::local_names(&root.path, &scopes, &mut summary.issues);
                for player in root.worlds.iter_mut().flat_map(|w| &mut w.players) {
                    if let Ok(uuid) = uuid::Uuid::parse_str(&player.uuid) {
                        if let Some(name) = names.get(&uuid) {
                            player.preferred_name = Some(name.clone());
                            player.name_source = Some("usercache".into());
                        }
                    }
                }
            }
            // Never-played configured instances may not yet have saves.
            summary.issues.retain(|i| {
                i.kind != crate::scanner::ScanIssueKind::SavesNotFound
                    || !library
                        .instances
                        .iter()
                        .any(|instance| instance.game_root.join("saves") == i.path)
            });
            {
                summary.issues.extend(
                    library
                        .issues
                        .iter()
                        .filter(|i| !roots.iter().any(|r| path_under(&i.path, r)))
                        .cloned(),
                );
            }
            let stats: Vec<_> = summary
                .roots
                .iter()
                .flat_map(|r| &r.worlds)
                .flat_map(|w| &w.players)
                .map(|p| &p.normalized_stats)
                .collect();
            let fingerprint = blake3::hash(&serde_json::to_vec(&(&summary, stats))?);
            // Scope changes and imports by another service invalidate the cached comparison.
            let changed =
                last_import.as_ref() != Some(&(roots.clone(), fingerprint, repo.scan_revision()?));
            if changed {
                repo.import(&summary, &inputs)?;
                last_import = Some((roots, fingerprint, repo.scan_revision()?));
                state.revision.fetch_add(1, Ordering::AcqRel);
            }
            // Keep watches and repeat scoped scans for late final-save writes.
            // Only retire a closing root after a successful scan past its deadline.
            closing_roots.retain(|_, deadline| Instant::now() < *deadline);
            state
                .finalizing
                .store(closing_roots.len(), Ordering::Release);
            opening_roots.clear();
            if full {
                last_full = Instant::now();
            }
            // New worlds and new stats directories need watches immediately.
            desired.extend(watch_paths(&summary));
            desired.retain(|p| {
                active_roots
                    .iter()
                    .chain(closing_roots.keys())
                    .any(|r| path_under(p, r))
            });
            for path in registered.difference(&desired) {
                let _ = watcher.unwatch(path);
            }
            registered.retain(|p| desired.contains(p));
            for path in desired.difference(&registered.clone()) {
                match watcher.watch(path, RecursiveMode::NonRecursive) {
                    Ok(()) => {
                        registered.insert(path.clone());
                    }
                    Err(_) => {
                        failures += 1;
                    }
                }
            }
            state.watched.store(registered.len(), Ordering::Release);
            if failures == 0 {
                set_error(&state, None);
            } else {
                set_error(
                    &state,
                    Some(format!(
                        "{failures} 个目录暂时无法监控，将每 5 分钟补偿检查运行中的实例。"
                    )),
                );
            }
            Ok(())
        })();
        if let Err(e) = result {
            set_error(&state, Some(format!("自动读取暂时失败，将继续重试：{e}")));
        }
        state.running.store(false, Ordering::Release);
        last_scan = Instant::now();
        pending = if opening_roots.is_empty() && closing_roots.is_empty() {
            None
        } else {
            Some(Instant::now())
        };
    }
    if sessions_ready {
        if let Ok(repo) = Repository::open(&database) {
            let _ = repo.interrupt_observed_sessions();
        }
    }
}
