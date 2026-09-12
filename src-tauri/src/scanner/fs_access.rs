use super::{path_identity::is_link, ScanIssue, ScanIssueKind};
use std::{
    fs,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub(super) fn issue(
    issues: &mut Vec<ScanIssue>,
    kind: ScanIssueKind,
    path: &Path,
    message: impl Into<String>,
) {
    issues.push(ScanIssue {
        kind,
        path: path.to_owned(),
        message: message.into(),
    });
}

/// Return None for absent paths, and explicitly report inaccessible paths/links.
pub(super) fn regular_metadata(path: &Path, issues: &mut Vec<ScanIssue>) -> Option<fs::Metadata> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if is_link(&metadata) => {
            issue(
                issues,
                ScanIssueKind::SymlinkSkipped,
                path,
                "未遍历根目录内的符号链接或目录联接；请直接添加其目标游戏根目录。",
            );
            None
        }
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            issue(
                issues,
                ScanIssueKind::InaccessibleDirectory,
                path,
                error.to_string(),
            );
            None
        }
    }
}

/// One level only, no link following and no traversal into region directories.
pub(super) fn children(
    path: &Path,
    limit: usize,
    issues: &mut Vec<ScanIssue>,
) -> (Vec<PathBuf>, bool) {
    let mut result = Vec::new();
    let mut complete = true;
    for (count, entry) in WalkDir::new(path)
        .follow_links(false)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .enumerate()
    {
        if count >= limit {
            issue(
                issues,
                ScanIssueKind::ScanLimitReached,
                path,
                "目录条目超过本次扫描上限，结果不完整。",
            );
            complete = false;
            break;
        }
        match entry {
            Ok(entry) => result.push(entry.into_path()),
            Err(error) => {
                issue(
                    issues,
                    ScanIssueKind::InaccessibleDirectory,
                    error.path().unwrap_or(path),
                    error.to_string(),
                );
                complete = false;
            }
        }
    }
    result.sort();
    (result, complete)
}
