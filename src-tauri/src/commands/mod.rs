use serde::Serialize;
mod activity;
mod startup;
pub use startup::*;
mod health;
pub use activity::*;
mod pcl_sync;
pub use pcl_sync::*;
mod library;
mod runtime;
mod scan;
mod tracking;
mod preferences;
pub use preferences::*;
pub use health::*;
pub use library::*;
pub use runtime::*;
pub use scan::*;
pub use tracking::*;

#[derive(Debug, Serialize)]
pub struct PhaseStatus {
    pub phase: u8,
    pub offline: bool,
    pub scanning_available: bool,
}

#[tauri::command]
pub fn phase_status() -> PhaseStatus {
    PhaseStatus {
        phase: 10,
        offline: true,
        scanning_available: true,
    }
}
