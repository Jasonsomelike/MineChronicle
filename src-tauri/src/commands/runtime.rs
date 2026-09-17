use crate::database::{DatabaseState, Repository};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct RuntimeInfo {
    pub version: &'static str,
    pub executable: PathBuf,
    pub database_path: PathBuf,
    pub embedded_assets: bool,
    pub pcl_instances: usize,
}

/// Opens the archive and loads the whole library, so it runs off the main thread.
#[tauri::command]
pub async fn runtime_info(database: State<'_, DatabaseState>) -> Result<RuntimeInfo, String> {
    let path = database.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let library = Repository::open(&path)
            .and_then(|r| r.load())
            .map_err(|e| e.to_string())?;
        Ok(RuntimeInfo {
            version: env!("CARGO_PKG_VERSION"),
            executable: std::env::current_exe().map_err(|e| e.to_string())?,
            database_path: path,
            embedded_assets: !tauri::is_dev(),
            pcl_instances: library.instances.len(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Limited local diagnostics emitted by the actual WebView after rendering.
/// No arbitrary filenames, page contents, player data, or network writes.
#[derive(Debug, Serialize, Deserialize)]
pub struct ViewReceipt {
    pub frontend_version: String,
    pub page_url: String,
    pub database_path: String,
    pub pcl_instances: usize,
    pub pcl_panel_visible: bool,
}
/// Writes a small diagnostic file, so it also stays off the main thread.
#[tauri::command]
pub async fn acknowledge_view(
    receipt: ViewReceipt,
    database: State<'_, DatabaseState>,
) -> Result<(), String> {
    if receipt.frontend_version.len() > 32
        || receipt.page_url.len() > 512
        || receipt.database_path.len() > 4096
    {
        return Err("诊断字段超出长度限制".into());
    }
    let path = database
        .path
        .parent()
        .ok_or("档案缺少父目录")?
        .join("last-view.json");
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = serde_json::to_vec_pretty(&receipt).map_err(|e| e.to_string())?;
        std::fs::write(path, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
