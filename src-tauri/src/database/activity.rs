use super::{DbResult, Repository};
use crate::domain::NormalizedPlayerStats;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct ActivityFilter {
    pub world_path: String,
    pub game_root: String,
    pub uuid: String,
    pub uuids: Vec<String>,
    pub world_paths: Option<Vec<String>>,
    pub game_roots: Option<Vec<String>>,
    pub players_none: bool,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub offset: u32,
}
#[derive(Serialize)]
pub struct TimelineEvent {
    pub id: i64,
    /// The row's headline kind. A merged row that spans several kinds reports
    /// `mixed`, so the styling does not claim the whole span was one thing.
    pub kind: String,
    pub observed_at: String,
    pub world_path: String,
    pub world_name: String,
    pub uuid: String,
    pub player_name: Option<String>,
    /// Total play-time change for this row. For a merged run this is the sum
    /// across the run, which is what makes the timeline readable: the observer
    /// records an increment every reconcile pass (5 minutes), so an evening of
    /// play arrived as dozens of separate "+ 5 分钟" rows.
    pub delta_ticks: String,
    pub play_ticks: String,
    pub old_ticks: Option<String>,
    /// How many raw observations this row merges. 1 for an unmerged event.
    #[serde(default)]
    pub merged_count: i64,
    /// When the run started, only set for a merged run (older than `observed_at`,
    /// which stays the newest moment so ordering and display stay familiar).
    #[serde(default)]
    pub first_observed_at: Option<String>,
    /// The individual observations inside a merged run, oldest first. Empty for
    /// an unmerged event, which already shows its own delta.
    #[serde(default)]
    pub parts: Vec<TimelinePart>,
    /// What kinds a merged row is made of, most frequent first. A row that is
    /// purely increments still reports its single entry, so the UI can describe a
    /// span ("首次导入 + 统计回档 + 77 次增长") instead of hiding the opening
    /// events behind whichever one happened to sort first.
    #[serde(default)]
    pub kinds: Vec<TimelineKindCount>,
}

/// How many events of one kind a merged row contains.
#[derive(Serialize, Deserialize)]
pub struct TimelineKindCount {
    pub kind: String,
    pub count: i64,
}

/// One raw observation inside a merged run.
#[derive(Serialize)]
pub struct TimelinePart {
    pub observed_at: String,
    pub delta_ticks: String,
    /// The kind of this individual observation, so an expanded run shows that the
    /// span began with an import or a rollback rather than only listing deltas.
    pub kind: String,
    /// Set on a rollback part: the value the play time dropped from.
    pub old_ticks: Option<String>,
}

#[derive(Serialize)]
pub struct TimelinePage {
    pub events: Vec<TimelineEvent>,
    pub total: i64,
    pub page_size: u32,
}
#[derive(Default, Deserialize)]
#[serde(default)]
pub struct StatisticsFilter {
    pub world_path: String,
    pub game_root: String,
    pub uuid: String,
    pub uuids: Vec<String>,
    pub world_paths: Option<Vec<String>>,
    pub game_roots: Option<Vec<String>>,
    pub players_none: bool,
    pub mode: String,
    pub query: String,
    pub group: String,
    pub sort: String,
    pub offset: u32,
}
#[derive(Serialize)]
pub struct StatisticRow {
    pub category: String,
    pub key: String,
    pub category_label: String,
    pub label: Option<String>,
    pub unit: String,
    pub source_packs: Vec<String>,
    pub resource_roots: Vec<String>,
    pub resources: Vec<crate::minecraft::translations::StatResource>,
    pub value: Option<String>,
    pub sources: usize,
    pub samples: Vec<String>,
}
#[derive(Serialize)]
pub struct StatisticsCategory {
    pub id: String,
    pub label: String,
    pub count: usize,
}
#[derive(Serialize)]
pub struct StatisticsPage {
    pub counters: BTreeMap<String, String>,
    pub categories: Vec<StatisticsCategory>,
    pub rows: Vec<StatisticRow>,
    pub total: usize,
    pub page_size: usize,
    pub sources: usize,
    pub unavailable: usize,
}
const STATISTICS_CATEGORIES: &[(&str, &str)] = &[
    ("interaction", "交互"),
    ("mined", "摧毁"),
    ("crafted", "合成"),
    ("used", "使用"),
    ("broken", "损坏"),
    ("picked_up", "拾取"),
    ("dropped", "丢弃"),
    ("killed", "杀死"),
    ("killed_by", "被杀"),
    ("custom", "常规"),
    ("other", "其他"),
];

