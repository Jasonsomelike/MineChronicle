use std::{
    error::Error,
    path::{Path, PathBuf},
};

use minechronicle_lib::minecraft::{
    DefaultStatsLocationResolver, FutureStatsLocation, JsonStatsParser, StatsLayout,
    StatsLocationResolver, StatsParser,
};
use uuid::Uuid;

#[test]
fn resolves_both_layouts_without_requiring_world_or_level_dat() {
    let world = Path::new("synthetic/world-without-level-dat");
    let candidates = DefaultStatsLocationResolver.locations(world);
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].directory, world.join("stats"));
    assert_eq!(candidates[0].layout, StatsLayout::Legacy);
    assert_eq!(candidates[1].directory, world.join("players/stats"));
    assert_eq!(candidates[1].layout, StatsLayout::Modern26);
}

#[test]
fn modern_26_multiple_players_parse_independently_without_level_dat() -> Result<(), Box<dyn Error>>
{
    let world = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minecraft_26_1");
    assert!(!world.join("level.dat").exists());
    let locations = DefaultStatsLocationResolver.locations(&world);
    for (id, ticks) in [
        ("00000000-0000-4000-8000-000000000001", 288000),
        ("00000000-0000-4000-8000-000000000002", 36000),
    ] {
        let uuid = Uuid::parse_str(id)?;
        let path = locations[1].player_file(uuid);
        let before = std::fs::read(&path)?;
        assert_eq!(JsonStatsParser.parse(&before)?.play_ticks, ticks);
        assert_eq!(std::fs::read(&path)?, before);
    }
    Ok(())
}

#[test]
fn future_layout_is_explicit_and_cannot_escape_world() -> Result<(), Box<dyn Error>> {
    let resolver = FutureStatsLocation::new(PathBuf::from("future/player-statistics"))?;
    assert_eq!(
        resolver.locations(Path::new("world"))[0].directory,
        Path::new("world/future/player-statistics")
    );
    for path in ["", "../outside", "/absolute", "nested/../../escape"] {
        assert!(FutureStatsLocation::new(PathBuf::from(path)).is_err());
    }
    Ok(())
}
