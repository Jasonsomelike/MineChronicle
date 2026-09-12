use minechronicle_lib::minecraft::translations::StatResource;
use std::collections::HashMap;

fn catalog() -> HashMap<String, Vec<StatResource>> {
    serde_json::from_str(include_str!("../resources/stat-resources.json"))
        .unwrap_or_else(|error| panic!("invalid bundled statistics catalog: {error}"))
}

#[test]
fn screenshot_gregtech_resources_have_icons_in_every_observed_pack() {
    let catalog = catalog();
    for item in [
        "brick_dust",
        "bronze_dust",
        "bronze_ingot",
        "bronze_plate",
        "bronze_small_fluid_pipe",
        "coal_dust",
        "coke_oven",
        "coke_oven_hatch",
        "copper_ingot",
        "copper_plate",
        "copper_single_wire",
        "copper_small_fluid_pipe",
        "fireclay_dust",
        "iron_bolt",
        "iron_crowbar",
        "iron_file",
        "iron_hammer",
        "iron_saw",
        "iron_screw",
        "iron_screwdriver",
        "iron_rod",
        "iron_wrench",
        "long_iron_rod",
        "lp_steam_alloy_smelter",
        "lp_steam_solid_boiler",
        "primitive_blast_furnace",
        "tin_ingot",
        "wood_dust",
        "wrought_iron_nugget",
    ] {
        // Copper ingots use the vanilla registration in the installed GT packs.
        let resource = if item == "copper_ingot" {
            "minecraft:copper_ingot".to_owned()
        } else {
            format!("gtceu:{item}")
        };
        let suffix = format!("|{resource}");
        let rows: Vec<_> = catalog
            .iter()
            .filter(|(key, _)| key.ends_with(&suffix))
            .collect();
        assert!(!rows.is_empty(), "missing observed item {item}");
        for (stat, variants) in rows {
            for variant in variants {
                assert!(
                    variant.icon.is_some(),
                    "missing {stat} in {:?}",
                    variant.packs
                );
            }
        }
    }
}

#[test]
fn screenshot_draconic_modules_have_distinct_resource_icons() {
    let catalog = catalog();
    let mut images = std::collections::HashSet::new();
    for module in [
        "energy",
        "flight",
        "large_shield_capacity",
        "proj_accuracy",
        "proj_anti_immune",
        "proj_damage",
        "proj_penetration",
        "proj_velocity",
        "shield_capacity",
        "shield_control",
    ] {
        let suffix = format!("|draconicevolution:item_draconic_{module}");
        let rows: Vec<_> = catalog
            .iter()
            .filter(|(key, _)| key.ends_with(&suffix))
            .collect();
        assert!(!rows.is_empty(), "missing observed module {module}");
        for (stat, variants) in rows {
            for variant in variants {
                let icon = variant
                    .icon
                    .as_ref()
                    .unwrap_or_else(|| panic!("missing {stat} in {:?}", variant.packs));
                assert!(icon.source.contains("draconicevolution"), "{stat}");
                images.insert(icon.image.clone());
            }
        }
    }
    // All ten modules have their own game symbols, not one generic placeholder.
    assert!(images.len() >= 10);
}