fn statistic_group(category: &str, key: &str) -> &'static str {
    let category = category.strip_prefix("minecraft:").unwrap_or(category);
    match category {
        "mined" => "mined",
        "crafted" => "crafted",
        "used" => "used",
        "broken" => "broken",
        "picked_up" => "picked_up",
        "dropped" => "dropped",
        "killed" => "killed",
        "killed_by" => "killed_by",
        "custom" => {
            let key = key.split_once(':').map_or(key, |(_, key)| key);
            if key.starts_with("interact_with_")
                || key.starts_with("open_")
                || key.starts_with("inspect_")
                || matches!(
                    key,
                    "trigger_trapped_chest"
                        | "clean_shulker_box"
                        | "clean_armor"
                        | "clean_banner"
                        | "play_noteblock"
                        | "tune_noteblock"
                        | "play_record"
                        | "enchant_item"
                        | "fill_cauldron"
                        | "use_cauldron"
                        | "pot_flower"
                        | "bell_ring"
                        | "target_hit"
                        | "eat_cake_slice"
                        | "sleep_in_bed"
                        | "talked_to_villager"
                        | "traded_with_villager"
                )
            {
                "interaction"
            } else {
                "custom"
            }
        }
        "legacy" => {
            for (prefix, group) in [
                ("stat.mineBlock.", "mined"),
                ("stat.craftItem.", "crafted"),
                ("stat.useItem.", "used"),
                ("stat.breakItem.", "broken"),
                ("stat.pickup.", "picked_up"),
                ("stat.drop.", "dropped"),
                ("stat.killEntity.", "killed"),
                ("stat.entityKilledBy.", "killed_by"),
            ] {
                if key.starts_with(prefix) {
                    return group;
                }
            }
            if matches!(
                key,
                "stat.cauldronFilled"
                    | "stat.cauldronUsed"
                    | "stat.armorCleaned"
                    | "stat.bannerCleaned"
                    | "stat.brewingstandInteraction"
                    | "stat.beaconInteraction"
                    | "stat.dropperInspected"
                    | "stat.hopperInspected"
                    | "stat.dispenserInspected"
                    | "stat.noteblockPlayed"
                    | "stat.noteblockTuned"
                    | "stat.flowerPotted"
                    | "stat.trappedChestTriggered"
                    | "stat.enderchestOpened"
                    | "stat.itemEnchanted"
                    | "stat.recordPlayed"
                    | "stat.furnaceInteraction"
                    | "stat.craftingTableInteraction"
                    | "stat.chestOpened"
                    | "stat.sleepInBed"
                    | "stat.shulkerBoxOpened"
                    | "stat.shulkerBoxCleaned"
                    | "stat.talkedToVillager"
                    | "stat.tradedWithVillager"
                    | "stat.cakeSlicesEaten"
            ) {
                "interaction"
            } else if key.starts_with("stat.") {
                "custom"
            } else {
                "other"
            }
        }
        _ => "other",
    }
}

