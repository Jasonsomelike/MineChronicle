use super::{DbResult, Repository};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::BTreeMap;
#[derive(Serialize)]
pub struct PlayerTracking {
    pub uuid: String,
    pub ticks: String,
    pub week_ticks: String,
    pub month_ticks: String,
}
#[derive(Serialize)]
pub struct Rollback {
    pub world_path: String,
    pub world_name: String,
    pub uuid: String,
    pub old_ticks: String,
    pub new_ticks: String,
    pub detected_at: String,
}
#[derive(Serialize)]
pub struct TrackingSummary {
    pub sessions: Vec<super::sessions::ObservedSession>,
    pub players: Vec<PlayerTracking>,
    pub rollbacks: Vec<Rollback>,
    pub rollback_count: i64,
    pub observations: i64,
    pub started_at: Option<String>,
}
impl Repository {
    pub fn tracking_enabled(&self) -> DbResult<bool> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key='tracking_enabled'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .as_deref()
            != Some("false"))
    }
    pub fn set_tracking_enabled(&self, enabled: bool) -> DbResult<()> {
        self.connection.execute("INSERT INTO settings(key,value) VALUES ('tracking_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[if enabled{"true"}else{"false"}])?;
        Ok(())
    }
    pub fn tracking_summary(&self) -> DbResult<TrackingSummary> {
        let mut totals: BTreeMap<String, (i128, i128, i128)> = BTreeMap::new();
        let mut query=self.connection.prepare("SELECT player_uuid,delta_ticks,datetime(observed_at,'localtime')>=datetime('now','localtime','start of day',printf('-%d days',(cast(strftime('%w','now','localtime') as integer)+6)%7)),datetime(observed_at,'localtime')>=datetime('now','localtime','start of month') FROM tracked_deltas")?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })? {
            let (uuid, ticks, week, month) = row?;
            let item = totals.entry(uuid).or_default();
            item.0 += i128::from(ticks);
            if week {
                item.1 += i128::from(ticks);
            }
            if month {
                item.2 += i128::from(ticks);
            }
        }
        let players = totals
            .into_iter()
            .map(|(uuid, (ticks, week, month))| PlayerTracking {
                uuid,
                ticks: ticks.to_string(),
                week_ticks: week.to_string(),
                month_ticks: month.to_string(),
            })
            .collect();
        let mut query=self.connection.prepare("SELECT w.path,w.payload,r.player_uuid,r.old_ticks,r.new_ticks,r.detected_at FROM stat_rollbacks r JOIN worlds w ON w.id=r.world_id ORDER BY r.id DESC LIMIT 50")?;
        let mut rollbacks = Vec::new();
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })? {
            let (world_path, payload, uuid, old, new, detected_at) = row?;
            let world: super::read_models::WorldSummary = serde_json::from_str(&payload)?;
            rollbacks.push(Rollback {
                world_path,
                world_name: world.name,
                uuid,
                old_ticks: old.to_string(),
                new_ticks: new.to_string(),
                detected_at,
            });
        }
        Ok(TrackingSummary {
            sessions: self.observed_sessions()?,
            players,
            rollbacks,
            rollback_count: self.connection.query_row(
                "SELECT count(*) FROM stat_rollbacks",
                [],
                |r| r.get(0),
            )?,
            observations: self.connection.query_row(
                "SELECT count(*) FROM stat_snapshots WHERE kind='observation'",
                [],
                |r| r.get(0),
            )?,
            started_at: self.connection.query_row(
                "SELECT min(observed_at) FROM stat_snapshots WHERE kind='observation'",
                [],
                |r| r.get(0),
            )?,
        })
    }
}
