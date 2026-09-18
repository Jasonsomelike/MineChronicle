use crate::{
    database::{DatabaseState, Repository},
    tracker::watcher::{Tracker, TrackerStatus},
};
use tauri::State;
#[tauri::command]
pub async fn observed_sessions(
    database: State<'_, DatabaseState>,
) -> Result<Vec<crate::database::sessions::ObservedSession>, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            // The pseudo figure needs the deltas as well as the sessions, and
            // the session list is the only place it is shown, so it is computed
            // here instead of forcing the frontend to correlate two calls.
            .and_then(|r| r.observed_sessions_with_pseudo())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn tracking_status(tracker: State<'_, Tracker>) -> TrackerStatus {
    tracker.status()
}
#[tauri::command]
pub fn set_tracking_enabled(
    enabled: bool,
    tracker: State<'_, Tracker>,
) -> Result<TrackerStatus, String> {
    tracker.set_enabled(enabled).map_err(|e| e.to_string())?;
    Ok(tracker.status())
}
#[tauri::command]
pub async fn tracking_summary(
    database: State<'_, DatabaseState>,
) -> Result<crate::database::tracking::TrackingSummary, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.tracking_summary())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
