use super::{
    fs_access::{children, issue, regular_metadata},
    path_identity::{DirectoryIdentity, FileIdentity},
    ScanIssueKind, ScanLimits, ScanProgress, ScanReport, ScannedGameRoot, WorldScanner,
};
use std::{collections::HashMap, path::PathBuf};

#[derive(Default)]
pub struct GameRootScanner {
    pub limits: ScanLimits,
}

impl GameRootScanner {
    /// Only explicit game roots, never a launcher search or whole-disk traversal.
    pub fn scan(
        &self,
        requested: &[PathBuf],
        mut on_progress: impl FnMut(&ScanProgress) -> bool,
    ) -> ScanReport {
        let mut report = ScanReport::default();
        let mut handles = Vec::new();
        let mut seen: HashMap<FileIdentity, usize> = HashMap::new();
        for (count, path) in requested.iter().enumerate() {
            if count >= self.limits.roots {
                issue(
                    &mut report.issues,
                    ScanIssueKind::ScanLimitReached,
                    path,
                    "游戏根目录数量超过本次扫描上限。",
                );
                break;
            }
            if !path.is_absolute() {
                issue(
                    &mut report.issues,
                    ScanIssueKind::InvalidRoot,
                    path,
                    "请提供游戏根目录的绝对路径。",
                );
                continue;
            }
            let identity = match DirectoryIdentity::open(path) {
                Ok(identity) => identity,
                Err(error) => {
                    issue(
                        &mut report.issues,
                        ScanIssueKind::InaccessibleDirectory,
                        path,
                        error.to_string(),
                    );
                    continue;
                }
            };
            if identity.canonical_path.parent().is_none() {
                issue(
                    &mut report.issues,
                    ScanIssueKind::InvalidRoot,
                    path,
                    "不允许扫描整块磁盘，请选择具体游戏根目录。",
                );
                continue;
            }
            if let Some(&index) = seen.get(&identity.key) {
                report.roots[index].requested_paths.push(path.clone());
                continue;
            }
            seen.insert(identity.key.clone(), report.roots.len());
            report.roots.push(ScannedGameRoot {
                canonical_path: identity.canonical_path.clone(),
                requested_paths: vec![path.clone()],
                worlds: Vec::new(),
                enumeration_complete: false,
            });
            handles.push(identity);
        }
        let mut progress = ScanProgress {
            roots_total: report.roots.len(),
            ..Default::default()
        };
        if !on_progress(&progress) {
            report.cancelled = true;
            return report;
        }
        for root in &mut report.roots {
            let saves = root.canonical_path.join("saves");
            let issues_before = report.issues.len();
            let Some(metadata) = regular_metadata(&saves, &mut report.issues) else {
                if report.issues.len() == issues_before {
                    issue(
                        &mut report.issues,
                        ScanIssueKind::SavesNotFound,
                        &saves,
                        "此根目录下没有 saves 文件夹。",
                    );
                }
                progress.roots_done += 1;
                if !on_progress(&progress) {
                    report.cancelled = true;
                    break;
                }
                continue;
            };
            if !metadata.is_dir() {
                issue(
                    &mut report.issues,
                    ScanIssueKind::InaccessibleDirectory,
                    &saves,
                    "saves 不是文件夹。",
                );
                progress.roots_done += 1;
                if !on_progress(&progress) {
                    report.cancelled = true;
                    break;
                }
                continue;
            }
            let (paths, complete) =
                children(&saves, self.limits.worlds_per_root, &mut report.issues);
            root.enumeration_complete = complete;
            for path in paths {
                if !on_progress(&progress) {
                    report.cancelled = true;
                    root.enumeration_complete = false;
                    break;
                }
                let outcome =
                    WorldScanner.scan(&path, self.limits.player_files_per_world, &mut || {
                        progress.player_files_scanned += 1;
                        on_progress(&progress)
                    });
                progress.worlds_scanned += 1;
                // A damaged candidate must not later be mistaken for a deleted
                // world by a repository consuming this report. Missing metadata
                // with successfully parsed stats is the explicit degraded case.
                if outcome
                    .issues
                    .iter()
                    .any(|i| i.kind == ScanIssueKind::ScanLimitReached)
                    || (outcome.world.is_none()
                        && outcome
                            .issues
                            .iter()
                            .any(|i| i.kind != ScanIssueKind::MissingLevelDat))
                {
                    root.enumeration_complete = false;
                }
                report.issues.extend(outcome.issues);
                if outcome.cancelled {
                    report.cancelled = true;
                    root.enumeration_complete = false;
                    break;
                }
                if let Some(world) = outcome.world {
                    root.worlds.push(world);
                }
            }
            if report.cancelled {
                break;
            }
            progress.roots_done += 1;
            if !on_progress(&progress) {
                report.cancelled = true;
                break;
            }
        }
        // Handles deliberately survive the full scan, preventing file-ID reuse.
        drop(handles);
        report
    }
}
