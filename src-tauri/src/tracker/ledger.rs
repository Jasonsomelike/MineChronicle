use crate::database::DbResult;
use rusqlite::{params, OptionalExtension, Transaction};

/// Recursively sorted keys, retaining arrays and every unknown statistic.
pub fn normalized_hash(stats: &str) -> DbResult<String> {
    fn canonical(value: serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => {
                let sorted: std::collections::BTreeMap<_, _> = map.into_iter().collect();
                serde_json::Value::Object(
                    sorted.into_iter().map(|(k, v)| (k, canonical(v))).collect(),
                )
            }
            serde_json::Value::Array(items) => {
                serde_json::Value::Array(items.into_iter().map(canonical).collect())
            }
            v => v,
        }
    }
    let bytes = serde_json::to_vec(&canonical(serde_json::from_str(stats)?))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

pub fn observe(
    tx: &Transaction<'_>,
    world: i64,
    uuid: &str,
    ticks: i64,
    stats: &str,
    scan_id: i64,
) -> DbResult<()> {
    let hash = normalized_hash(stats)?;
    let previous:Option<(i64,String)>=tx.query_row("SELECT play_ticks,normalized_hash FROM tracking_cursors WHERE world_id=? AND player_uuid=?",params![world,uuid],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    if previous
        .as_ref()
        .is_some_and(|(old_ticks, old_hash)| *old_ticks == ticks && old_hash == &hash)
    {
        return Ok(());
    }
    tx.execute("INSERT INTO stat_snapshots(world_id,player_uuid,kind,play_ticks,stats,normalized_hash) VALUES (?,?,'observation',?,?,?)",params![world,uuid,ticks,stats,hash])?;
    let snapshot = tx.last_insert_rowid();
    if let Some((old, _)) = previous {
        if ticks > old {
            tx.execute("INSERT INTO tracked_deltas(world_id,player_uuid,delta_ticks,observed_at,snapshot_id) VALUES (?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",params![world,uuid,ticks-old,snapshot])?;
        } else if ticks < old {
            tx.execute("INSERT INTO stat_rollbacks(world_id,player_uuid,old_ticks,new_ticks,snapshot_id) VALUES (?,?,?,?,?)",params![world,uuid,old,ticks,snapshot])?;
            tx.execute("INSERT INTO anomalies(scan_id,kind,path,message) SELECT ?,'STAT_ROLLBACK',path,? FROM worlds WHERE id=?",params![scan_id,format!("统计回退：{old} → {ticks} ticks。本次增量为 0，之后从新读数继续追踪。"),world])?;
        }
    }
    tx.execute("INSERT INTO tracking_cursors(world_id,player_uuid,play_ticks,normalized_hash,snapshot_id) VALUES (?,?,?,?,?) ON CONFLICT(world_id,player_uuid) DO UPDATE SET play_ticks=excluded.play_ticks,normalized_hash=excluded.normalized_hash,snapshot_id=excluded.snapshot_id",params![world,uuid,ticks,hash,snapshot])?;
    Ok(())
}
