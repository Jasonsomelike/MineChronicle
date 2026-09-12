use crate::database::{
    activity::{ActivityFilter, StatisticsFilter, StatisticsPage, TimelinePage},
    DatabaseState, Repository,
};
use tauri::State;
#[tauri::command]
pub async fn timeline(
    filter: ActivityFilter,
    database: State<'_, DatabaseState>,
) -> Result<TimelinePage, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.timeline(&filter))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn statistics(
    filter: StatisticsFilter,
    database: State<'_, DatabaseState>,
) -> Result<StatisticsPage, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.statistics(&filter))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
