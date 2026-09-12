use std::{
    error::Error,
    path::{Path, PathBuf},
};

use minechronicle_lib::{
    domain::{GameRootId, Instance, InstanceId, LauncherId, World, WorldId, WorldStatus},
    minecraft::{
        DefaultStatsLocationResolver, FutureStatsLocation, JsonStatsParser, StatsLayout,
        StatsLocationResolver, StatsParser,
    },
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

#[test]
fn two_instances_reference_one_root_and_world_is_owned_by_root() {
    let root_id = GameRootId(1);
    let instances: Vec<_> = [1, 2]
        .into_iter()
        .map(|id| Instance {
            id: InstanceId(id),
            launcher_id: LauncherId(1),
            game_root_id: root_id,
            name: format!("Synthetic instance {id}"),
            minecraft_version: None,
            mod_loader: None,
        })
        .collect();
    let world = World {
        id: WorldId(1),
        game_root_id: root_id,
        path: PathBuf::from("synthetic/saves/world"),
        name: "Synthetic".to_owned(),
        status: WorldStatus::Present,
        data_version: None,
    };
    assert!(instances
        .iter()
        .all(|instance| instance.game_root_id == world.game_root_id));
    assert_ne!(instances[0].id, instances[1].id);
}