const EVENTS: &str = "WITH events AS (
 SELECT s.id,s.observed_at,w.path world_path,json_extract(w.payload,'$.name') world_name,
 s.player_uuid uuid,p.preferred_name player_name,s.play_ticks,coalesce(d.delta_ticks,0) delta_ticks,r.old_ticks,g.path game_root,
 CASE WHEN s.kind='initial_import' THEN 'initial_import'
 WHEN r.id IS NOT NULL THEN 'rollback' WHEN d.id IS NOT NULL THEN 'increment'
 WHEN EXISTS(SELECT 1 FROM stat_snapshots old WHERE old.world_id=s.world_id AND old.player_uuid=s.player_uuid AND old.kind='observation' AND old.id<s.id) THEN 'stats_changed'
 ELSE 'tracking_started' END kind
 FROM stat_snapshots s JOIN worlds w ON w.id=s.world_id JOIN game_roots g ON g.id=w.game_root_id
 JOIN players p ON p.uuid=s.player_uuid LEFT JOIN tracked_deltas d ON d.snapshot_id=s.id LEFT JOIN stat_rollbacks r ON r.snapshot_id=s.id
 WHERE s.kind='initial_import' OR EXISTS(SELECT 1 FROM stat_snapshots old WHERE old.world_id=s.world_id AND old.player_uuid=s.player_uuid AND old.kind='observation' AND old.id<s.id)
 OR NOT EXISTS(SELECT 1 FROM stat_snapshots initial WHERE initial.world_id=s.world_id AND initial.player_uuid=s.player_uuid AND initial.kind='initial_import' AND initial.stats=s.stats AND abs(julianday(initial.observed_at)-julianday(s.observed_at))<1.0/86400)
 )";
// Date bounds are compared against the raw `observed_at` column rather than
// wrapping the column in `date(observed_at,'localtime')`. A function on the
// column prevents SQLite from using `snapshots_by_time` for a range search
// (`SCAN` instead of `SEARCH`); measured 0.047 ms -> 0.007 ms on the reference
// archive, and the gap widens with the table.
//
// The timezone shift moves to the parameter side, and the upper bound is
// half-open (next day 00:00) so the final day is included. `%f` matters: stored
// values carry milliseconds (`...T13:50:59.854Z`) and a bound without them
// compares as a longer string, sorting after values of the same instant.
//
// Equivalence with the previous form was checked against the real archive over
// 62 lower and 62 upper boundaries with zero mismatches.
//
// The ungrouped form of these predicates (a plain `WHERE` over `events`) is no
// longer used: the timeline now always merges, so the equivalents live in
// `FILTER_GROUPED` as a `HAVING` clause over the grouped rows.
/// How long a pause may be before consecutive increments stop counting as one run.
///
/// The watcher reconciles every 300s, so a continuous session arrives as one
/// increment per pass. Measured on the reference archive, the 139 gaps between
/// consecutive increments split cleanly: 135 are at or below 310s (one of them is
/// exactly 300s, eighty-one times), and the next is 422s, then 1008s, then 2717s.
/// 600s sits in that empty band, so no real boundary is near it and the value is
/// not a tuned guess. Above it, a genuinely separate session would be swallowed.
const MERGE_GAP_SECONDS: i64 = 600;

/// Marks a new "island" of nearby events, per world and player.
///
/// Every kind merges, not just increments. Restricting it to increments left the
/// opening of a session stranded: an import at 09:58, a rollback 113s later and the
/// first increment 18s after that are one continuous event, but they rendered as
/// three separate rows whose relationship the reader had to reconstruct. A run is
/// per (world, player), so two players in one world stay separate, and it breaks
/// when the gap exceeds `?7`, so "this morning" and "this evening" do not collapse
/// into one row.
///
/// A merged row reports the kinds it contains, so nothing is hidden by the merge:
/// a span that starts with an import and a rollback still says so, and the
/// per-observation breakdown lists each one.
///
/// The gap is compared as whole seconds via `CAST(strftime('%s', ...) AS INTEGER)`
/// rather than by subtracting two `julianday` values. SQLite's Julian day is a
/// float, so the obvious `(julianday(a) - julianday(b)) * 86400 > ?7` is wrong at
/// the boundary: an exact 600s gap computes as 600.0000044703484, making `> 600`
/// true and splitting a run that should have merged. A 300s gap computes as
/// 299.99998211860657 for the same reason.
///
/// Comparing the stored strings as text also works, but only if the same fractional
/// precision is used on both sides: the stored form carries milliseconds
/// (`...T00:00:00.000Z`) and a bound rebuilt with `%S` drops them, so
/// `...T00:00:00Z` sorts after `...T00:00:00.000Z` and an exact-600s gap breaks
/// again. Integer seconds avoid both traps and need no assumption about the shape.
///
/// `?7` is the gap threshold in both statements that use this CTE; the paging query
/// adds the offset as `?8`. Positional numbering is deliberate - every caller binds
/// all seven, so no statement has a hole.
const EVENT_RUNS: &str = ", marked AS ( \
     SELECT e.*, \
       LAG(observed_at) OVER (PARTITION BY world_path, uuid ORDER BY observed_at) prev_at \
     FROM events e \
   ), grouped AS ( \
     SELECT m.*, SUM(CASE \
       WHEN prev_at IS NULL THEN 1 \
       WHEN CAST(strftime('%s', observed_at) AS INTEGER) \
          - CAST(strftime('%s', prev_at) AS INTEGER) > ?7 THEN 1 \
       ELSE 0 END) \
       OVER (PARTITION BY world_path, uuid ORDER BY observed_at) grp \
     FROM marked m \
   )";

