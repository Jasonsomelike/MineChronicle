use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        pub struct $name(pub i64);
    };
}
id_type!(LauncherId);
id_type!(InstanceId);
id_type!(GameRootId);
id_type!(WorldId);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LauncherKind {
    Pcl,
    Hmcl,
    Prism,
    GenericMinecraft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherInstallation {
    pub id: LauncherId,
    pub kind: LauncherKind,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModLoader {
    pub name: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: InstanceId,
    pub launcher_id: LauncherId,
    pub game_root_id: GameRootId,
    pub name: String,
    pub minecraft_version: Option<String>,
    pub mod_loader: Option<ModLoader>,
}

/// The scanner resolves filesystem identity (including Windows junctions and
/// case); persistent IDs will be assigned by the Phase 3 repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameRoot {
    pub id: GameRootId,
    pub canonical_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldStatus {
    Present,
    Degraded,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct World {
    pub id: WorldId,
    pub game_root_id: GameRootId,
    pub path: PathBuf,
    pub name: String,
    pub status: WorldStatus,
    pub data_version: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccountType {
    Online,
    Offline,
    Unknown,
}

/// Intentionally cannot represent launcher credentials or authentication tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub uuid: Uuid,
    pub preferred_name: Option<String>,
    pub aliases: Vec<String>,
    pub account_type: AccountType,
}
