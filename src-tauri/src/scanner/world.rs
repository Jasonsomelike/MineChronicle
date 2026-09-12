use super::{
    fs_access::{children, issue, regular_metadata},
    ScanIssue, ScanIssueKind, ScannedPlayer, ScannedWorld, StatsSource,
};
use crate::{
    domain::WorldStatus,
    minecraft::{level_dat::LevelDatReader, DefaultStatsLocationResolver, StatsLocationResolver},
};
use std::{collections::BTreeMap, path::Path};
use uuid::Uuid;

#[derive(Debug, Default)]
pub struct WorldScanOutcome {
    pub world: Option<ScannedWorld>,
    pub issues: Vec<ScanIssue>,
    pub cancelled: bool,
}

pub struct WorldScanner;
impl WorldScanner {
    pub fn scan(
        &self,
        world: &Path,
        file_limit: usize,
        on_file: &mut dyn FnMut() -> bool,
    ) -> WorldScanOutcome {
        let mut result = WorldScanOutcome::default();
        let Some(world_meta) = regular_metadata(world, &mut result.issues) else {
            return result;
        };
        if !world_meta.is_dir() {
            return result;
        }
        let level_path = world.join("level.dat");
        let before_level_issues = result.issues.len();
        let level_meta = regular_metadata(&level_path, &mut result.issues);
        let metadata = match level_meta {
            Some(_) => match LevelDatReader.read(&level_path) {
                Ok(metadata) => Some(metadata),
                Err(error) => {
                    issue(
                        &mut result.issues,
                        ScanIssueKind::CorruptedLevelDat,
                        &level_path,
                        error.to_string(),
                    );
                    None
                }
            },
            None => None,
        };
        let level_unreadable = result.issues.len() > before_level_issues;
        let mut sources: BTreeMap<Uuid, Vec<StatsSource>> = BTreeMap::new();
        let mut visited = 0;
        for location in DefaultStatsLocationResolver.locations(world) {
            // Guard players itself: checking only players/stats could follow a
            // junction in an intermediate component before detecting it.
            if location.layout == crate::minecraft::StatsLayout::Modern26 {
                let Some(parent) = regular_metadata(&world.join("players"), &mut result.issues)
                else {
                    continue;
                };
                if !parent.is_dir() {
                    continue;
                }
            }
            let Some(directory) = regular_metadata(&location.directory, &mut result.issues) else {
                continue;
            };
            if !directory.is_dir() {
                issue(
                    &mut result.issues,
                    ScanIssueKind::InaccessibleDirectory,
                    &location.directory,
                    "统计目录不是文件夹。",
                );
                continue;
            }
            let (paths, _) = children(
                &location.directory,
                file_limit.saturating_sub(visited),
                &mut result.issues,
            );
            visited += paths.len();
            for path in paths {
                if !path
                    .extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| s.eq_ignore_ascii_case("json"))
                {
                    continue;
                }
                if !on_file() {
                    result.cancelled = true;
                    return result;
                }
                let Some(file) = regular_metadata(&path, &mut result.issues) else {
                    continue;
                };
                if !file.is_file() {
                    continue;
                }
                let uuid = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .and_then(|s| Uuid::parse_str(s).ok());
                let Some(uuid) = uuid else {
                    issue(
                        &mut result.issues,
                        ScanIssueKind::InvalidPlayerUuid,
                        &path,
                        "统计文件名不是有效的玩家 UUID。",
                    );
                    continue;
                };
                match super::stable_stats::read_stats(&path) {
                    Ok(stats) => {
                        if !stats.warnings.is_empty() {
                            issue(
                                &mut result.issues,
                                ScanIssueKind::ConflictingPlayTime,
                                &path,
                                "同一文件中的游玩时长字段不一致，保留解析优先级结果并提示复核。",
                            );
                        }
                        sources.entry(uuid).or_default().push(StatsSource {
                            path,
                            layout: location.layout,
                            stats,
                        });
                    }
                    Err((kind, message)) => {
                        issue(&mut result.issues, kind, &path, message);
                    }
                }
            }
        }
        if metadata.is_none() && sources.is_empty() {
            return result;
        }
        if metadata.is_none() && !level_unreadable {
            issue(
                &mut result.issues,
                ScanIssueKind::MissingLevelDat,
                &level_path,
                "缺少 level.dat，使用目录名与有效统计识别降级世界。",
            );
        }
        let mut players = Vec::new();
        for (uuid, sources) in sources {
            // This equality preserves every counter and extension, not just time.
            // Reordered identical files are one player; disagreement stays unresolved.
            let stats = sources
                .first()
                .filter(|first| sources.iter().all(|source| source.stats == first.stats))
                .map(|first| first.stats.clone());
            if stats.is_none() {
                issue(
                    &mut result.issues,
                    ScanIssueKind::ConflictingPlayerStats,
                    world,
                    format!("玩家 {uuid} 的多个统计来源不一致，未自动选择或相加。"),
                );
            }
            players.push(ScannedPlayer {
                uuid,
                sources,
                stats,
            });
        }
        let name = metadata
            .as_ref()
            .and_then(|m| m.level_name.clone())
            .unwrap_or_else(|| {
                world
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
        result.world = Some(ScannedWorld {
            canonical_path: world.to_owned(),
            name,
            status: if metadata.is_some() {
                WorldStatus::Present
            } else {
                WorldStatus::Degraded
            },
            metadata,
            players,
        });
        result
    }
}