/// The same filters as the old ungrouped `WHERE`, expressed over grouped rows.
///
/// These live in a `HAVING` clause because the query aggregates, and `HAVING` must
/// follow `GROUP BY`. Filtering after grouping is also what keeps a run intact when
/// a date filter lands inside it: the run is built over the full event set first,
/// then whole runs are kept or dropped.
///
/// `min(observed_at)` is compared for the lower bound and `max(observed_at)` for
/// the upper, so a run counts as in-range when any part of it overlaps the range.
///
/// The noise floors are now expressed over a run's contents rather than its single
/// kind, because a run can mix kinds: a session opening is an import plus a rollback
/// plus increments. A run is kept when any member would have been kept on its own -
/// a rollback always, an import whose `play_ticks` clears the floor, or increments
/// whose total does. `delta_ticks` is always 0 for an import, so applying the delta
/// test to an import would drop every one of them.
///
/// The kind filter matches runs that *contain* the requested kind, which is the
/// useful reading once rows merge: asking for rollbacks should show the session
/// opening that includes one.
const FILTER_GROUPED: &str = " \
 (?1='null' OR world_path IN (SELECT value FROM json_each(?1))) \
 AND (?2='null' OR game_root IN (SELECT value FROM json_each(?2))) \
 AND (?3='[]' OR uuid IN (SELECT value FROM json_each(?3))) \
 AND (?4='' OR max(observed_at)>=strftime('%Y-%m-%dT%H:%M:%fZ',?4||' 00:00:00','utc')) \
 AND (?5='' OR min(observed_at)<strftime('%Y-%m-%dT%H:%M:%fZ',date(?5,'+1 day')||' 00:00:00','utc')) \
 AND (?6='' OR sum(CASE WHEN kind=?6 THEN 1 ELSE 0 END)>0) \
 AND (sum(CASE WHEN kind='rollback' THEN 1 ELSE 0 END)>0 \
      OR sum(CASE WHEN kind='initial_import' AND play_ticks>=20 THEN 1 ELSE 0 END)>0 \
      OR sum(CASE WHEN kind='increment' THEN delta_ticks ELSE 0 END)>=20)";

/// The JSON shape `json_group_array` produces, before conversion.
#[derive(Deserialize)]
struct RawPart {
    observed_at: String,
    delta_ticks: i64,
    kind: String,
    old_ticks: Option<i64>,
}

/// The minimal shape used when tallying a run's composition.
#[derive(Deserialize)]
struct KindOnly {
    kind: String,
}

