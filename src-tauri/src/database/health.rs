use super::{read_models::WorldSummary, DbResult, Repository};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

pub const MIN_CLONE_TICKS: i64 = 12_000;
const MAX_PAIRS: usize = 2000;
#[derive(Clone, Serialize, Deserialize)]
pub struct CloneEvidence {
    pub uuid: String,
    pub ticks: String,
    pub stats_hash: String,
    pub metadata_fingerprint: String,
}
#[derive(Serialize)]
pub struct CandidateWorld {
    pub id: i64,
    pub path: String,
    pub name: String,
}
#[derive(Serialize)]
pub struct CloneCandidate {
    pub id: i64,
    pub status: String,
    pub world_a: CandidateWorld,
    pub world_b: CandidateWorld,
    pub evidence: Vec<CloneEvidence>,
    pub detected_at: String,
    pub parent_world_id: Option<i64>,
    pub inherited_confidence: Option<String>,
}
#[derive(Serialize)]
pub struct HealthItem {
    pub key: String,
    pub kind: String,
    pub path: String,
    pub detail: String,
    pub reviewed: bool,
    pub target: String,
}
#[derive(Serialize)]
pub struct HealthSummary {
    pub items: Vec<HealthItem>,
    pub candidates: Vec<CloneCandidate>,
    pub pending_count: usize,
    pub confirmed_lineages: i64,
    pub analysis_limited: bool,
}

/// Candidate evidence never changes baselines or tracked deltas.
pub(super) fn detect_candidates(tx: &Transaction<'_>) -> DbResult<()> {
    let mut groups: BTreeMap<(String, String, String), Vec<(i64, i64)>> = BTreeMap::new();
    let mut query=tx.prepare("SELECT w.id,w.payload,wp.player_uuid,wp.current_ticks,c.normalized_hash FROM world_players wp JOIN worlds w ON w.id=wp.world_id JOIN tracking_cursors c ON c.world_id=wp.world_id AND c.player_uuid=wp.player_uuid WHERE w.status='Present' AND wp.current_ticks>? AND wp.current_ticks=c.play_ticks AND wp.current_stats IS NOT NULL ORDER BY w.id,wp.player_uuid")?;
    for row in query.query_map([MIN_CLONE_TICKS], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
        ))
    })? {
        let (id, payload, uuid, ticks, hash) = row?;
        let world: WorldSummary = serde_json::from_str(&payload)?;
        if let Some(metadata) = world.metadata_fingerprint {
            groups
                .entry((uuid, hash, metadata))
                .or_default()
                .push((id, ticks));
        }
    }
    let mut pairs: BTreeMap<(i64, i64), Vec<CloneEvidence>> = BTreeMap::new();
    let mut limited = false;
    'groups: for ((uuid, hash, metadata), worlds) in groups {
        for (i, (a, ticks)) in worlds.iter().enumerate() {
            for (b, other_ticks) in &worlds[i + 1..] {
                if a == b || ticks != other_ticks {
                    continue;
                }
                let key = (*a.min(b), *a.max(b));
                if !pairs.contains_key(&key) && pairs.len() >= MAX_PAIRS {
                    limited = true;
                    break 'groups;
                }
                pairs.entry(key).or_default().push(CloneEvidence {
                    uuid: uuid.clone(),
                    ticks: ticks.to_string(),
                    stats_hash: hash.clone(),
                    metadata_fingerprint: metadata.clone(),
                });
            }
        }
    }
    for ((a, b), evidence) in pairs {
        tx.execute("INSERT INTO clone_candidates(world_a,world_b) VALUES (?,?) ON CONFLICT(world_a,world_b) DO NOTHING",params![a,b])?;
        let id: i64 = tx.query_row(
            "SELECT id FROM clone_candidates WHERE world_a=? AND world_b=?",
            params![a, b],
            |r| r.get(0),
        )?;
        tx.execute("INSERT INTO clone_evidence(candidate_id,evidence) VALUES (?,?) ON CONFLICT(candidate_id) DO UPDATE SET last_seen=strftime('%Y-%m-%dT%H:%M:%fZ','now')",params![id,serde_json::to_string(&evidence)?])?;
    }
    tx.execute("INSERT INTO analysis_status(key,value) VALUES ('clone_limit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[if limited{"true"}else{"false"}])?;
    Ok(())
}

