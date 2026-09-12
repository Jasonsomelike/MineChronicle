use minechronicle_lib::{
    domain::{PlayTimeFormat, StatsWarning},
    minecraft::{JsonStatsParser, StatsParseError, StatsParser},
};
use serde_json::json;

const LEGACY: &[u8] = include_bytes!("fixtures/minecraft_1_12/stats.json");
const OLDER: &[u8] = include_bytes!("fixtures/minecraft_1_16/stats.json");
const MODERN: &[u8] = include_bytes!("fixtures/minecraft_1_21/stats.json");

#[test]
fn sub_minute_ticks_remain_exact_across_legacy_and_26_2_formats() -> Result<(), StatsParseError> {
    for bytes in [
        r#"{"stat.playOneMinute":364}"#,
        r#"{"stats":{"minecraft:custom":{"minecraft:play_one_minute":364}},"DataVersion":2586}"#,
        r#"{"stats":{"minecraft:custom":{"minecraft:play_time":364,"minecraft:total_world_time":99999}},"DataVersion":4903}"#,
    ] {
        let stats = JsonStatsParser.parse(bytes.as_bytes())?;
        assert_eq!(stats.play_ticks, 364);
        assert_eq!(stats.play_ticks / 20, 18);
    }
    Ok(())
}

#[test]
fn duplicate_json_keys_are_rejected_instead_of_silently_overwritten() {
    for input in [
        r#"{"stat.playOneMinute":20,"stat.playOneMinute":40}"#,
        r#"{"stats":{"minecraft:custom":{"minecraft:play_time":20,"minecraft:play_time":40}}}"#,
        r#"{"stat.playOneMinute":20,"mod":{"x":1,"x":2}}"#,
    ] {
        assert!(matches!(
            JsonStatsParser.parse(input.as_bytes()),
            Err(StatsParseError::InvalidJson { .. })
        ));
    }
}

#[test]
fn mixed_flat_and_mod_categories_remain_separate() -> Result<(), StatsParseError> {
    let stats = JsonStatsParser.parse(
        br#"{"stat.playOneMinute":20,"stats":{"legacy":{"mod:key":7}},"stats.legacy":"extension"}"#,
    )?;
    assert_eq!(stats.legacy_statistics["stat.playOneMinute"], 20);
    assert_eq!(stats.statistics["legacy"]["mod:key"], 7);
    assert_eq!(stats.legacy_statistics["stats.legacy"], "extension");
    Ok(())
}

#[test]
fn trailing_json_and_invalid_utf8_are_rejected() {
    for input in [br#"{"stat.playOneMinute":20} {}"#.as_slice(), &[0xff, 0xfe]] {
        assert!(matches!(
            JsonStatsParser.parse(input),
            Err(StatsParseError::InvalidJson { .. })
        ));
    }
}

#[test]
fn legacy_flat_format_normalizes_every_core_counter() -> Result<(), StatsParseError> {
    let s = JsonStatsParser.parse(LEGACY)?;
    assert_eq!(s.format, PlayTimeFormat::LegacyFlat);
    assert_eq!(
        (s.play_ticks, s.deaths, s.jumps, s.mob_kills),
        (72000, 2, 300, 17)
    );
    assert_eq!(
        (s.leave_game_count, s.walk_cm, s.sprint_cm, s.fly_cm),
        (4, 12000, 4300, 800)
    );
    assert_eq!(
        s.statistic("legacy", "stat.mineBlock.minecraft.stone"),
        Some(42)
    );
    assert_eq!(s.legacy_statistics["achievement.openInventory"]["value"], 1);
    assert_eq!(s.statistic("legacy", "modded.customCounter"), Some(9));
    Ok(())
}

#[test]
fn older_modern_format_normalizes_every_core_counter() -> Result<(), StatsParseError> {
    let s = JsonStatsParser.parse(OLDER)?;
    assert_eq!(s.format, PlayTimeFormat::ModernPlayOneMinute);
    assert_eq!(
        (s.play_ticks, s.deaths, s.jumps, s.mob_kills),
        (144000, 3, 50, 12)
    );
    assert_eq!(
        (s.leave_game_count, s.walk_cm, s.sprint_cm, s.fly_cm),
        (6, 24000, 5000, 1000)
    );
    assert_eq!(s.data_version, Some(2586));
    Ok(())
}

#[test]
fn modern_format_preserves_all_categories_and_unknown_mod_data() -> Result<(), StatsParseError> {
    let s = JsonStatsParser.parse(MODERN)?;
    assert_eq!(s.format, PlayTimeFormat::ModernPlayTime);
    assert_eq!(s.play_ticks, 216000);
    for (category, key, value) in [
        ("mined", "stone", 128),
        ("crafted", "torch", 32),
        ("used", "diamond_pickaxe", 12),
        ("broken", "wooden_pickaxe", 1),
        ("picked_up", "dirt", 20),
        ("dropped", "dirt", 10),
        ("killed", "zombie", 7),
        ("killed_by", "skeleton", 2),
    ] {
        assert_eq!(
            s.statistic(
                &format!("minecraft:{category}"),
                &format!("minecraft:{key}")
            ),
            Some(value)
        );
    }
    assert_eq!(
        s.statistic("example:energy", "example:generated"),
        Some(12345)
    );
    assert_eq!(
        s.statistics["example:energy"]["example:details"]["unit"],
        "FE"
    );
    assert_eq!(s.extra_fields["example:metadata"]["synthetic"], true);
    Ok(())
}