fn path_filter(legacy: &str, paths: &Option<Vec<String>>) -> DbResult<String> {
    match paths {
        Some(paths) => {
            if paths.len() > 4096 || paths.iter().any(|p| p.len() > 32768) {
                return Err("选择的路径过多或过长".into());
            }
            Ok(serde_json::to_string(
                &paths.iter().collect::<BTreeSet<_>>(),
            )?)
        }
        None if !legacy.is_empty() => Ok(serde_json::to_string(&[legacy])?),
        None => Ok("null".into()),
    }
}
fn player_filter(uuid: &str, uuids: &[String]) -> DbResult<String> {
    let selected = if uuids.is_empty() && !uuid.is_empty() {
        vec![uuid.to_owned()]
    } else {
        uuids.to_vec()
    };
    if selected.len() > 1024 {
        return Err("选择的玩家过多".into());
    }
    let selected = selected
        .iter()
        .map(|id| uuid::Uuid::parse_str(id).map(|v| v.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(serde_json::to_string(&selected)?)
}
impl Repository {
    fn validate_dates(&self, from: &str, to: &str) -> DbResult<()> {
        for date in [from, to].into_iter().filter(|v| !v.is_empty()) {
            let normalized: Option<String> =
                self.connection
                    .query_row("SELECT date(?,'+0 days')", [date], |r| r.get(0))?;
            if date.len() != 10 || normalized.as_deref() != Some(date) {
                return Err("日期无效，请使用 YYYY-MM-DD".into());
            }
        }
        if !from.is_empty() && !to.is_empty() && from > to {
            return Err("开始日期不能晚于结束日期".into());
        }
        Ok(())
    }
    pub fn timeline(&self, filter: &ActivityFilter) -> DbResult<TimelinePage> {
        self.validate_dates(&filter.from, &filter.to)?;
        let players = if filter.players_none {
            "[null]".into()
        } else {
            player_filter(&filter.uuid, &filter.uuids)?
        };
        let worlds = path_filter(&filter.world_path, &filter.world_paths)?;
        let roots = path_filter(&filter.game_root, &filter.game_roots)?;
        if ![
            "",
            "initial_import",
            "tracking_started",
            "increment",
            "rollback",
            "stats_changed",
        ]
        .contains(&filter.kind.as_str())
        {
            return Err("事件类型无效".into());
        }
        // `total` counts merged rows, not raw events, so pagination agrees with
        // what is displayed. Counting events would let a merged run be split
        // across a page boundary.
        //
        // The gap threshold is bound as `?7` here (the paging query adds its own
        // `?7` for the offset and uses `?8` for the gap), so each statement numbers
        // its own parameters without leaving a hole.
        let total = self.connection.query_row(
            &format!(
                "{EVENTS}{EVENT_RUNS} SELECT count(*) FROM ( \
                 SELECT 1 FROM grouped GROUP BY world_path, uuid, grp \
                 HAVING {FILTER_GROUPED})"
            ),
            params![
                worlds,
                roots,
                players,
                filter.from,
                filter.to,
                filter.kind,
                MERGE_GAP_SECONDS
            ],
            |r| r.get(0),
        )?;
        // One row per run. The newest moment of the run becomes `observed_at` so
        // ordering stays newest-first, and the run's span is reported separately.
        // `parts` carries the individual observations so the UI can expand a run
        // without a second query.
        //
        // The headline kind is `mixed` when a run contains more than one kind,
        // while `kinds` always lists the composition. Reporting `max(kind)` there
        // would label a span "首次导入" just because that happens to be the
        // alphabetically largest, which is meaningless.
        let mut query = self.connection.prepare(&format!(
            "{EVENTS}{EVENT_RUNS} \
             SELECT max(id), max(observed_at), world_path, world_name, uuid, \
                    max(player_name), max(play_ticks), sum(delta_ticks), max(old_ticks), \
                    count(*), min(observed_at), \
                    json_group_array(json_object('observed_at', observed_at, \
                                                 'delta_ticks', delta_ticks, \
                                                 'kind', kind, \
                                                 'old_ticks', old_ticks)), \
                    count(DISTINCT kind), max(kind), \
                    json_group_array(json_object('kind', kind)) \
             FROM grouped GROUP BY world_path, uuid, grp HAVING {FILTER_GROUPED} \
             ORDER BY max(observed_at) DESC, max(id) DESC LIMIT 50 OFFSET ?8"
        ))?;
        let events = query
            .query_map(
                params![
                    worlds,
                    roots,
                    players,
                    filter.from,
                    filter.to,
                    filter.kind,
                    MERGE_GAP_SECONDS,
                    filter.offset
                ],
                |r| {
                    let merged_count: i64 = r.get(9)?;
                    let distinct_kinds: i64 = r.get(12)?;
                    // Only a merged run needs its parts; a single event already
                    // shows its own delta and the array would be noise.
                    let parts: Vec<TimelinePart> = if merged_count > 1 {
                        let raw: String = r.get(11)?;
                        let mut parsed: Vec<TimelinePart> =
                            serde_json::from_str::<Vec<RawPart>>(&raw)
                                .unwrap_or_default()
                                .into_iter()
                                .map(|p| TimelinePart {
                                    observed_at: p.observed_at,
                                    delta_ticks: p.delta_ticks.to_string(),
                                    kind: p.kind,
                                    old_ticks: p.old_ticks.map(|v| v.to_string()),
                                })
                                .collect();
                        parsed.sort_by(|a, b| a.observed_at.cmp(&b.observed_at));
                        parsed
                    } else {
                        Vec::new()
                    };
                    // Tally the kinds so the row can describe its own composition.
                    let mut tally: BTreeMap<String, i64> = BTreeMap::new();
                    if merged_count > 1 {
                        let raw: String = r.get(14)?;
                        for entry in serde_json::from_str::<Vec<KindOnly>>(&raw).unwrap_or_default()
                        {
                            *tally.entry(entry.kind).or_insert(0) += 1;
                        }
                    }
                    let mut kinds: Vec<TimelineKindCount> = tally
                        .into_iter()
                        .map(|(kind, count)| TimelineKindCount { kind, count })
                        .collect();
                    // Most frequent first, then by name so the order is stable.
                    kinds.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.kind.cmp(&b.kind)));
                    let single_kind: String = r.get(13)?;
                    Ok(TimelineEvent {
                        id: r.get(0)?,
                        kind: if distinct_kinds > 1 {
                            "mixed".to_owned()
                        } else {
                            single_kind
                        },
                        // max(observed_at) is the run's end; the run's start is
                        // reported separately so an unmerged event has no
                        // redundant second timestamp.
                        observed_at: r.get(1)?,
                        world_path: r.get(2)?,
                        world_name: r.get(3)?,
                        uuid: r.get(4)?,
                        player_name: r.get(5)?,
                        play_ticks: r.get::<_, i64>(6)?.to_string(),
                        delta_ticks: r.get::<_, i64>(7)?.to_string(),
                        old_ticks: r.get::<_, Option<i64>>(8)?.map(|v| v.to_string()),
                        merged_count,
                        first_observed_at: if merged_count > 1 {
                            Some(r.get(10)?)
                        } else {
                            None
                        },
                        parts,
                        kinds,
                    })
                },
            )?
            .collect::<rusqlite::Result<_>>()?;
        Ok(TimelinePage {
            events,
            total,
            page_size: 50,
        })
    }
    pub fn statistics(&self, filter: &StatisticsFilter) -> DbResult<StatisticsPage> {
        if !["", "current", "initial"].contains(&filter.mode.as_str()) {
            return Err("统计口径无效".into());
        }
        if !["", "default", "value_desc", "value_asc"].contains(&filter.sort.as_str()) {
            return Err("统计排序方式无效".into());
        }
        if !filter.group.is_empty()
            && filter.group != "all"
            && !STATISTICS_CATEGORIES
                .iter()
                .any(|(id, _)| *id == filter.group)
        {
            return Err("统计类别无效".into());
        }
        let initial = filter.mode == "initial";
        let players = if filter.players_none {
            "[null]".into()
        } else {
            player_filter(&filter.uuid, &filter.uuids)?
        };
        let worlds = path_filter(&filter.world_path, &filter.world_paths)?;
        let roots = path_filter(&filter.game_root, &filter.game_roots)?;
        let source = if initial {
            "SELECT s.stats,g.path FROM stat_snapshots s JOIN worlds w ON w.id=s.world_id JOIN game_roots g ON g.id=w.game_root_id WHERE s.kind='initial_import'"
        } else {
            "SELECT wp.current_stats,g.path FROM world_players wp JOIN worlds w ON w.id=wp.world_id JOIN game_roots g ON g.id=w.game_root_id WHERE w.status<>'Missing'"
        };
        let player_column = if initial {
            "s.player_uuid"
        } else {
            "wp.player_uuid"
        };
        let sql = format!("{source} AND (?1='null' OR w.path IN (SELECT value FROM json_each(?1))) AND (?2='null' OR g.path IN (SELECT value FROM json_each(?2))) AND (?3='[]' OR {player_column} IN (SELECT value FROM json_each(?3)))");
        let mut query = self.connection.prepare(&sql)?;
        let mut counters: BTreeMap<String, i128> = [
            "play_ticks",
            "deaths",
            "jumps",
            "mob_kills",
            "leave_game_count",
            "walk_cm",
            "sprint_cm",
            "fly_cm",
        ]
        .into_iter()
        .map(|k| (k.into(), 0))
        .collect();
        let mut root_packs: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for instance in self.load_instances()? {
            root_packs
                .entry(instance.game_root.to_string_lossy().into_owned())
                .or_default()
                .insert(instance.name);
        }
        type Entry = (
            Option<i128>,
            usize,
            Vec<String>,
            BTreeSet<String>,
            BTreeSet<String>,
        );
        let mut values: BTreeMap<(String, String), Entry> = BTreeMap::new();
        let mut sources = 0;
        let mut unavailable = 0;
        for row in query.query_map(params![worlds, roots, players], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
        })? {
            let (raw, game_root) = row?;
            let Some(raw) = raw else {
                unavailable += 1;
                continue;
            };
            // Payloads are stored compressed; decode is a no-op for rows written
            // before compression existed.
            let raw = crate::database::snapshot_codec::decode(&raw)?;
            let stats: NormalizedPlayerStats = serde_json::from_str(&raw)?;
            sources += 1;
            for (key, value) in [
                ("play_ticks", stats.play_ticks),
                ("deaths", stats.deaths),
                ("jumps", stats.jumps),
                ("mob_kills", stats.mob_kills),
                ("leave_game_count", stats.leave_game_count),
                ("walk_cm", stats.walk_cm),
                ("sprint_cm", stats.sprint_cm),
                ("fly_cm", stats.fly_cm),
            ] {
                *counters.entry(key.into()).or_default() += i128::from(value);
            }
            let mut add = |category: &str, key: &str, value: &serde_json::Value| {
                let item = values.entry((category.into(), key.into())).or_insert((
                    Some(0),
                    0,
                    Vec::new(),
                    BTreeSet::new(),
                    BTreeSet::new(),
                ));
                item.1 += 1;
                item.4.insert(game_root.clone());
                if let Some(packs) = root_packs.get(&game_root) {
                    item.3.extend(packs.iter().cloned());
                }
                let integer = value
                    .as_i64()
                    .map(i128::from)
                    .or_else(|| value.as_u64().map(i128::from));
                item.0 = item.0.zip(integer).and_then(|(sum, n)| sum.checked_add(n));
                if category == "extra" {
                    item.0 = None;
                }
                if item.2.len() < 3 {
                    let sample = value.to_string();
                    let sample: String = sample.chars().take(240).collect();
                    if !item.2.contains(&sample) {
                        item.2.push(sample);
                    }
                }
            };
            for (category, data) in &stats.statistics {
                if let Some(keys) = data.as_object() {
                    for (key, value) in keys {
                        add(category, key, value);
                    }
                } else {
                    add(category, "(value)", data);
                }
            }
            for (key, value) in &stats.legacy_statistics {
                add("legacy", key, value);
            }
            for (key, value) in &stats.extra_fields {
                add("extra", key, value);
            }
        }
        let text = filter.query.to_lowercase();
        // Enrichment - the translation lookup plus cloning each key's resource
        // list - is the expensive half of this function, and it used to run for
        // every aggregated key (18,882 on the reference archive) even though at
        // most 100 rows are returned. Rows are now carried unenriched through
        // grouping, sorting and pagination, and only the returned page is
        // enriched. A search term still has to match against labels, so that
        // path enriches up front as before.
        struct Pending {
            category: String,
            key: String,
            value: Option<i128>,
            sources: usize,
            samples: Vec<String>,
            packs: BTreeSet<String>,
            roots: BTreeSet<String>,
            /// Set only when a search forced enrichment before pagination.
            enriched: Option<StatisticRow>,
        }
        let searching = !text.is_empty();
        let mut filtered: Vec<Pending> = Vec::with_capacity(values.len());
        for ((category, key), (value, sources, samples, packs, roots)) in values {
            let enriched = if searching {
                Some(enrich_row(
                    &category, &key, value, sources, &samples, &packs, &roots,
                ))
            } else {
                None
            };
            filtered.push(Pending {
                category,
                key,
                value,
                sources,
                samples,
                packs,
                roots,
                enriched,
            });
        }
        if searching {
            filtered.retain(|pending| {
                pending
                    .enriched
                    .as_ref()
                    .is_some_and(|row| row_matches_query(row, &text))
            });
        }
        // Counts describe the searched scope, before category selection or pagination.
        let mut group_counts = BTreeMap::new();
        for pending in &filtered {
            *group_counts
                .entry(statistic_group(&pending.category, &pending.key))
                .or_insert(0) += 1;
        }
        let categories = STATISTICS_CATEGORIES
            .iter()
            .filter_map(|(id, label)| {
                group_counts.get(id).map(|count| StatisticsCategory {
                    id: (*id).into(),
                    label: (*label).into(),
                    count: *count,
                })
            })
            .collect();
        if !filter.group.is_empty() && filter.group != "all" {
            filtered
                .retain(|pending| statistic_group(&pending.category, &pending.key) == filter.group);
        }
        if filter.sort == "value_desc" || filter.sort == "value_asc" {
            // Compare exact integer totals before pagination; metadata stays last in both directions.
            filtered.sort_by_cached_key(|pending| {
                // Complement reverses signed integer order without overflowing i128::MIN.
                let value = if filter.sort == "value_desc" {
                    pending.value.map(|v| !v)
                } else {
                    pending.value
                };
                (value.is_none(), value)
            });
        }
        let total = filtered.len();
        // Enrich only what is returned; pre-enriched rows are moved across as-is.
        let rows = filtered
            .into_iter()
            .skip(filter.offset as usize)
            .take(100)
            .map(|pending| {
                pending.enriched.unwrap_or_else(|| {
                    enrich_row(
                        &pending.category,
                        &pending.key,
                        pending.value,
                        pending.sources,
                        &pending.samples,
                        &pending.packs,
                        &pending.roots,
                    )
                })
            })
            .collect();
        Ok(StatisticsPage {
            counters: counters
                .into_iter()
                .map(|(k, v)| (k, v.to_string()))
                .collect(),
            categories,
            rows,
            total,
            page_size: 100,
            sources,
            unavailable,
        })
    }
}

