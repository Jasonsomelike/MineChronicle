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
    pub fn open(path: &Path) -> DbResult<Self> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        let transaction = connection.transaction()?;
        let version: i64 = transaction.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        match version {
            0 => {
                transaction.execute_batch(include_str!("001_initial.sql"))?;
                transaction.execute_batch(include_str!("002_pcl_instances.sql"))?;
            }
            1 => transaction.execute_batch(include_str!("002_pcl_instances.sql"))?,
            2..=6 => {}
            _ => {
                return Err(format!(
                    "数据库版本 {version} 高于此应用支持的版本，请使用较新版本打开。"
                )
                .into())
            }
        }
        if version < 3 {
            transaction.execute_batch(include_str!("003_tracking.sql"))?;
        }
        if version < 4 {
            transaction.execute_batch(include_str!("004_health.sql"))?;
        }
        if version < 5 {
            transaction.execute_batch(include_str!("005_activity.sql"))?;
        }
        if version < 6 {
            transaction.execute_batch(include_str!("006_sessions.sql"))?;
        }
        transaction.commit()?;
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
        let mut roots = Vec::new();
        let mut root_query = self
            .connection
            .prepare("SELECT id,payload FROM game_roots ORDER BY path")?;
        let root_rows =
            root_query.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for row in root_rows {
            let (root_id, payload) = row?;
            let mut root: RootSummary = serde_json::from_str(&payload)?;
            let mut worlds = self.connection.prepare(
                "SELECT id,status,payload FROM worlds WHERE game_root_id=? ORDER BY path",
            )?;
            for row in worlds.query_map([root_id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })? {
                let (world_id, status, payload) = row?;
                let mut world: WorldSummary = serde_json::from_str(&payload)?;
                world.status = serde_json::from_value(serde_json::Value::String(status))?;
                let mut players = self.connection.prepare("SELECT wp.payload,wp.current_ticks,p.preferred_name,p.name_source,(SELECT play_ticks FROM stat_snapshots s WHERE s.world_id=wp.world_id AND s.player_uuid=wp.player_uuid AND s.kind='initial_import') FROM world_players wp JOIN players p ON p.uuid=wp.player_uuid WHERE wp.world_id=? ORDER BY wp.player_uuid")?;
                for row in players.query_map([world_id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<i64>>(4)?,
                    ))
                })? {
                    let (payload, ticks, name, source, initial) = row?;
                    let mut player: PlayerSummary = serde_json::from_str(&payload)?;
                    player.play_ticks = ticks.map(|v| v.to_string());
                    player.preferred_name = name;
                    player.name_source = source;
                    player.initial_play_ticks = initial.map(|v| v.to_string());
                    world.players.push(player);
                }
                root.worlds.push(world);
            }
            roots.push(root);
        }
        let mut historical = 0i128;
        let mut query = self
            .connection
            .prepare("SELECT play_ticks FROM stat_snapshots WHERE kind='initial_import'")?;
        for ticks in query.query_map([], |r| r.get::<_, i64>(0))? {
            historical += i128::from(ticks?);
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
