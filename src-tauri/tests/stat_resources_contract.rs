mod support;
use minechronicle_lib::{
    database::{activity::StatisticsFilter, Repository},
    minecraft::translations::{stat_resources, stat_unit},
    scanner::GameRootScanner,
};
use support::*;

#[test]
fn units_follow_vanilla_formatters_and_do_not_guess_mod_units() {
    for (category, key, unit) in [
        ("minecraft:custom", "minecraft:play_time", "ticks"),
        ("legacy", "stat.playOneMinute", "ticks"),
        ("legacy", "stat.flyOneCm", "centimeters"),
        (
            "minecraft:custom",
            "minecraft:damage_absorbed",
            "damage_tenths",
        ),
        ("legacy", "stat.damageTaken", "damage_tenths"),
        ("legacy", "stat.mineBlock.12", "blocks"),
        ("minecraft:crafted", "gtceu:aluminium_ingot", "items"),
        ("minecraft:custom", "mod:unknown_time", "none"),
        ("mod:energy", "stored", "none"),
    ] {
        assert_eq!(stat_unit(category, key), unit);
    }
}

#[test]
fn names_resolve_material_templates_and_real_pack_resources() {
    let aluminium = stat_resources(
        "minecraft:crafted",
        "gtceu:aluminium_ingot",
        &["Create New Horizon".into()],
    );
    assert!(aluminium.iter().any(|r| r.label.as_deref() == Some("铝锭")));
    assert!(aluminium.iter().all(|r| r.origin != "reviewed"));
    let circuits = stat_resources(
        "minecraft:crafted",
        "gtceu:basic_electronic_circuit",
        &["Create New Horizon".into()],
    );
    assert!(circuits
        .iter()
        .any(|r| r.label.as_deref() == Some("基础电子电路")));
    let ore = stat_resources(
        "minecraft:mined",
        "gtceu:diorite_copper_ore",
        &["Create New Horizon".into()],
    );
    assert!(ore
        .iter()
        .any(|r| r.label.as_deref() == Some("闪长岩铜矿石")));
}
#[test]
fn modern_block_items_and_special_chests_have_icons_in_their_source_packs() {
    for key in [
        "minecraft:acacia_planks",
        "minecraft:bookshelf",
        "minecraft:chest",
    ] {
        let resources = stat_resources("minecraft:crafted", key, &["1.21.11-Fabric 0.18.4".into()]);
        assert!(!resources.is_empty());
        assert!(
            resources.iter().all(|r| r.icon.is_some()),
            "missing icon: {key}"
        );
    }
    let chest = stat_resources(
        "minecraft:crafted",
        "minecraft:chest",
        &["All the Mods 10".into()],
    );
    assert!(chest.iter().any(|r| r.icon.as_ref().is_some_and(
        |i| i.kind == "chest" && i.source.contains("textures/entity/chest/normal.png")
    )));
    let air = stat_resources(
        "minecraft:crafted",
        "minecraft:air",
        &["1.21.11-Fabric 0.18.4".into()],
    );
    assert!(air.iter().all(|r| r.icon.is_none()));
}

#[test]
fn bundled_resources_keep_native_dimensions_and_safe_images_with_complete_labels() -> TestResult {
    let catalog: std::collections::HashMap<
        String,
        Vec<minechronicle_lib::minecraft::translations::StatResource>,
    > = serde_json::from_str(include_str!("../resources/stat-resources.json"))?;
    assert!(catalog.len() >= 18882);
    let mut icons = 0;
    let mut checked = std::collections::HashSet::new();
    let mut native_items = 0;
    let mut rectangular_items = 0;
    for variants in catalog.values() {
        assert!(!variants.is_empty());
        for resource in variants {
            assert!(resource
                .label
                .as_ref()
                .is_some_and(|s| !s.is_empty() && !s.contains("%s")));
            if let Some(icon) = &resource.icon {
                let width = icon.width.unwrap_or(icon.size);
                let height = icon.height.unwrap_or(icon.size);
                assert!((1..=4096).contains(&width));
                assert!((1..=4096).contains(&height));
                assert_eq!(icon.size, width.max(height));
                if icon.kind == "item" {
                    if icon.size == 16 {
                        native_items += 1;
                    }
                    if width != height {
                        rectangular_items += 1;
                    }
                } else {
                    assert_eq!((width, height), (256, 256));
                }
                assert_eq!(icon.image.len(), 68);
                assert!(icon.image.ends_with(".png"));
                assert!(icon.image[..64].bytes().all(|b| b.is_ascii_hexdigit()));
                let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../public/stat-icons")
                    .join(&icon.image);
                if checked.insert(icon.image.clone()) {
                    let mut file = std::fs::File::open(path)?;
                    let mut bytes = [0; 24];
                    std::io::Read::read_exact(&mut file, &mut bytes)?;
                    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
                    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into()?), width);
                    assert_eq!(u32::from_be_bytes(bytes[20..24].try_into()?), height);
                }
                icons += 1;
            }
        }
    }
    assert!(icons > 10000);
    assert!(native_items > 1000);
    assert!(rectangular_items > 0);
    Ok(())
}

#[test]
fn special_models_and_interaction_statistics_use_matching_game_resources() {
    for (key, pack, kind) in [
        (
            "minecraft:enchanting_table",
            "1.21.8-Fabric 0.17.2",
            "model",
        ),
        ("minecraft:shield", "1.21.8-Fabric 0.17.2", "shield"),
        ("sophisticatedstorage:copper_chest", "ATM10s 1.7", "chest"),
    ] {
        let rows = stat_resources("minecraft:crafted", key, &[pack.into()]);
        assert!(
            rows.iter()
                .any(|r| r.icon.as_ref().is_some_and(|icon| icon.kind == kind)),
            "Missing special icon: {key}"
        );
    }
    for (key, texture) in [
        ("minecraft:interact_with_blast_furnace", "blast_furnace"),
        ("minecraft:interact_with_stonecutter", "stonecutter"),
        ("minecraft:enchant_item", "enchanting_table"),
        ("minecraft:damage_blocked_by_shield", "shield_base"),
        ("gateways:gates_defeated", "gate_pearl"),
    ] {
        let rows = stat_resources("minecraft:custom", key, &[]);
        assert!(
            rows.iter().any(|r| r
                .icon
                .as_ref()
                .is_some_and(|icon| icon.source.contains(texture))),
            "Missing interaction icon: {key}"
        );
    }
}

#[test]
fn data_versions_remain_metadata_and_chinese_search_returns_formatted_units() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "World")?;
    stats(&world, "stats", PLAYER, 1200)?;
    std::fs::write(world.join(format!("stats/{PLAYER}.json")), br#"{"stats":{"minecraft:crafted":{"gtceu:aluminium_ingot":48},"minecraft:custom":{"minecraft:play_time":1200}},"DataVersion":3955}"#)?;
    let mut repo = Repository::open(&temp.path().join("db"))
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    repo.import(
        &GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .into(),
        &[root],
    )
    .map_err(|e| std::io::Error::other(e.to_string()))?;
    let rows = repo
        .statistics(&StatisticsFilter {
            query: "铝锭".into(),
            ..Default::default()
        })
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    assert_eq!(rows.total, 1);
    assert_eq!(rows.rows[0].unit, "items");
    assert_eq!(rows.rows[0].value.as_deref(), Some("48"));
    let versions = repo
        .statistics(&StatisticsFilter {
            query: "DataVersion".into(),
            ..Default::default()
        })
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    assert!(versions.rows[0].value.is_none());
    assert_eq!(versions.rows[0].samples, vec!["3955"]);
    Ok(())
}
