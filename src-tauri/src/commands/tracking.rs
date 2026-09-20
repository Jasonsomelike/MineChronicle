use crate::{
    database::{DatabaseState, Repository},
    tracker::watcher::{Tracker, TrackerStatus},
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::State;
type CachedObservation = Option<(
    PathBuf,
    crate::database::observation_cache::ObservationCache,
)>;
#[derive(Clone, Default)]
pub struct ObservationService(Arc<Mutex<CachedObservation>>);
#[tauri::command]
pub async fn observed_sessions_page(
    page: i64,
    query: Option<crate::database::sessions::ObservationQuery>,
    database: State<'_, DatabaseState>,
    cache: State<'_, ObservationService>,
) -> Result<crate::database::sessions::ObservedSessionsPage, String> {
    let path = database.path.clone();
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = cache.0.lock().map_err(|e| e.to_string())?;
        if guard.as_ref().is_none_or(|(p, _)| p != &path) {
            *guard = Some((
                path.clone(),
                crate::database::observation_cache::ObservationCache::open(&path)
                    .map_err(|e| e.to_string())?,
            ));
        }
        guard
            .as_mut()
            .ok_or("观测缓存不可用")?
            .1
            .query(page, &query.unwrap_or_default())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
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
/// The range a manual end time may fall in, so the dialog can constrain input
/// before submitting. The same bounds are recomputed inside the write: a form
/// hint is not a guarantee, because the row can change while the dialog is open.
#[tauri::command]
pub async fn observed_session_bounds(
    id: i64,
    database: State<'_, DatabaseState>,
) -> Result<crate::database::sessions::ManualEndBounds, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.manual_end_bounds(id))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Record a user-supplied end time for a session the observer never saw end.
///
/// A separate connection from the observation cache, which is what makes the
/// edit visible: the cache decides whether to rebuild from `PRAGMA data_version`,
/// a counter that only advances when another connection commits.
#[tauri::command]
pub async fn set_observed_session_end(
    id: i64,
    ended_at: String,
    database: State<'_, DatabaseState>,
) -> Result<(), String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.set_session_end(id, &ended_at))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Undo a manual end time, returning the session to the interrupted state.
#[tauri::command]
pub async fn clear_observed_session_end(
    id: i64,
    database: State<'_, DatabaseState>,
) -> Result<(), String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.clear_session_end(id))
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
