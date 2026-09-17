use crate::{
    domain::{NormalizedPlayerStats, WorldStatus},
    minecraft::{level_dat::WorldMetadata, StatsLayout},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScanIssueKind {
    InaccessibleDirectory,
    InvalidRoot,
    SavesNotFound,
    CorruptedLevelDat,
    MissingLevelDat,
    CorruptedStats,
    EmptyStats,
    UnknownStatsFormat,
    InvalidPlayerUuid,
    ConflictingPlayerStats,
    ConflictingPlayTime,
    SymlinkSkipped,
    ScanLimitReached,
    InvalidPlayerCache,
    InvalidLauncherMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanIssue {
    pub kind: ScanIssueKind,
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug)]
pub struct StatsSource {
    pub path: PathBuf,
    pub layout: StatsLayout,
    pub stats: NormalizedPlayerStats,
}

#[derive(Debug)]
pub struct ScannedPlayer {
    pub uuid: Uuid,
    pub sources: Vec<StatsSource>,
    /// None means conflicting source files; no arbitrary source is selected.
    pub stats: Option<NormalizedPlayerStats>,
}

#[derive(Debug)]
pub struct ScannedWorld {
    pub canonical_path: PathBuf,
    pub name: String,
    pub status: WorldStatus,
    pub metadata: Option<WorldMetadata>,
    pub players: Vec<ScannedPlayer>,
}

#[derive(Debug)]
pub struct ScannedGameRoot {
    pub canonical_path: PathBuf,
    pub requested_paths: Vec<PathBuf>,
    pub worlds: Vec<ScannedWorld>,
    pub enumeration_complete: bool,
}

#[derive(Debug, Default)]
pub struct ScanReport {
    pub instances: Vec<crate::launcher::DiscoveredInstance>,
    pub roots: Vec<ScannedGameRoot>,
    pub issues: Vec<ScanIssue>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ScanProgress {
    pub roots_done: usize,
    pub roots_total: usize,
    pub worlds_scanned: usize,
    pub player_files_scanned: usize,
}

/// Roots a user may name explicitly in one manual scan.
pub const MAX_MANUAL_ROOTS: usize = 32;
/// Roots automatic discovery may collect, and the cap the watcher scans with.
pub const MAX_DISCOVERED_ROOTS: usize = 256;

#[derive(Debug, Clone, Copy)]
pub struct ScanLimits {
    pub roots: usize,
    pub worlds_per_root: usize,
    pub player_files_per_world: usize,
}
impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            roots: MAX_MANUAL_ROOTS,
            worlds_per_root: 10_000,
            player_files_per_world: 10_000,
        }
    }
}
