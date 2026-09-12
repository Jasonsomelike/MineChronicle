use crate::database::{read_models::ScanSummary, DatabaseState, Repository};
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize)]
pub struct Library {
    pub report: ScanSummary,
    pub inputs: Vec<PathBuf>,
}

#[tauri::command]
pub async fn load_library(database: State<'_, DatabaseState>) -> Result<Library, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let repository = Repository::open(&path).map_err(|e| e.to_string())?;
        Ok(Library {
            report: repository.load().map_err(|e| e.to_string())?,
            inputs: repository.inputs().map_err(|e| e.to_string())?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_player_alias(
    uuid: String,
    name: String,
    database: State<'_, DatabaseState>,
) -> Result<ScanSummary, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut repository = Repository::open(&path).map_err(|e| e.to_string())?;
        repository
            .set_alias(&uuid, &name)
            .map_err(|e| e.to_string())?;
        repository.load().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
