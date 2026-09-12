mod support;
use minechronicle_lib::{
    database::{
        activity::{StatisticsFilter, StatisticsPage},
        DbResult, Repository,
    },
    scanner::GameRootScanner,
};
use std::{fs, path::Path};
use support::*;

fn db<T>(result: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    result.map_err(|error| error as _)
}

fn import(repo: &mut Repository, root: &Path) -> TestResult {
    db(repo.import(
        &GameRootScanner::default()
            .scan(&[root.to_owned()], |_| true)
            .into(),
        &[root.to_owned()],
    ))?;
    Ok(())
}

fn write_stats(world: &Path, player: &str, value: serde_json::Value) -> TestResult {
    fs::create_dir_all(world.join("stats"))?;
    fs::write(
        world.join(format!("stats/{player}.json")),
        serde_json::to_vec(&value)?,
    )?;
    Ok(())
}

fn groups(page: &StatisticsPage) -> Vec<(&str, &str, usize)> {
    page.categories
        .iter()
        .map(|category| {
            (
                category.id.as_str(),
                category.label.as_str(),
                category.count,
            )
        })
        .collect()
}

#[test]
fn modern_categories_distinguish_object_interactions_from_general_counters() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Categories")?;
    write_stats(
        &world,
        PLAYER,
        serde_json::json!({"stats": {
            "minecraft:custom": {
                "minecraft:play_time": 1200,
                "minecraft:interact_with_blast_furnace": 2,
                "minecraft:open_chest": 3,
                "minecraft:inspect_hopper": 4,
                "minecraft:fill_cauldron": 5,
                "minecraft:enchant_item": 6,
                "minecraft:clean_armor": 7,
                "minecraft:sleep_in_bed": 8,
                "mod:open_crate": 9,
                "minecraft:fish_caught": 10,
                "minecraft:mob_kills": 11,
                "minecraft:damage_blocked_by_shield": 12,
                "gateways:gates_defeated": 13
            },
            "minecraft:mined": {"minecraft:stone": 1},
            "minecraft:crafted": {"minecraft:stone": 1},
            "minecraft:used": {"minecraft:stone": 1},
            "minecraft:broken": {"minecraft:stone": 1},
            "minecraft:picked_up": {"minecraft:stone": 1},
            "minecraft:dropped": {"minecraft:stone": 1},
            "minecraft:killed": {"minecraft:zombie": 1},
            "minecraft:killed_by": {"minecraft:zombie": 1},
            "mod:special": {"mod:open_crate": 1}
        }}),
    )?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    import(&mut repo, &root)?;
    let all = db(repo.statistics(&StatisticsFilter::default()))?;
    assert_eq!(
        groups(&all),
        vec![
            ("interaction", "交互", 8),
            ("mined", "摧毁", 1),
            ("crafted", "合成", 1),
            ("used", "使用", 1),
            ("broken", "损坏", 1),
            ("picked_up", "拾取", 1),
            ("dropped", "丢弃", 1),
            ("killed", "杀死", 1),
            ("killed_by", "被杀", 1),
            ("custom", "常规", 5),
            ("other", "其他", 1),
        ]
    );
    let interaction = db(repo.statistics(&StatisticsFilter {
        group: "interaction".into(),
        ..Default::default()
    }))?;
    assert_eq!(interaction.total, 8);
    assert_eq!(groups(&interaction), groups(&all));
    assert_eq!(interaction.counters["play_ticks"], "1200");
    assert_eq!(interaction.counters["mob_kills"], "11");
    assert_eq!(interaction.sources, all.sources);
    assert!(interaction.rows.iter().all(|row| {
        row.category == "minecraft:custom"
            && ![
                "minecraft:fish_caught",
                "minecraft:mob_kills",
                "minecraft:damage_blocked_by_shield",
                "gateways:gates_defeated",
            ]
            .contains(&row.key.as_str())
    }));
    for category in &all.categories {
        let selected = db(repo.statistics(&StatisticsFilter {
            group: category.id.clone(),
            ..Default::default()
        }))?;
        assert_eq!(selected.total, category.count);
    }
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            group: "all".into(),
            ..Default::default()
        }))?
        .total,
        all.total
    );
    let error = repo.statistics(&StatisticsFilter {
        group: "missing_category".into(),
        ..Default::default()
    });
    assert_eq!(
        error.err().map(|error| error.to_string()).as_deref(),
        Some("统计类别无效")
    );
    let default_filter: StatisticsFilter = serde_json::from_str("{}")?;
    assert!(default_filter.group.is_empty());
    Ok(())
}