#[test]
fn kill_statistics_use_entity_textures_for_observed_categories() {
    let catalog = catalog();
    for entity in [
        "minecraft:zombie",
        "minecraft:creeper",
        "minecraft:skeleton",
        "minecraft:cow",
        "minecraft:armadillo",
        "alexscaves:deep_one",
        "alexscaves:luxtructosaurus",
        "alexscaves:lanternfish",
        "alexsmobs:bison",
        "alexsmobs:soul_vulture",
        "alexsmobs:capuchin_monkey",
        "alexsmobs:catfish",
        "alexsmobs:comb_jelly",
        "ageofmythology:end_scholar",
        "ageofmythology:good_evil",
        "ageofmythology:hell_traveler",
        "ageofmythology:ice_thunder_soul",
        "ageofmythology:lost_one",
        "ageofmythology:sculk_shrieker",
        "ageofmythology:shadow_demon",
        "ad_astra:corrupted_lunarian",
        "ad_astra:martian_raptor",
        "aether:valkyrie",
        "aether:aechor_plant",
        "crabbersdelight:crab",
        "crittersandcompanions:koi_fish",
    ] {
        let mut observed = 0;
        for category in ["minecraft:killed", "minecraft:killed_by"] {
            let key = format!("{category}|{entity}");
            let Some(variants) = catalog.get(&key) else {
                continue;
            };
            observed += 1;
            for variant in variants {
                let icon = variant
                    .icon
                    .as_ref()
                    .unwrap_or_else(|| panic!("missing {key} in {:?}", variant.packs));
                assert_ne!(icon.kind, "item", "spawn egg used for {key}");
                assert!(icon.source.contains("textures/entity/"), "{key}");
                if entity == "crabbersdelight:crab" {
                    assert!(
                        icon.source.contains("textures/entity/blue_crab.png"),
                        "{key}"
                    );
                } else if entity == "crittersandcompanions:koi_fish" {
                    assert!(
                        icon.source.contains("textures/entity/koi_fish_1.png"),
                        "{key}"
                    );
                }
                assert_eq!(icon.width.unwrap_or(icon.size), 256, "{key}");
                assert_eq!(icon.height.unwrap_or(icon.size), 256, "{key}");
            }
        }
        assert!(observed > 0, "missing observed entity {entity}");
    }
}

#[test]
fn reported_inventory_and_interaction_icons_exist_in_every_observed_pack() {
    let catalog = catalog();
    for resource in [
        "forbidden_arcanus:interact_with_pedestal",
        "minecraft:clean_armor",
        "minecraft:clean_banner",
        "minecraft:clean_shulker_box",
        "minecraft:open_shulker_box",
        "minecraft:sleep_in_bed",
        "minecraft:talked_to_villager",
        "minecraft:traded_with_villager",
        "the_bumblezone:interact_with_buzzing_briefcase",
        "the_bumblezone:interact_with_crystalline_flower",
        "actuallyadditions:display_stand",
        "actuallyadditions:empowerer",
        "stat.craftItem.270",
        "stat.craftItem.271",
        "stat.craftItem.280",
        "stat.craftItem.5",
        "stat.craftItem.58",
        "ad_astra:tier_1_rocket",
        "ad_astra:tier_2_rocket",
        "ad_astra:tier_3_rocket",
        "ad_astra:tier_4_rocket",
        "ad_astra_rocketed:tier_5_rocket",
        "ad_astra_rocketed:tier_6_rocket",
        "ad_astra_rocketed:tier_7_rocket",
        "slashblade:slashblade",
        "slashblade:slashblade_silverbamboo",
        "slashblade:slashblade_white",
        "slashblade:slashblade_wood",
    ] {
        let suffix = format!("|{resource}");
        let rows: Vec<_> = catalog
            .iter()
            .filter(|(key, _)| key.ends_with(&suffix))
            .collect();
        assert!(!rows.is_empty(), "missing observed resource {resource}");
        for (stat, variants) in rows {
            for variant in variants {
                let icon = variant
                    .icon
                    .as_ref()
                    .unwrap_or_else(|| panic!("missing {stat} in {:?}", variant.packs));
                if resource.ends_with("_villager") {
                    assert!(
                        icon.source
                            .contains("textures/entity/villager/villager.png")
                            || icon.source.contains("textures/entity/villager/farmer.png"),
                        "partial profession overlay used for {stat}"
                    );
                    assert_eq!(icon.kind, "model");
                }
                if resource.starts_with("slashblade:slashblade") {
                    assert!(
                        icon.source.contains("/item_blade") || icon.source.contains("/ item_blade"),
                        "{stat}"
                    );
                }
            }
        }
    }
}