impl Repository {
    pub fn health_summary(&self) -> DbResult<HealthSummary> {
        let report = self.load()?;
        let reviews: HashSet<String> = self
            .connection
            .prepare("SELECT key FROM health_reviews")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut items = BTreeMap::new();
        let mut add = |kind: &str, path: String, detail: String, identity: String| {
            let key = blake3::hash(format!("{kind}\0{path}\0{identity}").as_bytes())
                .to_hex()
                .to_string();
            let target = if kind == "UNRESOLVED_PLAYER" {
                identity
            } else {
                let source = std::path::Path::new(&path);
                report
                    .roots
                    .iter()
                    .flat_map(|root| {
                        std::iter::once(&root.path).chain(root.worlds.iter().map(|w| &w.path))
                    })
                    .filter(|p| source.starts_with(p))
                    .max_by_key(|p| p.components().count())
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default()
            };
            items.insert(
                key.clone(),
                HealthItem {
                    reviewed: reviews.contains(&key),
                    key,
                    kind: kind.into(),
                    path,
                    detail,
                    target,
                },
            );
        };
        for issue in &report.issues {
            if issue.kind == crate::scanner::ScanIssueKind::EmptyStats {
                continue;
            }
            let kind = serde_json::to_value(&issue.kind)?
                .as_str()
                .ok_or("invalid issue kind")?
                .to_owned();
            add(
                &kind,
                issue.path.to_string_lossy().into_owned(),
                issue.message.clone(),
                issue.message.clone(),
            );
        }
        let mut unresolved = HashMap::<String, usize>::new();
        for root in &report.roots {
            for world in &root.worlds {
                if world.status == crate::domain::WorldStatus::Missing {
                    add(
                        "WORLD_MISSING",
                        world.path.to_string_lossy().into_owned(),
                        format!("{} 的目录已缺失，已保留历史。", world.name),
                        String::new(),
                    );
                }
                for player in &world.players {
                    if player.preferred_name.is_none() {
                        *unresolved.entry(player.uuid.clone()).or_default() += 1;
                    }
                }
            }
        }
        for (uuid, count) in unresolved {
            add(
                "UNRESOLVED_PLAYER",
                String::new(),
                format!("{uuid} 尚无本地名称，涉及 {count} 个世界。"),
                uuid,
            );
        }
        let mut query=self.connection.prepare("SELECT r.id,w.path,w.payload,r.old_ticks,r.new_ticks,r.detected_at,r.player_uuid FROM stat_rollbacks r JOIN worlds w ON w.id=r.world_id ORDER BY r.id DESC")?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })? {
            let (id, path, payload, old, new, time, uuid) = row?;
            let world: WorldSummary = serde_json::from_str(&payload)?;
            add(
                "STAT_ROLLBACK",
                path,
                format!(
                    "{} · {}：{} → {} ticks。本次增量为 0，历史保留。{}",
                    world.name, uuid, old, new, time
                ),
                id.to_string(),
            );
        }
        let mut candidates = Vec::new();
        let mut query=self.connection.prepare("SELECT c.id,c.status,a.id,a.path,a.payload,b.id,b.path,b.payload,e.evidence,e.detected_at,l.parent_world_id,d.confidence FROM clone_candidates c JOIN clone_evidence e ON e.candidate_id=c.id JOIN worlds a ON a.id=c.world_a JOIN worlds b ON b.id=c.world_b LEFT JOIN lineage_details d ON d.candidate_id=c.id LEFT JOIN world_lineages l ON l.world_id=d.world_id ORDER BY c.id DESC")?;
        for row in query.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
                r.get::<_, Option<i64>>(10)?,
                r.get::<_, Option<String>>(11)?,
            ))
        })? {
            let (id, status, a, ap, aj, b, bp, bj, evidence, time, parent, confidence) = row?;
            let wa: WorldSummary = serde_json::from_str(&aj)?;
            let wb: WorldSummary = serde_json::from_str(&bj)?;
            candidates.push(CloneCandidate {
                id,
                status,
                world_a: CandidateWorld {
                    id: a,
                    path: ap,
                    name: wa.name,
                },
                world_b: CandidateWorld {
                    id: b,
                    path: bp,
                    name: wb.name,
                },
                evidence: serde_json::from_str(&evidence)?,
                detected_at: time,
                parent_world_id: parent,
                inherited_confidence: confidence,
            });
        }
        let pending_count = items.values().filter(|i| !i.reviewed).count()
            + candidates
                .iter()
                .filter(|c| c.status == "pending" || c.status == "deferred")
                .count();
        Ok(HealthSummary {
            items: items.into_values().collect(),
            candidates,
            pending_count,
            confirmed_lineages: self.connection.query_row(
                "SELECT count(*) FROM lineage_details",
                [],
                |r| r.get(0),
            )?,
            analysis_limited: self
                .connection
                .query_row(
                    "SELECT value='true' FROM analysis_status WHERE key='clone_limit'",
                    [],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(false),
        })
    }
    pub fn review_health(&self, key: &str, reviewed: bool) -> DbResult<()> {
        if !self.health_summary()?.items.iter().any(|i| i.key == key) {
            return Err("此问题已不存在，请刷新数据。".into());
        }
        if reviewed {
            self.connection.execute(
                "INSERT INTO health_reviews(key) VALUES (?) ON CONFLICT(key) DO NOTHING",
                [key],
            )?;
        } else {
            self.connection
                .execute("DELETE FROM health_reviews WHERE key=?", [key])?;
        }
        Ok(())
    }
    pub fn decide_clone(&mut self, id: i64, decision: &str, parent: Option<i64>) -> DbResult<()> {
        if !["confirmed", "rejected", "deferred", "pending"].contains(&decision) {
            return Err("未知的复核选项".into());
        }
        let tx = self.connection.transaction()?;
        let (a,b):(i64,i64)=tx.query_row("SELECT world_a,world_b FROM clone_candidates c JOIN clone_evidence e ON e.candidate_id=c.id WHERE c.id=?",[id],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let old_child: Option<i64> = tx
            .query_row(
                "SELECT world_id FROM lineage_details WHERE candidate_id=?",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        if decision == "confirmed" {
            let parent = parent
                .filter(|p| *p == a || *p == b)
                .ok_or("请明确选择原世界")?;
            let child = if parent == a { b } else { a };
            let other: Option<i64> = tx
                .query_row(
                    "SELECT candidate_id FROM lineage_details WHERE world_id=?",
                    [child],
                    |r| r.get(0),
                )
                .optional()?;
            if other.is_some_and(|other| other != id) {
                return Err("此世界已有确认的来源，请先撤销原关联。".into());
            }
            if let Some(old) = old_child {
                tx.execute("DELETE FROM world_lineages WHERE world_id=?", [old])?;
                tx.execute("DELETE FROM lineage_details WHERE world_id=?", [old])?;
            }
            let cycle:bool=tx.query_row("WITH RECURSIVE parents(id) AS (VALUES (?) UNION SELECT l.parent_world_id FROM world_lineages l JOIN parents p ON l.world_id=p.id WHERE l.parent_world_id IS NOT NULL) SELECT EXISTS(SELECT 1 FROM parents WHERE id=?)",params![parent,child],|r|r.get(0))?;
            if cycle {
                return Err("该关联会形成循环，未保存。".into());
            }
            tx.execute(
                "INSERT INTO world_lineages(world_id,parent_world_id) VALUES (?,?)",
                params![child, parent],
            )?;
            tx.execute("INSERT INTO lineage_details(world_id,candidate_id,inherited_ticks,confidence,confirmed_by_user) VALUES (?,?,NULL,'unknown',1)",params![child,id])?;
        } else if let Some(child) = old_child {
            tx.execute("DELETE FROM lineage_details WHERE world_id=?", [child])?;
            tx.execute("DELETE FROM world_lineages WHERE world_id=?", [child])?;
        }
        tx.execute(
            "UPDATE clone_candidates SET status=? WHERE id=?",
            params![decision, id],
        )?;
        tx.commit()?;
        Ok(())
    }
}