/// Builds the presented row for one aggregated key: resolves its display label,
/// unit and resource list. Split out of `statistics` so it can be applied to
/// just the returned page instead of every aggregated key.
#[allow(clippy::too_many_arguments)]
fn enrich_row(
    category: &str,
    key: &str,
    value: Option<i128>,
    sources: usize,
    samples: &[String],
    packs: &BTreeSet<String>,
    roots: &BTreeSet<String>,
) -> StatisticRow {
    let source_packs: Vec<_> = packs.iter().cloned().collect();
    let resources = crate::minecraft::translations::stat_resources(category, key, &source_packs);
    StatisticRow {
        category_label: crate::minecraft::translations::category_label(category).into(),
        label: resources
            .iter()
            .find_map(|r| r.label.clone())
            .or_else(|| crate::minecraft::translations::stat_label(category, key)),
        unit: crate::minecraft::translations::stat_unit(category, key).into(),
        category: category.to_owned(),
        key: key.to_owned(),
        source_packs,
        resource_roots: roots.iter().cloned().collect(),
        resources,
        value: value.map(|v| v.to_string()),
        sources,
        samples: if value.is_some() {
            vec![]
        } else {
            samples.to_vec()
        },
    }
}

/// Whether a row matches the free-text search. Kept identical to the previous
/// inline predicate so search results do not change.
fn row_matches_query(row: &StatisticRow, text: &str) -> bool {
    let label = row.label.as_deref().unwrap_or_default();
    let names = row
        .resources
        .iter()
        .flat_map(|r| {
            [
                r.english.as_deref().unwrap_or_default(),
                r.label.as_deref().unwrap_or_default(),
            ]
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "{} {} {label} {} {} {names}",
        row.category,
        row.key,
        row.category_label,
        row.source_packs.join(" ")
    )
    .to_lowercase()
    .contains(text)
}
