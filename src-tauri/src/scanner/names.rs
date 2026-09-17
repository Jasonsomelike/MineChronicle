use super::{
    fs_access::{issue, regular_metadata},
    ScanIssue, ScanIssueKind,
};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub fn valid_player_name(name: &str) -> bool {
    !name.is_empty()
        && name == name.trim()
        && name.chars().count() <= 64
        && !name.chars().any(char::is_control)
}

/// Applies local usercache names to every player of every root, recording any
/// cache problems as scan issues.
///
/// This exact loop previously appeared three times: in the manual scan command,
/// in the tracker's automatic pass, and in PCL sync. The only difference between
/// them was how `scopes` was built, so that stays with the caller.
pub fn apply_local_names(
    roots: &mut [crate::database::read_models::RootSummary],
    scopes: &[PathBuf],
    issues: &mut Vec<ScanIssue>,
) {
    for root in roots.iter_mut() {
        let names = local_names(&root.path, scopes, issues);
        for player in root.worlds.iter_mut().flat_map(|world| &mut world.players) {
            if let Ok(uuid) = Uuid::parse_str(&player.uuid) {
                if let Some(name) = names.get(&uuid) {
                    player.preferred_name = Some(name.clone());
                    player.name_source = Some("usercache".into());
                }
            }
        }
    }
}

/// Only usercache.json is read. Nearest cache wins; ancestors outside the chosen scope are excluded.
pub fn local_names(
    root: &Path,
    scopes: &[PathBuf],
    issues: &mut Vec<ScanIssue>,
) -> HashMap<Uuid, String> {
    let boundary = scopes
        .iter()
        .filter(|scope| root.starts_with(scope))
        .min_by_key(|p| p.components().count())
        .map(PathBuf::as_path)
        .unwrap_or(root);
    let mut result = HashMap::new();
    for directory in root.ancestors().take_while(|p| p.starts_with(boundary)) {
        let path = directory.join("usercache.json");
        let Some(meta) = regular_metadata(&path, issues) else {
            continue;
        };
        let read = || -> Result<Vec<serde_json::Value>, Box<dyn std::error::Error>> {
            if !meta.is_file() || meta.len() > 2 * 1024 * 1024 {
                return Err("玩家名称缓存超过限制或不是文件".into());
            }
            let mut bytes = Vec::new();
            File::open(&path)?
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err("玩家名称缓存超过限制".into());
            }
            Ok(serde_json::from_slice(&bytes)?)
        };
        match read() {
            Ok(entries) => {
                let mut names: HashMap<Uuid, Option<String>> = HashMap::new();
                for entry in entries {
                    let Some(uuid) = entry
                        .get("uuid")
                        .and_then(|v| v.as_str())
                        .and_then(|v| Uuid::parse_str(v).ok())
                    else {
                        continue;
                    };
                    let Some(name) = entry
                        .get("name")
                        .and_then(|v| v.as_str())
                        .filter(|n| valid_player_name(n))
                    else {
                        continue;
                    };
                    names
                        .entry(uuid)
                        .and_modify(|old| {
                            if old.as_deref() != Some(name) {
                                *old = None;
                            }
                        })
                        .or_insert_with(|| Some(name.to_owned()));
                }
                for (uuid, name) in names {
                    if let Some(name) = name {
                        result.entry(uuid).or_insert(name);
                    } else {
                        issue(
                            issues,
                            ScanIssueKind::InvalidPlayerCache,
                            &path,
                            "同一缓存中存在相互冲突的玩家名称，未采用该名称。",
                        );
                    }
                }
            }
            Err(_) => issue(
                issues,
                ScanIssueKind::InvalidPlayerCache,
                &path,
                "玩家名称缓存无法读取或格式无效；仍使用 UUID 识别玩家。",
            ),
        }
    }
    result
}
