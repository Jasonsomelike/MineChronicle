use crate::launcher::sync::{PclSync, SyncStatus};
use tauri::State;
#[tauri::command]
pub fn pcl_sync_status(service: State<'_, PclSync>) -> SyncStatus {
    service.status()
}
#[tauri::command]
pub fn sync_pcl_now(service: State<'_, PclSync>) {
    service.request();
}
#[tauri::command]
pub fn set_pcl_sync(enabled: bool, service: State<'_, PclSync>) -> Result<(), String> {
    service.set_enabled(enabled).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn select_pcl_launcher(path: String, service: State<'_, PclSync>) -> Result<(), String> {
    service
        .select_launcher(path.into())
        .map_err(|e| e.to_string())
}
