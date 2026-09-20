//! App-owned SQLite snapshots. Policy lives outside the archive being restored.
use super::{DbResult, Repository};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupInfo {
    pub path: PathBuf,
    pub created_at: String,
    pub kind: String,
    pub bytes: u64,
    pub worlds: i64,
    pub observations: i64,
    pub schema: i64,
    pub digest: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BackupPolicy {
    pub enabled: bool,
    pub retention: usize,
    pub directory: PathBuf,
    pub last_day: String,
    pub last_digest: String,
    pub error: String,
    pub last_attempt: String,
    pub last_success: String,
    pub records: Vec<BackupInfo>,
}
impl Default for BackupPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            retention: 7,
            directory: PathBuf::new(),
            last_day: String::new(),
            last_digest: String::new(),
            error: String::new(),
            last_attempt: String::new(),
            last_success: String::new(),
            records: Vec::new(),
        }
    }
}
#[derive(Clone)]
pub struct BackupStore {
    pub app_data: PathBuf,
    pub database: PathBuf,
}
#[derive(Serialize, Deserialize)]
struct PendingRestore {
    target: PathBuf,
    staged: PathBuf,
    rollback: PathBuf,
    digest: String,
    #[serde(default)]
    source: PathBuf,
    #[serde(default)]
    scheduled_at: String,
}

#[derive(Serialize)]
pub struct PendingRestoreInfo {
    pub source: PathBuf,
    pub scheduled_at: String,
}

