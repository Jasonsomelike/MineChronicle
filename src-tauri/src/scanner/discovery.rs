//! Search only beneath explicitly selected directories. Never follow nested links.
use super::{
    fs_access::{children, issue, regular_metadata},
    path_identity::DirectoryIdentity,
    GameRootScanner, ScanIssueKind, ScanLimits, ScanProgress, ScanReport, MAX_DISCOVERED_ROOTS,
};
use std::{collections::HashSet, path::PathBuf};

/// Directory entries inspected while looking for game roots, per input path.
const MAX_DISCOVERY_ENTRIES: usize = 10_000;
/// How deep discovery descends below a selected directory before asking the
/// user to point at the game root directly.
const MAX_DISCOVERY_DEPTH: usize = 6;

const SKIP: &[&str] = &[
    "saves",
    "assets",
    "libraries",
    "mods",
    "resourcepacks",
    "shaderpacks",
    "logs",
    "crash-reports",
    ".git",
    "node_modules",
    "screenshots",
    "backups",
    "region",
    "stats",
    "players",
    "config",
    ".mixin.out",
    "dynamic-data-pack-cache",
    "journeymap",
    "xaeroworldmap",
    "xaerominimap",
    "xaero",
    "kubejs",
    "local",
    "cache",
    "caches",
];

pub fn discover_and_scan(
    paths: &[PathBuf],
    progress: impl FnMut(&ScanProgress) -> bool,
) -> ScanReport {
    discover_and_scan_linked(paths, None, progress)
}

pub fn discover_and_scan_linked(
    paths: &[PathBuf],
    launcher: Option<&std::path::Path>,
    mut progress: impl FnMut(&ScanProgress) -> bool,
) -> ScanReport {
    let mut discovery = ScanReport::default();
    let mut roots = Vec::new();
    let mut visited = HashSet::new();
    for input in paths {
        let mut budget = MAX_DISCOVERY_ENTRIES;
        if !input.is_absolute() {
            issue(
                &mut discovery.issues,
                ScanIssueKind::InvalidRoot,
                input,
                "请选择绝对路径。",
            );
            continue;
        }
        let boundary = match DirectoryIdentity::open(input) {
            Ok(identity) if identity.canonical_path.parent().is_some() => identity.canonical_path,
            Ok(_) => {
                issue(
                    &mut discovery.issues,
                    ScanIssueKind::InvalidRoot,
                    input,
                    "不允许扫描整块磁盘。",
                );
                continue;
            }
            Err(error) => {
                issue(
                    &mut discovery.issues,
                    ScanIssueKind::InaccessibleDirectory,
                    input,
                    error.to_string(),
                );
                continue;
            }
        };
        let mut pending = vec![(boundary.clone(), 0)];
        // Membership set alongside the order-preserving vector: `contains` on the
        // Vec is a linear scan, which at the 256-root cap is the one superlinear
        // term in this loop. Measured on a synthetic 240-instance tree the scan
        // itself was only 0.013 ms, so this is defensive rather than a fix for an
        // observed bottleneck - the pass is dominated by per-instance syscalls.
        let mut known_roots: HashSet<PathBuf> = HashSet::new();
        while let Some((directory, depth)) = pending.pop() {
            if !visited.insert(directory.clone()) {
                continue;
            }
            let pcl = crate::launcher::PclAdapter.scan_linked_container(
                &directory,
                &boundary,
                launcher,
                || {
                    progress(&ScanProgress {
                        roots_total: roots.len(),
                        ..Default::default()
                    })
                },
            );
            for instance in &pcl.instances {
                if known_roots.insert(instance.game_root.clone()) {
                    roots.push(instance.game_root.clone());
                }
            }
            discovery.instances.extend(pcl.instances);
            discovery.issues.extend(pcl.issues);
            if regular_metadata(&directory.join("saves"), &mut discovery.issues)
                .is_some_and(|m| m.is_dir())
                && known_roots.insert(directory.clone())
            {
                roots.push(directory.clone());
            }
            if !progress(&ScanProgress {
                roots_total: roots.len(),
                ..Default::default()
            }) {
                let mut cancelled = GameRootScanner::default().scan(&roots, |_| false);
                cancelled.issues.extend(discovery.issues);
                return cancelled;
            }
            if roots.len() >= MAX_DISCOVERED_ROOTS || budget == 0 {
                issue(
                    &mut discovery.issues,
                    ScanIssueKind::ScanLimitReached,
                    &directory,
                    "自动发现达到 256 个根目录或 10000 个条目上限，请缩小目录范围。",
                );
                pending.clear();
                break;
            }
            let version_container =
                regular_metadata(&directory.join("versions"), &mut discovery.issues)
                    .is_some_and(|m| m.is_dir());
            let version_instance = directory
                .parent()
                .and_then(|p| p.file_name())
                .is_some_and(|n| n == "versions");
            let (entries, _) = children(&directory, budget, &mut discovery.issues);
            budget = budget.saturating_sub(entries.len());
            for entry in entries.into_iter().rev() {
                // A version root is terminal except for an explicit nested
                // .minecraft. Containers may also contain sibling instances.
                if (version_container
                    && !entry
                        .file_name()
                        .is_some_and(|n| n == "versions" || n == "instances" || n == ".minecraft"))
                    || (version_instance && !entry.file_name().is_some_and(|n| n == ".minecraft"))
                {
                    continue;
                }
                if entry.file_name().is_some_and(|n| {
                    SKIP.contains(&n.to_string_lossy().to_ascii_lowercase().as_str())
                }) {
                    continue;
                }
                if regular_metadata(&entry, &mut discovery.issues).is_some_and(|m| m.is_dir()) {
                    if depth < MAX_DISCOVERY_DEPTH {
                        pending.push((entry, depth + 1));
                    } else {
                        issue(
                            &mut discovery.issues,
                            ScanIssueKind::ScanLimitReached,
                            &entry,
                            "自动发现最多深入 6 层，请直接添加更深的目录。",
                        );
                    }
                }
            }
        }
        if !roots.iter().any(|root| root.starts_with(&boundary)) {
            issue(
                &mut discovery.issues,
                ScanIssueKind::SavesNotFound,
                input,
                "此目录范围内未发现包含 saves 的游戏根目录。",
            );
        }
        if roots.len() >= MAX_DISCOVERED_ROOTS {
            break;
        }
    }
    let mut report = GameRootScanner {
        limits: ScanLimits {
            roots: MAX_DISCOVERED_ROOTS,
            ..Default::default()
        },
    }
    .scan(&roots, progress);
    report.issues.extend(discovery.issues);
    // A configured, never-played PCL instance need not have a saves directory.
    // Keep enumeration incomplete so old history is never inferred to be deleted.
    report.issues.retain(|issue| {
        issue.kind != ScanIssueKind::SavesNotFound
            || !discovery
                .instances
                .iter()
                .any(|instance| instance.game_root.join("saves") == issue.path)
    });
    report.instances = discovery.instances;
    report
}
