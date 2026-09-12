use crate::database::{DatabaseState, Repository};
use tauri::State;

#[tauri::command]
pub fn self_player_identity(database: State<'_, DatabaseState>) -> Result<Option<String>, String> {
    Repository::open(&database.path)
        .and_then(|repo| repo.setting("self_player_identity"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_self_player_identity(
    identifier: String,
    database: State<'_, DatabaseState>,
) -> Result<(), String> {
    let value = identifier.trim();
    if value.len() > 256 {
        return Err("玩家名称或 UUID 过长".into());
    }
    Repository::open(&database.path)
        .and_then(|repo| repo.set_setting("self_player_identity", value))
        .map_err(|e| e.to_string())
}
