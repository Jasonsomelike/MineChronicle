//! A process-local cache and bounded query snapshots. No persisted derived tables.
use super::{
    sessions::{ObservationQuery, ObservedSessionsPage},
    DbResult, Repository,
};
use std::{collections::BTreeMap, path::Path, sync::Arc};

struct Snapshot {
    filter: ObservationQuery,
    history: Arc<ObservedSessionsPage>,
    indices: Vec<usize>,
    seconds: String,
    boundary: i64,
}
pub struct ObservationCache {
    repo: Repository,
    revision: Option<i64>,
    history: Option<Arc<ObservedSessionsPage>>,
    snapshots: BTreeMap<u64, Snapshot>,
    next: u64,
}
impl ObservationCache {
    pub fn open(path: &Path) -> DbResult<Self> {
        Ok(Self {
            repo: Repository::open(path)?,
            revision: None,
            history: None,
            snapshots: BTreeMap::new(),
            next: 0,
        })
    }
    pub fn query(&mut self, page: i64, query: &ObservationQuery) -> DbResult<ObservedSessionsPage> {
        // data_version must be compared on the same live connection.
        let revision = self
            .repo
            .connection
            .query_row("PRAGMA data_version", [], |r| r.get::<_, i64>(0))?;
        if self.revision != Some(revision) {
            let history = self.repo.observed_sessions_query_sized(
                1,
                &ObservationQuery::default(),
                i64::from(i32::MAX),
            )?;
            self.history = Some(Arc::new(history));
            self.revision = Some(revision);
        }
        let current = self.history.as_ref().ok_or("观测缓存不可用")?;
        let mut filter = query.clone();
        filter.boundary = None;
        filter.snapshot = None;
        let token = if let Some(token) = &query.snapshot {
            let token: u64 = token.parse().map_err(|_| "观测查询已失效，请刷新观测")?;
            let snapshot = self
                .snapshots
                .get(&token)
                .ok_or("观测查询已失效，请刷新观测")?;
            if snapshot.filter != filter {
                return Err("筛选条件已变化，请刷新观测".into());
            }
            token
        } else {
            let boundary = query
                .boundary
                .unwrap_or(current.boundary)
                .clamp(0, current.boundary);
            self.repo.validate_observation_query(query)?;
            let indices: Vec<_> = current
                .sessions
                .iter()
                .enumerate()
                .filter(|(_, s)| {
                    s.id <= boundary
                        && (query.game_root.is_empty() || s.game_root == query.game_root)
                        && (query.status.is_empty() || s.status == query.status)
                        && (query.from.is_empty()
                            || s.local_date.as_ref().is_some_and(|d| d >= &query.from))
                        && (query.to.is_empty()
                            || s.local_date.as_ref().is_some_and(|d| d <= &query.to))
                })
                .map(|(i, _)| i)
                .collect();
            let seconds = indices
                .iter()
                .map(|i| current.sessions[*i].pseudo_seconds.parse::<i128>())
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .sum::<i128>()
                .to_string();
            self.next += 1;
            if self.snapshots.len() >= 8 {
                self.snapshots.pop_first();
            }
            self.snapshots.insert(
                self.next,
                Snapshot {
                    filter,
                    history: current.clone(),
                    indices,
                    seconds,
                    boundary,
                },
            );
            self.next
        };
        let snapshot = self
            .snapshots
            .get(&token)
            .ok_or("观测查询已失效，请刷新观测")?;
        let total = snapshot.indices.len() as i64;
        let page = page.clamp(1, ((total + 19) / 20).max(1));
        // The snapshot fixes *which* sessions the page shows, not what state they are
        // in. Rows are re-read from the live history by id, so a session that closes
        // (or gains a manual end time) while the page is displayed updates at once.
        //
        // Carrying the frozen copies here was the bug: a session closed by the
        // observer kept rendering as "运行中 / 等待实例关闭" while the summary above it,
        // which reads the live rows, said 0 running - the page contradicted itself on
        // one screen. Freezing membership is deliberate (the filtered set must not
        // shift under the reader); freezing status was not.
        //
        // `filter_map` drops a session that is in the snapshot but no longer in the
        // live history; it cannot be rendered, and showing a stale copy would
        // reintroduce the same problem.
        let live = |id: i64| current.sessions.iter().find(|s| s.id == id).cloned();
        let rows: Vec<_> = snapshot
            .indices
            .iter()
            .skip(((page - 1) * 20) as usize)
            .take(20)
            .filter_map(|i| live(snapshot.history.sessions[*i].id))
            .collect();
        // Groups cover the whole filtered set so a collapsed instance reports its
        // real totals; each group's rows are that instance's own requested page,
        // so one instance paging forward does not move another's. Built with the
        // same helper as the direct query so the two cannot disagree about what a
        // group's page contains.
        let filtered: Vec<_> = snapshot
            .indices
            .iter()
            .filter_map(|i| live(snapshot.history.sessions[*i].id))
            .collect();
        let groups = super::sessions::assign_group_pages(
            super::sessions::group_sessions(&filtered),
            &filtered,
            query.group_page,
            20,
        );
        Ok(ObservedSessionsPage {
            groups,
            sessions: rows,
            total,
            history_total: current.history_total,
            snapshot: Some(token.to_string()),
            history_changed: current.sessions != snapshot.history.sessions,
            filtered_seconds: snapshot.seconds.clone(),
            boundary: snapshot.boundary,
            new_records: current
                .sessions
                .iter()
                .filter(|s| s.id > snapshot.boundary)
                .count() as i64,
            instances: current.instances.clone(),
            page,
            page_size: 20,
            total_seconds: current.total_seconds.clone(),
            unknown_sessions: current.unknown_sessions,
            baseline_sessions: current.baseline_sessions,
            running_sessions: current.running_sessions,
        })
    }
    pub fn trace_statements(&self, observer: fn(&str)) {
        self.repo.trace_statements(observer);
    }
}
