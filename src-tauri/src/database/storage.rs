//! A small location file stays in app data; the archive itself can live on another drive.
use super::DbResult;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
struct Location {
    database_path: PathBuf,
}

pub fn archive_path(app_data: &Path) -> DbResult<PathBuf> {
    let locator = app_data.join("storage.json");
    if !locator.exists() {
        return Ok(app_data.join("minechronicle.sqlite3"));
    }
    if fs::metadata(&locator)?.len() > 16_384 {
        return Err("档案位置配置过大".into());
    }
    let location: Location = serde_json::from_slice(&fs::read(locator)?)?;
    if !location.database_path.is_absolute() || !location.database_path.is_file() {
        return Err("配置的档案不可用，请检查对应磁盘。不会自动创建空档案。".into());
    }
    Ok(location.database_path)
}

/// Snapshot through SQLite (including committed WAL content), then activate only
/// after integrity checks. The source remains an untouched migration backup.
pub fn migrate_archive(app_data: &Path, target: &Path) -> DbResult<PathBuf> {
    let source = archive_path(app_data)?;
    if source == target {
        return Ok(source);
    }
    if !target.is_absolute() || target.file_name().is_none() {
        return Err("需要明确的绝对数据库路径".into());
    }
    if target.exists() || app_data.join("storage.json").exists() {
        return Err("目标档案或位置配置已经存在，未覆盖任何文件。".into());
    }
    let connection = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let before: i64 = connection.query_row("PRAGMA data_version", [], |r| r.get(0))?;
    let parent = target.parent().ok_or("档案缺少父目录")?;
    fs::create_dir_all(parent)?;
    let temporary = target.with_extension("migrating.sqlite3");
    if temporary.exists() {
        return Err("存在未完成的迁移文件，请先检查该文件。".into());
    }
    connection.execute("VACUUM INTO ?", [temporary.to_str().ok_or("路径无法编码")?])?;
    let copy = Connection::open_with_flags(&temporary, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = copy.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let foreign_keys: i64 =
        copy.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
    let after: i64 = connection.query_row("PRAGMA data_version", [], |r| r.get(0))?;
    if integrity != "ok" || foreign_keys != 0 || before != after {
        return Err("迁移校验失败或原档案在迁移期间发生变化，未切换位置。".into());
    }
    for table in [
        "worlds",
        "players",
        "world_players",
        "stat_snapshots",
        "settings",
        "observed_sessions",
        "player_aliases",
        "tracked_deltas",
        "tracking_cursors",
        "stat_rollbacks",
        "clone_candidates",
        "world_lineages",
        "clone_evidence",
        "lineage_details",
        "health_reviews",
        "analysis_status",
    ] {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
            [table],
            |r| r.get(0),
        )?;
        if !exists {
            continue;
        }
        let query = format!("SELECT count(*) FROM {table}");
        let original: i64 = connection.query_row(&query, [], |r| r.get(0))?;
        let copied: i64 = copy.query_row(&query, [], |r| r.get(0))?;
        if original != copied {
            return Err("迁移记录数校验失败，未切换位置。".into());
        }
    }
    drop(copy);
    fs::rename(&temporary, target)?;
    let bytes = serde_json::to_vec_pretty(&Location {
        database_path: target.to_owned(),
    })?;
    let mut locator = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(app_data.join("storage.json"))?;
    locator.write_all(&bytes)?;
    locator.sync_all()?;
    Ok(target.to_owned())
}
