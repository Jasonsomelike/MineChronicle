use crate::database::{health::HealthSummary, DatabaseState, Repository};
use tauri::State;
#[tauri::command]
pub async fn health_summary(database: State<'_, DatabaseState>) -> Result<HealthSummary, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|r| r.health_summary())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn review_health(
    key: String,
    reviewed: bool,
    database: State<'_, DatabaseState>,
) -> Result<HealthSummary, String> {
    if key.len() != 64 {
        return Err("问题标识无效".into());
    }
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|repo| repo.review_health(&key, reviewed))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn decide_clone(
    id: i64,
    decision: String,
    parent: Option<i64>,
    database: State<'_, DatabaseState>,
) -> Result<HealthSummary, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut repo = Repository::open(&path)?;
        repo.decide_clone(id, &decision, parent)?;
        repo.health_summary()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
