use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::OnceLock};

#[derive(Clone, Deserialize, Serialize)]
pub struct StatIcon {
    pub image: String,
    pub size: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub kind: String,
    pub source: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct StatResource {
    pub packs: Vec<String>,
    pub label: Option<String>,
    pub english: Option<String>,
    pub origin: String,
    pub translation_source: Option<String>,
    pub icon: Option<StatIcon>,
}

fn resources() -> &'static HashMap<String, Vec<StatResource>> {
    static RESOURCES: OnceLock<HashMap<String, Vec<StatResource>>> = OnceLock::new();
    RESOURCES.get_or_init(|| {
        let compressed = include_bytes!(concat!(env!("OUT_DIR"), "/stat-resources.json.gz"));
        serde_json::from_reader(GzDecoder::new(compressed.as_slice())).unwrap_or_default()
    })
}

pub fn stat_resources(category: &str, key: &str, packs: &[String]) -> Vec<StatResource> {
    let Some(candidates) = resources().get(&format!("{category}|{key}")) else {
        return vec![];
    };
    let matching: Vec<_> = candidates
        .iter()
        .filter(|r| r.packs.iter().any(|p| packs.contains(p)))
        .cloned()
        .collect();
    if matching.is_empty() {
        candidates.first().cloned().into_iter().collect()
    } else {
        matching
    }
}

pub fn stat_unit(category: &str, key: &str) -> &'static str {
    match category {
        "minecraft:mined" => "blocks",
        "minecraft:crafted" | "minecraft:picked_up" | "minecraft:dropped" => "items",
        "minecraft:used" | "minecraft:broken" => "times",
        "minecraft:killed" | "minecraft:killed_by" => "times",
        "legacy" => {
            for (prefix, category) in [
                ("stat.mineBlock.", "minecraft:mined"),
                ("stat.craftItem.", "minecraft:crafted"),
                ("stat.useItem.", "minecraft:used"),
                ("stat.breakItem.", "minecraft:broken"),
                ("stat.pickup.", "minecraft:picked_up"),
                ("stat.drop.", "minecraft:dropped"),
                ("stat.killEntity.", "minecraft:killed"),
                ("stat.entityKilledBy.", "minecraft:killed_by"),
            ] {
                if key.starts_with(prefix) {
                    return stat_unit(category, "");
                }
            }
            match key {
                "stat.playOneMinute" | "stat.timeSinceDeath" | "stat.sneakTime" => "ticks",
                "stat.walkOneCm" | "stat.crouchOneCm" | "stat.sprintOneCm" | "stat.swimOneCm"
                | "stat.fallOneCm" | "stat.climbOneCm" | "stat.flyOneCm" | "stat.diveOneCm"
                | "stat.minecartOneCm" | "stat.boatOneCm" | "stat.pigOneCm" | "stat.horseOneCm"
                | "stat.aviateOneCm" => "centimeters",
                "stat.damageDealt" | "stat.damageTaken" => "damage_tenths",
                "stat.jump"
                | "stat.deaths"
                | "stat.mobKills"
                | "stat.playerKills"
                | "stat.leaveGame"
                | "stat.animalsBred"
                | "stat.fishCaught"
                | "stat.talkedToVillager"
                | "stat.tradedWithVillager" => "times",
                _ => "none",
            }
        }
        "minecraft:custom" => match key {
            "minecraft:play_time"
            | "minecraft:play_one_minute"
            | "minecraft:total_world_time"
            | "minecraft:time_since_death"
            | "minecraft:time_since_rest"
            | "minecraft:sneak_time" => "ticks",
            "minecraft:walk_one_cm"
            | "minecraft:crouch_one_cm"
            | "minecraft:sprint_one_cm"
            | "minecraft:walk_on_water_one_cm"
            | "minecraft:fall_one_cm"
            | "minecraft:climb_one_cm"
            | "minecraft:fly_one_cm"
            | "minecraft:walk_under_water_one_cm"
            | "minecraft:minecart_one_cm"
            | "minecraft:boat_one_cm"
            | "minecraft:pig_one_cm"
            | "minecraft:horse_one_cm"
            | "minecraft:aviate_one_cm"
            | "minecraft:swim_one_cm"
            | "minecraft:strider_one_cm"
            | "minecraft:dive_one_cm" => "centimeters",
            "minecraft:damage_dealt"
            | "minecraft:damage_dealt_absorbed"
            | "minecraft:damage_dealt_resisted"
            | "minecraft:damage_taken"
            | "minecraft:damage_blocked_by_shield"
            | "minecraft:damage_absorbed"
            | "minecraft:damage_resisted" => "damage_tenths",
            "minecraft:jump"
            | "minecraft:jumps"
            | "minecraft:deaths"
            | "minecraft:mob_kills"
            | "minecraft:player_kills"
            | "minecraft:leave_game"
            | "minecraft:animals_bred"
            | "minecraft:fish_caught"
            | "minecraft:talked_to_villager"
            | "minecraft:traded_with_villager"
            | "minecraft:eat_cake_slice"
            | "minecraft:fill_cauldron"
            | "minecraft:use_cauldron"
            | "minecraft:clean_armor"
            | "minecraft:clean_banner"
            | "minecraft:clean_shulker_box"
            | "minecraft:interact_with_brewingstand"
            | "minecraft:interact_with_beacon"
            | "minecraft:inspect_dropper"
            | "minecraft:inspect_hopper"
            | "minecraft:inspect_dispenser"
            | "minecraft:play_noteblock"
            | "minecraft:tune_noteblock"
            | "minecraft:pot_flower"
            | "minecraft:trigger_trapped_chest"
            | "minecraft:open_enderchest"
            | "minecraft:enchant_item"
            | "minecraft:play_record"
            | "minecraft:interact_with_furnace"
            | "minecraft:interact_with_crafting_table"
            | "minecraft:open_chest"
            | "minecraft:sleep_in_bed"
            | "minecraft:open_shulker_box"
            | "minecraft:open_barrel"
            | "minecraft:interact_with_blast_furnace"
            | "minecraft:interact_with_smoker"
            | "minecraft:interact_with_lectern"
            | "minecraft:interact_with_campfire"
            | "minecraft:interact_with_cartography_table"
            | "minecraft:interact_with_loom"
            | "minecraft:interact_with_stonecutter"
            | "minecraft:bell_ring"
            | "minecraft:raid_trigger"
            | "minecraft:raid_win"
            | "minecraft:interact_with_anvil"
            | "minecraft:interact_with_grindstone"
            | "minecraft:target_hit"
            | "minecraft:interact_with_smithing_table" => "times",
            "minecraft:drop" => "items",
            _ => "none",
        },
        _ => "none",
    }
}

