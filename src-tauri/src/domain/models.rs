use serde::{Deserialize, Serialize};

/// Which launcher produced an instance's metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LauncherKind {
    Pcl,
    Hmcl,
    Prism,
    GenericMinecraft,
}

/// Mod loader recorded in an instance's version JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModLoader {
    pub name: String,
    pub version: Option<String>,
}

/// How complete a world's on-disk data is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldStatus {
    Present,
    Degraded,
    Missing,
}
