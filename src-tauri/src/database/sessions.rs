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
    /// Seconds of this run with no world progress: play whose statistics live
    /// somewhere the archive cannot see (a server). Filled in by
    /// `tracking_summary`, which owns the attribution rule; `observed_sessions`
    /// alone leaves it at zero.
    #[serde(default)]
    pub pseudo_seconds: String,
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
                super::path_key(&a.game_root).is_some_and(|key| key == root)
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
                // An instance whose root path cannot be stored is skipped rather
                // than failing the whole session update.
                let Some(game_root) = super::path_key(&instance.game_root) else {
                    continue;
                };
                tx.execute(
                    "INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,status) VALUES(?,?,?,?,'running')",
                    params![game_root, instance.name, serde_json::to_string(&instance.pids)?, now],
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
                pseudo_seconds: "0".into(),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// The same list with each run's pseudo-server time filled in.
    ///
    /// Kept separate from `observed_sessions` because attribution needs the
    /// deltas as well as the sessions, and callers that only want the raw
    /// boundaries should not pay for that.
    pub fn observed_sessions_with_pseudo(&self) -> DbResult<Vec<ObservedSession>> {
        let mut sessions = self.observed_sessions()?;
        let (_, per_session) = self.pseudo_attribution()?;
        for session in &mut sessions {
            if let Some(seconds) = per_session.get(&session.id) {
                session.pseudo_seconds = seconds.to_string();
            }
        }
        Ok(sessions)
    }
}