fn catalog() -> &'static HashMap<String, String> {
    static CATALOG: OnceLock<HashMap<String, String>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/stat-translations.json"))
            .unwrap_or_default()
    })
}
pub fn category_label(category: &str) -> &str {
    match category {
        "minecraft:custom" => "常规统计",
        "minecraft:mined" => "挖掘方块",
        "minecraft:crafted" => "合成物品",
        "minecraft:used" => "使用物品",
        "minecraft:broken" => "损坏物品",
        "minecraft:picked_up" => "拾取物品",
        "minecraft:dropped" => "丢弃物品",
        "minecraft:killed" => "击杀生物",
        "minecraft:killed_by" => "被生物击杀",
        "legacy" => "旧版统计与成就",
        "extra" => "扩展信息",
        _ => category,
    }
}
pub fn stat_label(category: &str, key: &str) -> Option<String> {
    if key == "DataVersion" {
        return Some("数据版本".into());
    }
    let names = catalog();
    if let Some(value) = names.get(key) {
        return Some(value.clone());
    }
    if category == "legacy" {
        for (prefix, group, action) in [
            ("stat.mineBlock.", "minecraft:mined", "挖掘"),
            ("stat.craftItem.", "minecraft:crafted", "合成"),
            ("stat.useItem.", "minecraft:used", "使用"),
            ("stat.breakItem.", "minecraft:broken", "损坏"),
            ("stat.pickup.", "minecraft:picked_up", "拾取"),
            ("stat.drop.", "minecraft:dropped", "丢弃"),
        ] {
            if let Some(id) = key.strip_prefix(prefix) {
                return stat_label(group, &id.replacen('.', ":", 1))
                    .map(|name| format!("{action} · {name}"));
            }
        }
    }
    let id = key.replace(':', ".");
    let prefixes: &[&str] = match category {
        "minecraft:custom" => &["stat"],
        "minecraft:killed" | "minecraft:killed_by" => &["entity"],
        "minecraft:mined" => &["block", "item"],
        _ => &["item", "block", "entity", "stat"],
    };
    prefixes
        .iter()
        .find_map(|prefix| names.get(&format!("{prefix}.{id}")).cloned())
}
