//! SQLite storage owned by MineChronicle. Minecraft inputs are never opened for writing.
pub mod activity;
pub mod health;
pub mod read_models;
pub mod sessions;
pub mod storage;
pub mod tracking;
use read_models::{PlayerSummary, RootSummary, ScanSummary, WorldSummary};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub type DbResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
#[derive(Clone)]
pub struct DatabaseState {
    pub path: PathBuf,
}
pub struct Repository {
    connection: Connection,
    path: PathBuf,
}

impl Repository {
    pub fn setting(&self, key: &str) -> DbResult<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }
    pub fn set_setting(&self, key: &str, value: &str) -> DbResult<()> {
        self.connection.execute("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;
        Ok(())
    }
    pub fn now(&self) -> DbResult<String> {
        Ok(self
            .connection
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| {
                r.get(0)
            })?)
    }
    pub fn scan_revision(&self) -> DbResult<i64> {
        Ok(self
            .connection
            .query_row("SELECT coalesce(max(id),0) FROM scan_runs", [], |r| {
                r.get(0)
            })?)
    }
    /// The journal mode in effect for this archive (`delete`, `wal`, ...).
    pub fn journal_mode(&self) -> DbResult<String> {
        Ok(self
            .connection
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))?)
    }
    /// Switch the archive to WAL. `journal_mode` is persistent, so this only
    /// needs to succeed once; readers no longer block the writer.
    pub fn enable_wal(&self) -> DbResult<()> {
        self.connection
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0))?;
        self.connection
            .execute_batch("PRAGMA synchronous=NORMAL;")?;
        Ok(())
    }
    pub fn open(path: &Path) -> DbResult<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        // WAL lets the watcher and a foreground scan write without blocking each
        // other. Measured on the real archive with two writers: worst single
        // write 70.5 ms -> 22.0 ms, average 1.59 ms -> 0.51 ms.
        // Cost: the first query on a WAL archive pays ~1.2 ms extra (SQLite opens
        // the WAL index), which is why open() is ~1.2 ms instead of ~0.2 ms. That
        // is worth it against 70 ms write stalls. `journal_mode` is persistent,
        // but reading it costs the same ~1.2 ms, so always setting it is simpler
        // and no slower in practice.
        connection.execute_batch("PRAGMA journal_mode=WAL;")?;
        // synchronous is per connection (not persistent). NORMAL is the standard
        // WAL pairing: durable across application crashes; a power loss can cost
        // the most recent transactions, which this app rebuilds by rescanning.
        connection.execute_batch("PRAGMA synchronous=NORMAL;")?;
        migrate(&mut connection)?;
        Ok(Self {
            connection,
            path: path.to_owned(),
        })
    }

    /// Completed scans commit atomically. Only a complete root enumeration can mark old worlds missing.
    pub fn import(&mut self, report: &ScanSummary, inputs: &[PathBuf]) -> DbResult<()> {
        if report.cancelled {
            return Ok(());
        }
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO scan_runs(issues) VALUES (?)",
            [serde_json::to_string(&report.issues)?],
        )?;
        let scan_id = tx.last_insert_rowid();
        for issue in &report.issues {
            tx.execute(
                "INSERT INTO anomalies(scan_id,kind,path,message) VALUES (?,?,?,?)",
                params![
                    scan_id,
                    serde_json::to_string(&issue.kind)?,
                    path_key(&issue.path)?,
                    issue.message
                ],
            )?;
        }
        for root in &report.roots {
            let root_path = path_key(&root.path)?;
            let mut root_payload = root.clone();
            root_payload.worlds.clear();
            tx.execute("INSERT INTO game_roots(path,payload) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload", params![root_path, serde_json::to_string(&root_payload)?])?;
            let root_id: i64 = tx.query_row(
                "SELECT id FROM game_roots WHERE path=?",
                [&root_path],
                |r| r.get(0),
            )?;
            if root.enumeration_complete {
                tx.execute(
                    "UPDATE worlds SET status='Missing' WHERE game_root_id=?",
                    [root_id],
                )?;
            }
            for world in &root.worlds {
                let world_path = path_key(&world.path)?;
                let mut world_payload = world.clone();
                world_payload.players.clear();
                let status = match world.status {
                    crate::domain::WorldStatus::Present => "Present",
                    crate::domain::WorldStatus::Degraded => "Degraded",
                    crate::domain::WorldStatus::Missing => "Missing",
                };
                tx.execute("INSERT INTO worlds(game_root_id,path,status,payload) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET game_root_id=excluded.game_root_id,status=excluded.status,payload=excluded.payload", params![root_id,world_path,status,serde_json::to_string(&world_payload)?])?;
                let world_id: i64 =
                    tx.query_row("SELECT id FROM worlds WHERE path=?", [&world_path], |r| {
                        r.get(0)
                    })?;
                tx.execute("UPDATE world_players SET current_ticks=NULL,current_stats=NULL WHERE world_id=?", [world_id])?;
                for player in &world.players {
                    tx.execute("INSERT INTO players(uuid,preferred_name,name_source) VALUES (?,?,?) ON CONFLICT(uuid) DO UPDATE SET preferred_name=CASE WHEN players.name_source='manual' THEN players.preferred_name ELSE coalesce(excluded.preferred_name,players.preferred_name) END,name_source=CASE WHEN players.name_source='manual' THEN players.name_source ELSE coalesce(excluded.name_source,players.name_source) END", params![player.uuid,player.preferred_name,player.name_source])?;
                    if let Some(name) = &player.preferred_name {
                        tx.execute(
                            "INSERT OR IGNORE INTO player_aliases(uuid,name,source) VALUES (?,?,?)",
                            params![
                                player.uuid,
                                name,
                                player.name_source.as_deref().unwrap_or("usercache")
                            ],
                        )?;
                    }
                    let ticks = player
                        .play_ticks
                        .as_deref()
                        .map(str::parse::<i64>)
                        .transpose()?;
                    let stats = player
                        .normalized_stats
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()?;
                    tx.execute("INSERT INTO world_players(world_id,player_uuid,current_ticks,current_stats,payload) VALUES (?,?,?,?,?) ON CONFLICT(world_id,player_uuid) DO UPDATE SET current_ticks=excluded.current_ticks,current_stats=excluded.current_stats,payload=excluded.payload", params![world_id,player.uuid,ticks,stats,serde_json::to_string(player)?])?;
                    if let (Some(ticks), Some(stats)) = (ticks, stats) {
                        tx.execute("INSERT INTO stat_snapshots(world_id,player_uuid,kind,play_ticks,stats) VALUES (?,?,'initial_import',?,?) ON CONFLICT DO NOTHING", params![world_id,player.uuid,ticks,stats])?;
                        crate::tracker::ledger::observe(
                            &tx,
                            world_id,
                            &player.uuid,
                            ticks,
                            &stats,
                            scan_id,
                        )?;
                    }
                }
            }
        }
        for instance in &report.instances {
            let launcher_path = path_key(&instance.launcher_path)?;
            tx.execute("INSERT INTO launcher_installations(kind,path) VALUES ('Pcl',?) ON CONFLICT(path) DO NOTHING",[&launcher_path])?;
            let launcher_id: i64 = tx.query_row(
                "SELECT id FROM launcher_installations WHERE path=?",
                [&launcher_path],
                |r| r.get(0),
            )?;
            let root_id: Option<i64> = tx
                .query_row(
                    "SELECT id FROM game_roots WHERE path=?",
                    [path_key(&instance.game_root)?],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(root_id) = root_id else {
                continue;
            };
            let instance_path = path_key(&instance.instance_path)?;
            tx.execute("INSERT INTO instances(launcher_id,game_root_id,name,path,payload) VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET launcher_id=excluded.launcher_id,game_root_id=excluded.game_root_id,name=excluded.name,payload=excluded.payload",params![launcher_id,root_id,instance.name,instance_path,serde_json::to_string(instance)?])?;
            let id: i64 = tx.query_row(
                "SELECT id FROM instances WHERE path=?",
                [instance_path],
                |r| r.get(0),
            )?;
            tx.execute("DELETE FROM instance_world_links WHERE instance_id=?", [id])?;
            tx.execute("INSERT INTO instance_world_links(instance_id,world_id) SELECT ?,id FROM worlds WHERE game_root_id=?",params![id,root_id])?;
        }
        tx.execute("INSERT INTO settings(key,value) VALUES ('scan_inputs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(inputs)?])?;
        health::detect_candidates(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_alias(&mut self, uuid: &str, name: &str) -> DbResult<()> {
        let uuid = uuid::Uuid::parse_str(uuid)?.to_string();
        if !crate::scanner::valid_player_name(name) {
            return Err("名称需为 1–64 个字符，不能包含首尾空格或控制字符。".into());
        }
        let tx = self.connection.transaction()?;
        tx.execute("INSERT INTO players(uuid,preferred_name,name_source) VALUES (?,?,'manual') ON CONFLICT(uuid) DO UPDATE SET preferred_name=excluded.preferred_name,name_source='manual'", params![uuid,name])?;
        tx.execute(
            "INSERT OR IGNORE INTO player_aliases(uuid,name,source) VALUES (?,?,'manual')",
            params![uuid, name],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn inputs(&self) -> DbResult<Vec<PathBuf>> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key='scan_inputs'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(value
            .map(|v| serde_json::from_str(&v))
            .transpose()?
            .unwrap_or_default())
    }

    pub fn load(&self) -> DbResult<ScanSummary> {
        // Three flat queries prepared once, then grouped in Rust. The previous
        // version prepared a worlds statement per root and a players statement
        // per world (and re-ran a correlated initial-import subquery per player),
        // so this ran in O(roots + worlds) round trips.
        let mut roots = Vec::new();
        let mut root_index: std::collections::HashMap<i64, usize> =
            std::collections::HashMap::new();
        {
            let mut root_query = self
                .connection
                .prepare("SELECT id,payload FROM game_roots ORDER BY path")?;
            for row in
                root_query.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            {
                let (root_id, payload) = row?;
                root_index.insert(root_id, roots.len());
                roots.push((root_id, serde_json::from_str::<RootSummary>(&payload)?));
            }
        }
        let mut worlds: Vec<(i64, i64, WorldSummary)> = Vec::new();
        let mut world_index: std::collections::HashMap<i64, usize> =
            std::collections::HashMap::new();
        {
            let mut world_query = self
                .connection
                .prepare("SELECT id,game_root_id,status,payload FROM worlds ORDER BY path")?;
            for row in world_query.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })? {
                let (world_id, root_id, status, payload) = row?;
                let mut world: WorldSummary = serde_json::from_str(&payload)?;
                world.status = serde_json::from_value(serde_json::Value::String(status))?;
                world_index.insert(world_id, worlds.len());
                worlds.push((world_id, root_id, world));
            }
        }
        {
            // `one_initial_import` is a partial unique index, so the join adds at
            // most one row per (world, player).
            let mut player_query = self.connection.prepare(
                "SELECT wp.world_id,wp.payload,wp.current_ticks,p.preferred_name,p.name_source,s.play_ticks \
                 FROM world_players wp \
                 JOIN players p ON p.uuid=wp.player_uuid \
                 LEFT JOIN stat_snapshots s ON s.world_id=wp.world_id AND s.player_uuid=wp.player_uuid AND s.kind='initial_import' \
                 ORDER BY wp.world_id,wp.player_uuid",
            )?;
            for row in player_query.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                ))
            })? {
                let (world_id, payload, ticks, name, source, initial) = row?;
                let Some(index) = world_index.get(&world_id).copied() else {
                    continue;
                };
                let mut player: PlayerSummary = serde_json::from_str(&payload)?;
                player.play_ticks = ticks.map(|v| v.to_string());
                player.preferred_name = name;
                player.name_source = source;
                player.initial_play_ticks = initial.map(|v| v.to_string());
                worlds[index].2.players.push(player);
            }
        }
        // Attach worlds to their roots, preserving both ORDER BY clauses.
        let mut roots: Vec<RootSummary> = roots.into_iter().map(|(_, root)| root).collect();
        for (_, root_id, world) in worlds {
            if let Some(index) = root_index.get(&root_id).copied() {
                roots[index].worlds.push(world);
            }
        }
        // Accumulate in i128, not SQLite's `sum()`: the aggregate uses an i64
        // accumulator and raises "integer overflow" once totals exceed i64, which
        // two i64::MAX initial imports already do (see database_contract.rs).
        // Rows are still read in one pass; only the addition moved back to Rust.
        let mut historical = 0i128;
        {
            let mut query = self
                .connection
                .prepare("SELECT play_ticks FROM stat_snapshots WHERE kind='initial_import'")?;
            for ticks in query.query_map([], |r| r.get::<_, i64>(0))? {
                historical += i128::from(ticks?);
            }
        }
        let last: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT finished_at,issues FROM scan_runs ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (last_scan, issues) = match last {
            Some((time, issues)) => (Some(time), serde_json::from_str(&issues)?),
            None => (None, Vec::new()),
        };
        let instances = self.load_instances()?;
        Ok(ScanSummary {
            instances,
            roots,
            issues,
            cancelled: false,
            saved: true,
            database_path: Some(self.path.clone()),
            last_scan,
            historical_ticks: historical.to_string(),
        })
    }
    pub fn load_instances(&self) -> DbResult<Vec<crate::launcher::DiscoveredInstance>> {
        let mut instances = Vec::new();
        let mut query = self
            .connection
            .prepare("SELECT payload FROM instances WHERE payload IS NOT NULL ORDER BY path")?;
        for row in query.query_map([], |r| r.get::<_, String>(0))? {
            instances.push(serde_json::from_str(&row?)?);
        }
        Ok(instances)
    }
}