pub fn atomic_json(path: &Path, value: &impl Serialize) -> DbResult<()> {
    let temporary = path.with_extension("writing");
    let mut file = fs::File::create(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.sync_all()?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<_> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    #[cfg(not(windows))]
    fs::rename(&temporary, path)?;
    Ok(())
}
fn clock() -> DbResult<(String, String)> {
    Ok(Connection::open_in_memory()?.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'),date('now','localtime')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}
fn digest(path: &Path) -> DbResult<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = blake3::Hasher::new();
    let mut bytes = [0; 65536];
    loop {
        let n = std::io::Read::read(&mut file, &mut bytes)?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
    }
    Ok(hash.finalize().to_hex().to_string())
}
pub fn inspect(path: &Path) -> DbResult<BackupInfo> {
    if !path.is_absolute() || !path.is_file() {
        return Err("请选择已有的完整档案文件".into());
    }
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    c.busy_timeout(Duration::from_secs(5))?;
    let integrity: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err("档案完整性校验失败".into());
    }
    let schema: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if schema < 1 || schema > super::latest_version() {
        return Err("不兼容的档案版本，请使用对应版本的软件".into());
    }
    let worlds = c.query_row("SELECT count(*) FROM worlds", [], |r| r.get(0))?;
    c.prepare("SELECT key,value FROM settings")?;
    c.prepare("SELECT world_id,player_uuid,stats FROM stat_snapshots")?;
    let observations = if schema >= 6 {
        c.query_row("SELECT count(*) FROM observed_sessions", [], |r| r.get(0))?
    } else {
        0
    };
    let violations: i64 =
        c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
    if violations != 0 {
        return Err("档案存在损坏的关联记录".into());
    }
    let modified = fs::metadata(path)?
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs() as i64;
    let created_at = c.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ',?,'unixepoch')",
        [modified],
        |r| r.get(0),
    )?;
    Ok(BackupInfo {
        path: path.to_owned(),
        created_at,
        kind: "selected".into(),
        bytes: fs::metadata(path)?.len(),
        worlds,
        observations,
        schema,
        digest: digest(path)?,
    })
}
/// Includes committed WAL pages without copying live sidecars.
pub fn snapshot(source: &Path, target: &Path) -> DbResult<()> {
    if target.exists() {
        return Err("备份目标已存在，未覆盖".into());
    }
    let c = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    c.busy_timeout(Duration::from_secs(5))?;
    let mut copy = Connection::open(target)?;
    let backup = rusqlite::backup::Backup::new(&c, &mut copy)?;
    backup.run_to_completion(128, Duration::from_millis(10), None)?;
    drop(backup);
    copy.execute_batch("PRAGMA journal_mode=DELETE;")?;
    drop(copy);
    inspect(target)?;
    fs::OpenOptions::new()
        .write(true)
        .open(target)?
        .sync_all()?;
    Ok(())
}
impl BackupStore {
    pub fn policy(&self) -> DbResult<BackupPolicy> {
        let path = self.app_data.join("backup-policy.json");
        let mut policy: BackupPolicy = if path.exists() {
            serde_json::from_slice(&fs::read(path)?)?
        } else {
            BackupPolicy::default()
        };
        if policy.directory.as_os_str().is_empty() {
            policy.directory = self.app_data.join("backups");
        }
        Ok(policy)
    }
    fn save(&self, policy: &BackupPolicy) -> DbResult<()> {
        atomic_json(&self.app_data.join("backup-policy.json"), policy)
    }
    pub fn configure(
        &self,
        enabled: bool,
        retention: usize,
        directory: PathBuf,
    ) -> DbResult<BackupPolicy> {
        if ![7, 14, 30].contains(&retention) || !directory.is_absolute() {
            return Err("请选择备份目录及 7、14 或 30 份保留数量".into());
        }
        fs::create_dir_all(&directory)?;
        let mut policy = self.policy()?;
        policy.enabled = enabled;
        policy.retention = retention;
        policy.directory = directory;
        self.save(&policy)?;
        Ok(policy)
    }
    pub fn create(&self, kind: &str) -> DbResult<Option<BackupInfo>> {
        self.create_for_day(kind, &clock()?.1)
    }
    pub fn create_for_day(&self, kind: &str, day: &str) -> DbResult<Option<BackupInfo>> {
        self.create_using(kind, day, snapshot)
    }
    fn create_using(
        &self,
        kind: &str,
        day: &str,
        copy: impl FnOnce(&Path, &Path) -> DbResult<()>,
    ) -> DbResult<Option<BackupInfo>> {
        if !["auto", "manual", "before-restore"].contains(&kind) {
            return Err("不支持的备份类型".into());
        }
        let mut policy = self.policy()?;
        if kind == "auto" && (!policy.enabled || policy.last_day == day) {
            return Ok(None);
        }
        policy.last_attempt = clock()?.0;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let target = policy
            .directory
            .join(format!("minechronicle-{kind}-{stamp}.sqlite3"));
        let temporary = target.with_extension("partial");
        let result = (|| -> DbResult<Option<BackupInfo>> {
            fs::create_dir_all(&policy.directory).map_err(|e| format!("准备备份目录失败：{e}"))?;
            copy(&self.database, &temporary)?;
            let mut info = inspect(&temporary)?;
            if kind == "auto" && info.digest == policy.last_digest {
                fs::remove_file(&temporary)?;
                policy.error.clear();
                self.save(&policy)?;
                return Ok(None);
            }
            fs::rename(&temporary, &target)?;
            info.path = target.clone();
            info.kind = kind.into();
            if kind == "auto" {
                policy.last_day = day.into();
                policy.last_digest = info.digest.clone();
            }
            policy.error.clear();
            policy.last_success = policy.last_attempt.clone();
            policy.records.push(info.clone());
            self.save(&policy)?;
            // Only our recorded automatic files may be removed, and only after
            // a successful snapshot and durable manifest write.
            let excess = policy
                .records
                .iter()
                .filter(|r| r.kind == "auto")
                .count()
                .saturating_sub(policy.retention);
            let old: Vec<_> = policy
                .records
                .iter()
                .filter(|r| r.kind == "auto")
                .take(excess)
                .cloned()
                .collect();
            for record in old {
                if record.path.parent() != Some(policy.directory.as_path()) {
                    continue;
                }
                if record
                    .path
                    .file_name()
                    .is_none_or(|n| !n.to_string_lossy().starts_with("minechronicle-auto-"))
                {
                    continue;
                }
                if record.path.exists() {
                    if digest(&record.path)? != record.digest {
                        continue;
                    }
                    fs::remove_file(&record.path)?;
                }
                policy.records.retain(|r| r.path != record.path);
            }
            self.save(&policy)?;
            Ok(Some(info))
        })();
        if let Err(e) = &result {
            policy.error = e.to_string();
            let _ = self.save(&policy);
            let _ = fs::remove_file(&temporary);
        }
        result
    }
    pub fn schedule_restore(&self, source: &Path) -> DbResult<()> {
        let info = inspect(source)?;
        self.schedule_verified_restore(source, &info.digest)
    }
    pub fn schedule_verified_restore(&self, source: &Path, expected_digest: &str) -> DbResult<()> {
        let source_lock = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        source_lock.execute_batch("BEGIN;")?;
        source_lock.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })?;
        // A selected restore file must be a standalone backup. Its main-file
        // digest cannot authenticate uncheckpointed data in a separate WAL.
        let mut wal = source.as_os_str().to_os_string();
        wal.push("-wal");
        if fs::metadata(wal).is_ok_and(|m| m.len() > 0) {
            return Err("请选择独立备份文件；该文件仍有未合并的 WAL 数据".into());
        }
        if inspect(source)?.digest != expected_digest {
            return Err("备份文件已变化，请重新校验并确认".into());
        }
        if source.canonicalize()? == self.database.canonicalize()?
            || source == self.database.with_extension("restore-ready.sqlite3")
        {
            return Err("不能选择当前档案或恢复中间文件，请选择一份备份".into());
        }
        if self.app_data.join("pending-restore.json").exists() {
            return Err("已有待恢复档案，请先重启".into());
        }
        let stage = self.database.with_extension("restore-ready.sqlite3");
        if stage.exists() {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos();
            fs::rename(
                &stage,
                self.database
                    .with_extension(format!("restore-unapplied-{stamp}.sqlite3")),
            )?;
        }
        snapshot(source, &stage)?;
        // Exercise migrations on the staged copy, never on the selected file.
        let prepared = (|| -> DbResult<()> {
            // SQLite rewrites destination header counters during backup, so
            // compare the locked source, not the destination's physical hash.
            if digest(source)? != expected_digest {
                return Err("备份文件已变化，请重新校验并确认".into());
            }
            let repo = Repository::open(&stage)?;
            repo.load()?;
            repo.tracking_summary()?;
            drop(repo);
            let c = Connection::open(&stage)?;
            c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")?;
            drop(c);
            inspect(&stage)?;
            self.create("before-restore")?;
            let rollback = self.database.with_extension("restore-previous.sqlite3");
            if rollback.exists() {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_nanos();
                fs::rename(
                    &rollback,
                    self.database
                        .with_extension(format!("restore-previous-{stamp}.sqlite3")),
                )?;
            }
            atomic_json(
                &self.app_data.join("pending-restore.json"),
                &PendingRestore {
                    target: self.database.clone(),
                    staged: stage.clone(),
                    rollback,
                    digest: digest(&stage)?,
                    source: source.to_owned(),
                    scheduled_at: clock()?.0,
                },
            )
        })();
        if prepared.is_err() {
            let _ = fs::remove_file(&stage);
        }
        prepared
    }
    pub fn pending_restore(&self) -> DbResult<Option<PendingRestoreInfo>> {
        let marker = self.app_data.join("pending-restore.json");
        if !marker.exists() {
            return Ok(None);
        }
        let pending: PendingRestore = serde_json::from_slice(&fs::read(marker)?)?;
        Ok(Some(PendingRestoreInfo {
            source: pending.source,
            scheduled_at: pending.scheduled_at,
        }))
    }
    pub fn cancel_restore(&self) -> DbResult<()> {
        let marker = self.app_data.join("pending-restore.json");
        if !marker.exists() {
            return Ok(());
        }
        // Remove the activation marker first. An orphaned staged file cannot activate.
        fs::remove_file(marker)?;
        let stage = self.database.with_extension("restore-ready.sqlite3");
        if stage.exists() {
            // Cancellation already succeeded. A locked orphan cannot activate,
            // and the next preparation will preserve it under a unique name.
            let _ = fs::remove_file(stage);
        }
        Ok(())
    }
    /// Called before any tracker/IPC worker opens the database. Retains rollback.
    pub fn apply_pending(&self) -> DbResult<()> {
        let marker = self.app_data.join("pending-restore.json");
        if !marker.exists() {
            return Ok(());
        }
        let pending: PendingRestore = serde_json::from_slice(&fs::read(&marker)?)?;
        if pending.target != self.database
            || pending.staged != self.database.with_extension("restore-ready.sqlite3")
            || pending.rollback != self.database.with_extension("restore-previous.sqlite3")
        {
            return Err("待恢复档案路径与当前配置不一致".into());
        }
        // Recover interrupted rename before doing anything else.
        if !pending.target.exists() && pending.rollback.exists() {
            fs::rename(&pending.rollback, &pending.target)?;
        }
        if !pending.staged.exists() {
            if inspect(&pending.target).is_err() || digest(&pending.target)? != pending.digest {
                if !pending.rollback.exists() {
                    return Err("恢复结果校验失败，且回滚档案不可用".into());
                }
                if pending.target.exists() {
                    fs::rename(&pending.target, &pending.staged)?;
                }
                fs::rename(&pending.rollback, &pending.target)?;
                let mut policy = self.policy()?;
                policy.error = "恢复被中断，已回滚到原档案".into();
                self.save(&policy)?;
            }
            fs::remove_file(marker)?;
            return Ok(());
        }
        if digest(&pending.staged)? != pending.digest || inspect(&pending.staged).is_err() {
            let mut policy = self.policy()?;
            policy.error = "待恢复档案校验失败，已保留当前档案；请重新选择备份".into();
            self.save(&policy)?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos();
            fs::rename(
                &marker,
                self.app_data.join(format!("failed-restore-{stamp}.json")),
            )?;
            return Ok(());
        }
        if pending.rollback.exists() {
            return Err("恢复回滚文件已存在，未覆盖任何档案".into());
        }
        let c = Connection::open(&pending.target)?;
        let busy: i64 = c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
        if busy != 0 {
            return Err("档案仍被占用，无法恢复".into());
        }
        c.execute_batch("PRAGMA journal_mode=DELETE;")?;
        drop(c);
        fs::rename(&pending.target, &pending.rollback)?;
        if let Err(error) = fs::rename(&pending.staged, &pending.target) {
            fs::rename(&pending.rollback, &pending.target)?;
            return Err(error.into());
        }
        if let Err(error) = inspect(&pending.target) {
            fs::rename(&pending.target, &pending.staged)?;
            fs::rename(&pending.rollback, &pending.target)?;
            return Err(error);
        }
        fs::remove_file(marker)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, BackupStore) {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("archive.sqlite3");
        Repository::open(&database)
            .unwrap()
            .set_setting("self_player_identity", "Steve")
            .unwrap();
        let store = BackupStore {
            app_data: dir.path().to_owned(),
            database,
        };
        (dir, store)
    }
    #[test]
    fn backup_contains_committed_wal_and_restore_preserves_policy() {
        let (_dir, store) = store();
        let c = Connection::open(&store.database).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL; UPDATE settings SET value='Alex' WHERE key='self_player_identity';").unwrap();
        let backup = store.create("manual").unwrap().unwrap();
        assert_eq!(
            Connection::open(&backup.path)
                .unwrap()
                .query_row(
                    "SELECT value FROM settings WHERE key='self_player_identity'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "Alex"
        );
        c.execute("UPDATE settings SET value='Later'", []).unwrap();
        drop(c);
        store
            .configure(false, 14, store.app_data.join("backups"))
            .unwrap();
        store.schedule_restore(&backup.path).unwrap();
        store.apply_pending().unwrap();
        assert_eq!(
            Repository::open(&store.database)
                .unwrap()
                .setting("self_player_identity")
                .unwrap()
                .as_deref(),
            Some("Alex")
        );
        assert!(!store.policy().unwrap().enabled);
        assert_eq!(store.policy().unwrap().retention, 14);
        assert!(store
            .database
            .with_extension("restore-previous.sqlite3")
            .exists());
    }
    #[test]
    fn automatic_backups_skip_unchanged_days_and_only_prune_owned_auto_files() {
        let (_dir, store) = store();
        let manual = store.create("manual").unwrap().unwrap();
        assert!(store
            .create_for_day("auto", "2026-01-01")
            .unwrap()
            .is_some());
        assert!(store
            .create_for_day("auto", "2026-01-01")
            .unwrap()
            .is_none());
        assert!(store
            .create_for_day("auto", "2026-01-02")
            .unwrap()
            .is_none());
        for day in 2..12 {
            Repository::open(&store.database)
                .unwrap()
                .set_setting("change", &day.to_string())
                .unwrap();
            store
                .create_for_day("auto", &format!("2026-01-{day:02}"))
                .unwrap();
        }
        let p = store.policy().unwrap();
        assert_eq!(p.records.iter().filter(|r| r.kind == "auto").count(), 7);
        assert!(manual.path.exists());
        let foreign = p.directory.join("personal.sqlite3");
        fs::write(&foreign, b"unrelated").unwrap();
        let old: Vec<_> = p.records.iter().map(|r| r.path.clone()).collect();
        assert!(store
            .create_using("auto", "2026-02-01", |_, _| Err(std::io::Error::from(
                std::io::ErrorKind::StorageFull
            )
            .into()))
            .is_err());
        assert!(old.iter().all(|p| p.exists()));
        assert!(foreign.exists());
        assert!(!store.policy().unwrap().error.is_empty());
    }
    #[test]
    fn rejects_corrupt_future_and_recovers_interrupted_swap() {
        let (_dir, store) = store();
        let backup = store.create("manual").unwrap().unwrap();
        let future = store.app_data.join("future.sqlite3");
        fs::copy(&backup.path, &future).unwrap();
        Connection::open(&future)
            .unwrap()
            .execute_batch("PRAGMA user_version=999")
            .unwrap();
        assert!(inspect(&future).is_err());
        let bad = store.app_data.join("bad.sqlite3");
        fs::write(&bad, b"bad data").unwrap();
        assert!(inspect(&bad).is_err());
        store.schedule_restore(&backup.path).unwrap();
        fs::rename(
            &store.database,
            store.database.with_extension("restore-previous.sqlite3"),
        )
        .unwrap();
        store.apply_pending().unwrap();
        assert!(inspect(&store.database).is_ok());
        // A second restore is supported without deleting the prior rollback.
        store.schedule_restore(&backup.path).unwrap();
        fs::write(
            store.database.with_extension("restore-ready.sqlite3"),
            b"damaged",
        )
        .unwrap();
        store.apply_pending().unwrap();
        assert!(inspect(&store.database).is_ok());
        assert!(!store.policy().unwrap().error.is_empty());
    }
}
