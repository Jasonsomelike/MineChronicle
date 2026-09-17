use crate::database::{DatabaseState, Repository};
use tauri::State;

/// Both commands open the archive, so they run off the main thread.
#[tauri::command]
pub async fn self_player_identity(
    database: State<'_, DatabaseState>,
) -> Result<Option<String>, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|repo| repo.setting("self_player_identity"))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_self_player_identity(
    identifier: String,
    database: State<'_, DatabaseState>,
) -> Result<(), String> {
    let value = identifier.trim().to_owned();
    if value.len() > 256 {
        return Err("玩家名称或 UUID 过长".into());
    }
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Repository::open(&path)
            .and_then(|repo| repo.set_setting("self_player_identity", &value))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