#[test]
fn legacy_categories_handle_named_numeric_items_and_old_interaction_counters() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Legacy categories")?;
    write_stats(
        &world,
        PLAYER,
        serde_json::json!({
            "stat.playOneMinute": 1200,
            "stat.mineBlock.minecraft.stone": 1,
            "stat.mineBlock.12": 1,
            "stat.craftItem.minecraft.stone": 1,
            "stat.useItem.minecraft.stone": 1,
            "stat.breakItem.minecraft.stone": 1,
            "stat.pickup.minecraft.stone": 1,
            "stat.drop.minecraft.stone": 1,
            "stat.killEntity.Zombie": 1,
            "stat.entityKilledBy.Zombie": 1,
            "stat.furnaceInteraction": 2,
            "stat.chestOpened": 3,
            "stat.itemEnchanted": 4,
            "stat.cauldronUsed": 5,
            "stat.fishCaught": 6,
            "stat.mobKills": 7,
            "achievement.openInventory": {"value": 1}
        }),
    )?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    import(&mut repo, &root)?;
    let all = db(repo.statistics(&StatisticsFilter::default()))?;
    assert_eq!(
        groups(&all),
        vec![
            ("interaction", "交互", 4),
            ("mined", "摧毁", 2),
            ("crafted", "合成", 1),
            ("used", "使用", 1),
            ("broken", "损坏", 1),
            ("picked_up", "拾取", 1),
            ("dropped", "丢弃", 1),
            ("killed", "杀死", 1),
            ("killed_by", "被杀", 1),
            ("custom", "常规", 3),
            ("other", "其他", 1),
        ]
    );
    let mined = db(repo.statistics(&StatisticsFilter {
        group: "mined".into(),
        ..Default::default()
    }))?;
    assert_eq!(mined.total, 2);
    assert!(mined
        .rows
        .iter()
        .all(|row| row.key.starts_with("stat.mineBlock.")));
    let general = db(repo.statistics(&StatisticsFilter {
        group: "custom".into(),
        ..Default::default()
    }))?;
    assert!(general.rows.iter().any(|row| row.key == "stat.mobKills"));
    assert!(general.rows.iter().any(|row| row.key == "stat.fishCaught"));
    Ok(())
}

#[test]
fn category_counts_follow_search_scope_and_mode_before_filter_sort_and_pagination() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Category pages")?;
    write_stats(
        &world,
        PLAYER,
        serde_json::json!({"stats": {
            "minecraft:custom": {"minecraft:play_time": 1200},
            "minecraft:crafted": {"test:stone_old": 8},
            "minecraft:mined": {"test:stone_old": 9}
        }}),
    )?;
    write_stats(
        &world,
        OTHER,
        serde_json::json!({"stats": {
            "minecraft:custom": {"minecraft:play_time": 900},
            "minecraft:used": {"test:stone_unselected": 99}
        }}),
    )?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    import(&mut repo, &root)?;
    let crafted: serde_json::Map<_, _> = (0..110)
        .map(|n| (format!("test:stone_{n:03}"), serde_json::json!(n)))
        .collect();
    let mined: serde_json::Map<_, _> = (0..110)
        .map(|n| (format!("test:stone_{n:03}"), serde_json::json!(n * 100)))
        .collect();
    write_stats(
        &world,
        PLAYER,
        serde_json::json!({"stats": {
            "minecraft:custom": {"minecraft:play_time": 2400},
            "minecraft:crafted": crafted,
            "minecraft:mined": mined
        }}),
    )?;
    import(&mut repo, &root)?;
    let world_path = fs::canonicalize(&world)?.to_string_lossy().into_owned();
    let filter = || StatisticsFilter {
        uuid: PLAYER.into(),
        world_path: world_path.clone(),
        query: "stone_".into(),
        group: "crafted".into(),
        sort: "value_desc".into(),
        ..Default::default()
    };
    let first = db(repo.statistics(&filter()))?;
    let second = db(repo.statistics(&StatisticsFilter {
        offset: 100,
        ..filter()
    }))?;
    assert_eq!(
        groups(&first),
        vec![("mined", "摧毁", 110), ("crafted", "合成", 110)]
    );
    assert_eq!(groups(&second), groups(&first));
    assert_eq!(first.total, 110);
    assert_eq!(first.rows.len(), 100);
    assert_eq!(second.rows.len(), 10);
    assert_eq!(first.rows[0].value.as_deref(), Some("109"));
    assert_eq!(second.rows[0].value.as_deref(), Some("9"));
    assert_eq!(second.rows[9].value.as_deref(), Some("0"));
    assert!(first
        .rows
        .iter()
        .chain(&second.rows)
        .all(|row| row.category == "minecraft:crafted"));
    assert_eq!(first.counters["play_ticks"], "2400");
    assert_eq!(first.sources, 1);
    let ascending = db(repo.statistics(&StatisticsFilter {
        sort: "value_asc".into(),
        offset: 100,
        ..filter()
    }))?;
    assert_eq!(ascending.rows[0].value.as_deref(), Some("100"));
    assert_eq!(ascending.rows[9].value.as_deref(), Some("109"));
    let initial = db(repo.statistics(&StatisticsFilter {
        mode: "initial".into(),
        ..filter()
    }))?;
    assert_eq!(initial.total, 1);
    assert_eq!(
        groups(&initial),
        vec![("mined", "摧毁", 1), ("crafted", "合成", 1)]
    );
    assert_eq!(initial.counters["play_ticks"], "1200");
    let empty_group = db(repo.statistics(&StatisticsFilter {
        group: "interaction".into(),
        ..filter()
    }))?;
    assert_eq!(empty_group.total, 0);
    assert_eq!(groups(&empty_group), groups(&first));
    let no_search_match = db(repo.statistics(&StatisticsFilter {
        query: "absent-key".into(),
        ..filter()
    }))?;
    assert_eq!(no_search_match.total, 0);
    assert!(no_search_match.categories.is_empty());
    Ok(())
}
