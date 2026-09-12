use crate::{
    domain::WorldStatus,
    minecraft::level_dat::WorldMetadata,
    scanner::{ScanIssue, ScanReport},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSummary {
    pub uuid: String,
    pub preferred_name: Option<String>,
    pub name_source: Option<String>,
    pub initial_play_ticks: Option<String>,
    #[serde(skip)]
    pub normalized_stats: Option<crate::domain::NormalizedPlayerStats>,
    /// Decimal string: preserve every i64 tick through JavaScript IPC.
    pub play_ticks: Option<String>,
    pub source_paths: Vec<PathBuf>,
    pub conflicting: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSummary {
    pub path: PathBuf,
    pub name: String,
    pub status: WorldStatus,
    pub data_version: Option<i32>,
    pub minecraft_version: Option<String>,
    #[serde(default)]
    pub metadata_fingerprint: Option<String>,
    pub players: Vec<PlayerSummary>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootSummary {
    pub path: PathBuf,
    pub requested_paths: Vec<PathBuf>,
    pub enumeration_complete: bool,
    pub worlds: Vec<WorldSummary>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanSummary {
    pub instances: Vec<crate::launcher::DiscoveredInstance>,
    pub roots: Vec<RootSummary>,
    pub issues: Vec<ScanIssue>,
    pub cancelled: bool,
    pub saved: bool,
    pub database_path: Option<PathBuf>,
    pub last_scan: Option<String>,
    pub historical_ticks: String,
}

impl From<ScanReport> for ScanSummary {
    fn from(report: ScanReport) -> Self {
        Self {
            instances: report.instances,
            cancelled: report.cancelled,
            saved: false,
            database_path: None,
            last_scan: None,
            historical_ticks: "0".into(),
            issues: report.issues,
            roots: report
                .roots
                .into_iter()
                .map(|root| RootSummary {
                    path: root.canonical_path,
                    requested_paths: root.requested_paths,
                    enumeration_complete: root.enumeration_complete,
                    worlds: root
                        .worlds
                        .into_iter()
                        .map(|world| {
                            let metadata_fingerprint =
                                world.metadata.as_ref().and_then(WorldMetadata::fingerprint);
                            let (data_version, minecraft_version) = match world.metadata {
                                Some(WorldMetadata {
                                    data_version,
                                    minecraft_version,
                                    ..
                                }) => (data_version, minecraft_version),
                                None => (None, None),
                            };
                            WorldSummary {
                                path: world.canonical_path,
                                name: world.name,
                                status: world.status,
                                data_version,
                                minecraft_version,
                                metadata_fingerprint,
                                players: world
                                    .players
                                    .into_iter()
                                    .map(|player| PlayerSummary {
                                        uuid: player.uuid.to_string(),
                                        preferred_name: None,
                                        name_source: None,
                                        initial_play_ticks: None,
                                        normalized_stats: player.stats.clone(),
                                        conflicting: player.stats.is_none(),
                                        play_ticks: player.stats.map(|s| s.play_ticks.to_string()),
                                        source_paths: player
                                            .sources
                                            .into_iter()
                                            .map(|s| s.path)
                                            .collect(),
                                    })
                                    .collect(),
                            }
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}
