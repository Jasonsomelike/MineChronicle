use std::{io, path::PathBuf};

use crate::domain::{LauncherKind, ModLoader};
mod pcl;
pub mod pcl_folders;
pub mod running;
pub mod sync;
pub use pcl::*;
use serde::{Deserialize, Serialize};

/// Adapters supply metadata only; stats parsing belongs to `minecraft`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredInstance {
    pub launcher_path: PathBuf,
    pub instance_path: PathBuf,
    pub name: String,
    pub game_root: PathBuf,
    pub minecraft_version: Option<String>,
    pub mod_loader: Option<ModLoader>,
    pub isolation: String,
}

/// PCL is available in Phase 4; HMCL/Prism follow in Phase 5. Only user-authorized or narrowly
/// selected default roots may be supplied; never a whole disk traversal.
pub trait LauncherAdapter: Send + Sync {
    fn kind(&self) -> LauncherKind;
    fn discover_instances(
        &self,
        authorized_roots: &[PathBuf],
    ) -> io::Result<Vec<DiscoveredInstance>>;
}
