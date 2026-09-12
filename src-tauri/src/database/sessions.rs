use super::{DbResult, Repository};
use crate::launcher::running::ActiveInstance;
use rusqlite::params;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ObservedSession {
    pub id: i64,
    pub game_root: String,
    pub instance_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
}

impl Repository {
    /// A stopped observer cannot attest to game termination. Preserve the start
    /// and leave the end unknown instead of inventing a game-exit timestamp.
    pub fn interrupt_observed_sessions(&self) -> DbResult<()> {
        self.connection.execute(
            "UPDATE observed_sessions SET status='interrupted' WHERE status='running'",
            [],
        )?;
        Ok(())
    }

    pub fn observe_instances(&mut self, active: &[ActiveInstance]) -> DbResult<()> {
        let tx = self.connection.transaction()?;
        let now: String = tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
            r.get(0)
        })?;
        let existing = {
            let mut query = tx.prepare(
                "SELECT id,game_root,pids FROM observed_sessions WHERE status='running'",
            )?;
            let rows = query.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut matched = std::collections::HashSet::new();
        for (id, root, pids) in existing {
            let previous: Vec<u32> = serde_json::from_str(&pids)?;
            let current = active.iter().enumerate().find(|(_, a)| {
                super::path_key(&a.game_root).is_ok_and(|key| key == root)
                    && a.pids.iter().any(|pid| previous.contains(pid))
            });
            if let Some((index, instance)) = current {
                matched.insert(index);
                tx.execute(
                    "UPDATE observed_sessions SET pids=?,instance_name=? WHERE id=?",
                    params![serde_json::to_string(&instance.pids)?, instance.name, id],
                )?;
            } else {
                tx.execute(
                    "UPDATE observed_sessions SET status='closed',ended_at=? WHERE id=?",
                    params![now, id],
                )?;
            }
        }
        for (index, instance) in active.iter().enumerate() {
            if !matched.contains(&index) {
                tx.execute(
                    "INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,status) VALUES(?,?,?,?,'running')",
                    params![super::path_key(&instance.game_root)?, instance.name, serde_json::to_string(&instance.pids)?, now],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn observed_sessions(&self) -> DbResult<Vec<ObservedSession>> {
        let mut query = self.connection.prepare(
            "SELECT id,game_root,instance_name,started_at,ended_at,status FROM observed_sessions ORDER BY id DESC LIMIT 50",
        )?;
        let rows = query.query_map([], |r| {
            Ok(ObservedSession {
                id: r.get(0)?,
                game_root: r.get(1)?,
                instance_name: r.get(2)?,
                started_at: r.get(3)?,
                ended_at: r.get(4)?,
                status: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}
