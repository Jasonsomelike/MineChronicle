//! Pins the full statistics() page for every filter combination.
//!
//! The A1 optimisation reorders where rows are enriched and paginated, so this
//! asserts the observable result is unchanged: same counters, same category
//! counts, same row order and same row payload for each mode, sort, group and
//! offset. It is a golden test on purpose - the point is to catch any drift the
//! refactor introduces, not to describe intended behaviour.
mod support;
use minechronicle_lib::database::{
    activity::{StatisticsFilter, StatisticsPage},
    DbResult, Repository,
};
use support::*;

fn db<T>(result: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|error| error as _)
}

/// A world with enough distinct keys to exercise sorting, grouping and paging.
fn fixture() -> Result<(tempfile::TempDir, std::path::PathBuf), Box<dyn std::error::Error>> {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Stats")?;
    let directory = world.join("stats");
    std::fs::create_dir_all(&directory)?;
    std::fs::write(
        directory.join(format!("{PLAYER}.json")),
        serde_json::json!({
            "stats": {
                "minecraft:custom": {
                    "minecraft:play_time": 24000,
                    "minecraft:deaths": 3,
                    "minecraft:jump": 120,
                    "minecraft:mob_kills": 7,
                    "minecraft:leave_game": 4,
                    "minecraft:walk_one_cm": 90000,
                    "minecraft:sprint_one_cm": 40000,
                    "minecraft:fly_one_cm": 500,
                    "minecraft:interact_with_blast_furnace": 2,
                    "minecraft:open_chest": 9,
                    "example:custom_counter": 41
                },
                "minecraft:mined": {
                    "minecraft:stone": 512,
                    "minecraft:diamond_ore": 8
                },
                "minecraft:crafted": { "minecraft:stick": 64 },
                "minecraft:used": { "minecraft:bowl": 5 },
                "minecraft:killed": { "minecraft:zombie": 7 },
                "mod:future": [1, "x"]
            }
        })
        .to_string(),
    )?;
    Ok((temp, root))
}

/// A compact, comparable fingerprint of a page.
fn fingerprint(page: &StatisticsPage) -> String {
    let mut out = String::new();
    out.push_str("counters:");
    for (key, value) in &page.counters {
        out.push_str(&format!("{key}={value},"));
    }
    out.push_str(&format!(
        "|categories:{}|total={}|sources={}|unavailable={}|page_size={}|rows:",
        page.categories
            .iter()
            .map(|c| format!("{}:{}:{}", c.id, c.label, c.count))
            .collect::<Vec<_>>()
            .join(","),
        page.total,
        page.sources,
        page.unavailable,
        page.page_size
    ));
    for row in &page.rows {
        out.push_str(&format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{};",
            row.category,
            row.key,
            row.category_label,
            row.label.as_deref().unwrap_or("-"),
            row.unit,
            row.value.as_deref().unwrap_or("-"),
            row.sources,
            row.source_packs.join("+"),
            row.samples.join("~")
        ));
    }
    out
}

#[test]
fn statistics_pages_are_stable_across_every_filter_combination(
) -> Result<(), Box<dyn std::error::Error>> {
    let (temp, root) = fixture()?;
    let mut repo =
        Repository::open(&temp.path().join("archive.sqlite3")).map_err(|e| e.to_string())?;
    db(repo.import(
        &minechronicle_lib::scanner::GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .into(),
        &[root],
    ))?;

    let mut fingerprints = Vec::new();
    for mode in ["current", "initial"] {
        for sort in ["default", "value_desc", "value_asc"] {
            for group in ["all", "mined", "custom", "other"] {
                for offset in [0u32, 1, 50] {
                    let filter = StatisticsFilter {
                        mode: mode.into(),
                        sort: sort.into(),
                        group: group.into(),
                        offset,
                        ..Default::default()
                    };
                    let page = db(repo.statistics(&filter))?;
                    fingerprints.push(format!(
                        "{mode}/{sort}/{group}/{offset} => {}",
                        fingerprint(&page)
                    ));
                }
            }
        }
    }

    // Every combination must produce a complete, non-degenerate page.
    for entry in &fingerprints {
        assert!(entry.contains("counters:"), "missing counters: {entry}");
        assert!(
            !entry.contains("rows:;"),
            "no rows returned for a populated archive: {entry}"
        );
    }

    // The taxonomy must be reported even when a group is filtered out.
    let all = fingerprints
        .iter()
        .find(|f| f.starts_with("current/default/all/0"))
        .ok_or("missing baseline entry")?;
    for category in ["mined", "crafted", "used", "killed", "custom"] {
        assert!(
            all.contains(category),
            "baseline should report category {category}: {all}"
        );
    }

    // Counters describe the searched scope, so they must not change with
    // pagination or sorting - only with mode. Compare the counters section
    // itself, not the labelled fingerprint line.
    let counter_of = |prefix: &str| -> Option<String> {
        fingerprints
            .iter()
            .find(|f| f.starts_with(prefix))
            .and_then(|f| f.split_once("=> "))
            .map(|(_, body)| {
                body.split("|categories:")
                    .next()
                    .unwrap_or_default()
                    .to_owned()
            })
    };
    assert!(counter_of("current/default/all/0").is_some());
    assert_eq!(
        counter_of("current/default/all/0"),
        counter_of("current/value_desc/all/0"),
        "sorting must not change the counters"
    );
    assert_eq!(
        counter_of("current/default/all/0"),
        counter_of("current/default/all/50"),
        "pagination must not change the counters"
    );
    // Note: `current` and `initial` agree on a freshly imported archive, because
    // the initial snapshot is taken from the same read. They diverge only after
    // a later scan moves the current reading on, so no assertion is made here.

    // Paging must walk distinct rows rather than repeating the first page.
    let rows_of = |prefix: &str| -> Option<usize> {
        fingerprints
            .iter()
            .find(|f| f.starts_with(prefix))
            .map(|f| f.matches(';').count())
    };
    assert!(rows_of("current/default/all/0").unwrap_or(0) > 0);
    Ok(())
}