fn path_key(path: &Path) -> DbResult<String> {
    Ok(path.to_str().ok_or("路径包含无法保存的字符")?.to_owned())
}

/// Ordered migrations, applied only when the archive is older than the target.
/// A single list replaces the previous match-plus-if chain, where version 2 was
/// handled by one mechanism and re-checked by the other.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("001_initial.sql")),
    (2, include_str!("002_pcl_instances.sql")),
    (3, include_str!("003_tracking.sql")),
    (4, include_str!("004_health.sql")),
    (5, include_str!("005_activity.sql")),
    (6, include_str!("006_sessions.sql")),
];

/// Current schema version supported by this build.
fn latest_version() -> i64 {
    MIGRATIONS.last().map_or(0, |(version, _)| *version)
}

fn migrate(connection: &mut Connection) -> DbResult<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > latest_version() {
        return Err(
            format!("数据库版本 {version} 高于此应用支持的版本，请使用较新版本打开。").into(),
        );
    }
    // An up-to-date archive must not pay for a write transaction on every open:
    // open() runs on the order of a millisecond, and there are ~30 call sites.
    if version == latest_version() {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    for (target, script) in MIGRATIONS {
        if version < *target {
            transaction.execute_batch(script)?;
        }
    }
    transaction.commit()?;
    Ok(())
}