#[test]
fn structure_wins_over_version_metadata() -> Result<(), StatsParseError> {
    let s = JsonStatsParser
        .parse(br#"{"DataVersion":1,"stats":{"minecraft:custom":{"minecraft:play_time":20}}}"#)?;
    assert_eq!(s.format, PlayTimeFormat::ModernPlayTime);
    assert_eq!(s.play_ticks, 20);
    Ok(())
}

#[test]
fn conflicting_aliases_have_explicit_precedence_and_warning() -> Result<(), StatsParseError> {
    let s = JsonStatsParser.parse(br#"{"stat.playOneMinute":20,"stats":{"minecraft:custom":{"minecraft:play_time":40,"minecraft:play_one_minute":60}}}"#)?;
    assert_eq!(s.play_ticks, 20);
    assert_eq!(s.format, PlayTimeFormat::LegacyFlat);
    assert_eq!(s.warnings.len(), 2);
    assert!(matches!(
        &s.warnings[0],
        StatsWarning::ConflictingPlayTime {
            selected_ticks: 20,
            other_ticks: 40,
            ..
        }
    ));
    Ok(())
}

#[test]
fn modern_play_time_precedes_old_alias_without_double_counting() -> Result<(), StatsParseError> {
    let s = JsonStatsParser.parse(br#"{"stats":{"minecraft:custom":{"minecraft:play_time":40,"minecraft:play_one_minute":40}}}"#)?;
    assert_eq!(s.play_ticks, 40);
    assert_eq!(s.format, PlayTimeFormat::ModernPlayTime);
    assert!(s.warnings.is_empty());
    Ok(())
}

#[test]
fn corrupted_json_is_an_error() {
    assert!(matches!(
        JsonStatsParser.parse(include_bytes!("fixtures/corrupted.json")),
        Err(StatsParseError::InvalidJson { .. })
    ));
}

#[test]
fn unknown_format_is_never_silently_zero() {
    for input in [
        "{}",
        "[]",
        "null",
        "{\"stats\":{}}",
        "{\"stats\":{\"minecraft:custom\":{\"minecraft:new_time\":40}}}",
    ] {
        assert!(matches!(
            JsonStatsParser.parse(input.as_bytes()),
            Err(StatsParseError::UnknownFormat)
        ));
    }
}

#[test]
fn invalid_time_values_are_rejected_in_all_formats() {
    for value in ["-1", "1.5", "\"20\"", "null", "true", "9223372036854775808"] {
        for input in [
            format!(r#"{{"stat.playOneMinute":{value}}}"#),
            format!(r#"{{"stats":{{"minecraft:custom":{{"minecraft:play_time":{value}}}}}}}"#),
            format!(
                r#"{{"stats":{{"minecraft:custom":{{"minecraft:play_one_minute":{value}}}}}}}"#
            ),
        ] {
            assert!(
                matches!(
                    JsonStatsParser.parse(input.as_bytes()),
                    Err(StatsParseError::InvalidStatistic { .. })
                ),
                "{input}"
            );
        }
    }
}

#[test]
fn invalid_preferred_field_does_not_fall_back_to_valid_alias() {
    assert!(matches!(
        JsonStatsParser.parse(
            br#"{"stat.playOneMinute":-1,"stats":{"minecraft:custom":{"minecraft:play_time":20}}}"#
        ),
        Err(StatsParseError::InvalidStatistic { .. })
    ));
}

#[test]
fn zero_and_i64_max_are_exact_and_missing_counters_default_to_zero() -> Result<(), StatsParseError>
{
    for ticks in [0, i64::MAX] {
        let input = json!({"stat.playOneMinute": ticks}).to_string();
        let s = JsonStatsParser.parse(input.as_bytes())?;
        assert_eq!(s.play_ticks, ticks);
        assert_eq!((s.deaths, s.jumps, s.walk_cm), (0, 0, 0));
    }
    Ok(())
}

#[test]
fn invalid_known_counters_are_not_silently_zeroed() {
    let input =
        br#"{"stats":{"minecraft:custom":{"minecraft:play_time":20,"minecraft:deaths":"bad"}}}"#;
    assert!(matches!(
        JsonStatsParser.parse(input),
        Err(StatsParseError::InvalidStatistic { .. })
    ));
}

#[test]
fn repeated_and_reordered_inputs_produce_identical_stats() -> Result<(), StatsParseError> {
    let a = JsonStatsParser.parse(br#"{"stat.playOneMinute":80,"stat.jump":3}"#)?;
    let b = JsonStatsParser.parse(br#"{"stat.jump":3,"stat.playOneMinute":80}"#)?;
    assert_eq!(a, b);
    assert_eq!(
        JsonStatsParser.parse(LEGACY)?,
        JsonStatsParser.parse(LEGACY)?
    );
    Ok(())
}

#[test]
fn parser_reports_current_values_without_tracking_or_clamping_rollback(
) -> Result<(), StatsParseError> {
    let values: Result<Vec<_>, _> = [200, 180, 183]
        .into_iter()
        .map(|ticks| {
            JsonStatsParser
                .parse(json!({"stat.playOneMinute":ticks}).to_string().as_bytes())
                .map(|s| s.play_ticks)
        })
        .collect();
    assert_eq!(values?, [200, 180, 183]);
    Ok(())
}

#[test]
fn malformed_known_containers_are_rejected() {
    for input in [
        r#"{"stat.playOneMinute":20,"stats":[]}"#,
        r#"{"stat.playOneMinute":20,"stats":{"minecraft:custom":[]}}"#,
    ] {
        assert!(matches!(
            JsonStatsParser.parse(input.as_bytes()),
            Err(StatsParseError::InvalidStructure { .. })
        ));
    }
}
