mod support;
use minechronicle_lib::{
    domain::WorldStatus,
    scanner::{path_identity::DirectoryIdentity, GameRootScanner, ScanIssueKind, ScanLimits},
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use support::*;

#[test]
fn scans_real_synthetic_files_in_both_layouts_and_multiple_players() -> TestResult {
    let (_temp, root) = game()?;
    let old = root.join("saves/old");
    level(&old, "From level.dat")?;
    stats(&old, "stats", PLAYER, 72000)?;
    let modern = root.join("saves/modern");
    level(&modern, "新世界")?;
    stats(&modern, "players/stats", PLAYER, 288000)?;
    stats(&modern, "players/stats", OTHER, 36000)?;
    let mut events = Vec::new();
    let report = GameRootScanner::default().scan(&[root], |event| {
        events.push(event.clone());
        true
    });
    assert!(report.issues.is_empty());
    assert_eq!(report.roots.len(), 1);
    assert_eq!(report.roots[0].worlds.len(), 2);
    assert!(report.roots[0].enumeration_complete);
    let worlds = &report.roots[0].worlds;
    assert_eq!(worlds[0].name, "新世界");
    assert_eq!(worlds[0].players.len(), 2);
    assert_eq!(
        worlds[0].players[0].stats.as_ref().map(|s| s.play_ticks),
        Some(288000)
    );
    assert_eq!(worlds[1].name, "From level.dat");
    assert_eq!(
        events.last().map(|e| (
            e.roots_done,
            e.roots_total,
            e.worlds_scanned,
            e.player_files_scanned
        )),
        Some((1, 1, 2, 3))
    );
    Ok(())
}

#[test]
fn damaged_or_missing_level_metadata_creates_degraded_worlds_only_with_valid_stats() -> TestResult {
    let (_temp, root) = game()?;
    let missing = root.join("saves/missing-level");
    stats(&missing, "stats", PLAYER, 40)?;
    let corrupt = root.join("saves/corrupt-level");
    stats(&corrupt, "players/stats", PLAYER, 80)?;
    fs::write(corrupt.join("level.dat"), b"corrupted")?;
    fs::create_dir_all(root.join("saves/empty"))?;
    fs::write(root.join("saves/empty/level.dat"), b"corrupted")?;
    let report = GameRootScanner::default().scan(&[root], |_| true);
    assert_eq!(report.roots[0].worlds.len(), 2);
    assert!(report.roots[0]
        .worlds
        .iter()
        .all(|w| w.status == WorldStatus::Degraded && w.metadata.is_none()));
    assert_eq!(report.roots[0].worlds[0].name, "corrupt-level");
    assert!(!report.roots[0].enumeration_complete);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::MissingLevelDat));
    assert_eq!(
        report
            .issues
            .iter()
            .filter(|i| i.kind == ScanIssueKind::CorruptedLevelDat)
            .count(),
        2
    );
    Ok(())
}

#[test]
fn valid_world_without_stats_or_name_is_discovered() -> TestResult {
    let (_temp, root) = game()?;
    let world = root.join("saves/fallback");
    level(&world, " ")?;
    let report = GameRootScanner::default().scan(&[root], |_| true);
    assert_eq!(report.roots[0].worlds[0].name, "fallback");
    assert_eq!(report.roots[0].worlds[0].status, WorldStatus::Present);
    assert!(report.roots[0].worlds[0].players.is_empty());
    Ok(())
}

#[test]
fn corrupted_unknown_and_invalid_uuid_files_do_not_stop_valid_players() -> TestResult {
    let (_temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Good")?;
    stats(&world, "stats", PLAYER, 20)?;
    fs::write(world.join(format!("stats/{OTHER}.json")), b"broken")?;
    fs::write(
        world.join("stats/00000000-0000-4000-8000-000000000003.json"),
        b"{}",
    )?;
    fs::write(world.join("stats/username.json"), b"{}")?;
    let report = GameRootScanner::default().scan(&[root], |_| true);
    assert_eq!(report.roots[0].worlds[0].players.len(), 1);
    for kind in [
        ScanIssueKind::CorruptedStats,
        ScanIssueKind::UnknownStatsFormat,
        ScanIssueKind::InvalidPlayerUuid,
    ] {
        assert!(report.issues.iter().any(|i| i.kind == kind));
    }
    Ok(())
}

#[test]
fn duplicate_layouts_are_one_player_and_conflicting_layouts_are_unresolved() -> TestResult {
    let (_temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "World")?;
    for layout in ["stats", "players/stats"] {
        stats(&world, layout, PLAYER, 72000)?;
    }
    let report = GameRootScanner::default().scan(std::slice::from_ref(&root), |_| true);
    let player = &report.roots[0].worlds[0].players[0];
    assert_eq!(player.sources.len(), 2);
    assert_eq!(player.stats.as_ref().map(|s| s.play_ticks), Some(72000));
    stats(&world, "players/stats", PLAYER, 80000)?;
    let conflicting = GameRootScanner::default().scan(&[root], |_| true);
    assert_eq!(conflicting.roots[0].worlds[0].players.len(), 1);
    assert!(conflicting.roots[0].worlds[0].players[0].stats.is_none());
    assert!(conflicting
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::ConflictingPlayerStats));
    Ok(())
}

#[test]
fn shared_game_roots_dotdot_and_explicit_directory_aliases_are_scanned_once() -> TestResult {
    let (temp, root) = game()?;
    stats(&root.join("saves/world"), "stats", PLAYER, 20)?;
    fs::create_dir_all(root.join("versions"))?;
    let alias = temp.path().join("Alias");
    directory_link(&alias, &root)?;
    let paths = [root.clone(), root.join("versions/.."), alias];
    let report = GameRootScanner::default().scan(&paths, |_| true);
    assert_eq!(report.roots.len(), 1);
    assert_eq!(report.roots[0].requested_paths.len(), 3);
    assert_eq!(report.roots[0].worlds.len(), 1);
    Ok(())
}

#[cfg(windows)]
#[test]
fn windows_case_variants_share_the_same_filesystem_identity() -> TestResult {
    let (_temp, root) = game()?;
    let upper = PathBuf::from(root.to_string_lossy().to_uppercase());
    let first = DirectoryIdentity::open(&root)?;
    let second = DirectoryIdentity::open(&upper)?;
    assert_eq!(first.key, second.key);
    let report = GameRootScanner::default().scan(&[root, upper], |_| true);
    assert_eq!(report.roots.len(), 1);
    Ok(())
}

#[test]
fn nested_worlds_and_unapproved_directory_links_are_not_followed() -> TestResult {
    let (temp, root) = game()?;
    let outside = temp.path().join("outside");
    level(&outside, "Outside")?;
    stats(&outside, "stats", PLAYER, 1000)?;
    directory_link(&root.join("saves/linked"), &outside)?;
    level(&root.join("other/saves/hidden"), "Not scanned")?;
    let report = GameRootScanner::default().scan(&[root], |_| true);
    assert!(report.roots[0].worlds.is_empty());
    assert!(!report.roots[0].enumeration_complete);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::SymlinkSkipped));
    Ok(())
}

#[test]
fn intermediate_players_link_cannot_escape_authorized_world() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "World")?;
    let outside = temp.path().join("outside");
    stats(&outside, "stats", PLAYER, 90000)?;
    directory_link(&world.join("players"), &outside)?;
    let report = GameRootScanner::default().scan(&[root], |_| true);
    assert!(report.roots[0].worlds[0].players.is_empty());
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::SymlinkSkipped));
    Ok(())
}

#[test]
fn invalid_roots_missing_saves_and_missing_directories_are_reported() -> TestResult {
    let (temp, root) = game()?;
    let plain = temp.path().join("plain");
    fs::create_dir(&plain)?;
    let report = GameRootScanner::default().scan(
        &[
            PathBuf::from("relative"),
            temp.path().join("absent"),
            plain,
            root,
        ],
        |_| true,
    );
    for kind in [
        ScanIssueKind::InvalidRoot,
        ScanIssueKind::InaccessibleDirectory,
        ScanIssueKind::SavesNotFound,
    ] {
        assert!(report.issues.iter().any(|i| i.kind == kind));
    }
    assert_eq!(report.roots.len(), 2);
    Ok(())
}

#[test]
fn whole_disk_root_is_rejected_without_enumeration() -> TestResult {
    let (_temp, root) = game()?;
    let disk = root
        .ancestors()
        .last()
        .ok_or("missing disk ancestor")?
        .to_owned();
    let report = GameRootScanner::default().scan(&[disk], |_| true);
    assert!(report.roots.is_empty());
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::InvalidRoot));
    Ok(())
}

#[test]
fn limits_and_cancellation_mark_partial_results() -> TestResult {
    let (_temp, root) = game()?;
    for name in ["first", "second"] {
        level(&root.join("saves").join(name), name)?;
    }
    let scanner = GameRootScanner {
        limits: ScanLimits {
            worlds_per_root: 1,
            ..Default::default()
        },
    };
    let report = scanner.scan(std::slice::from_ref(&root), |_| true);
    assert_eq!(report.roots[0].worlds.len(), 1);
    assert!(!report.roots[0].enumeration_complete);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::ScanLimitReached));
    let cancelled = GameRootScanner::default().scan(&[root], |p| p.worlds_scanned == 0);
    assert!(cancelled.cancelled);
    assert_eq!(cancelled.roots[0].worlds.len(), 1);
    assert!(!cancelled.roots[0].enumeration_complete);
    Ok(())
}

fn contents(root: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>, Box<dyn std::error::Error>> {
    let mut files = BTreeMap::new();
    for entry in walkdir::WalkDir::new(root) {
        let entry = entry?;
        if entry.file_type().is_file() {
            files.insert(
                entry.path().strip_prefix(root)?.to_owned(),
                fs::read(entry.path())?,
            );
        }
    }
    Ok(files)
}

#[test]
fn scan_does_not_create_delete_or_change_any_source_file() -> TestResult {
    let (_temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Untouched")?;
    stats(&world, "stats", PLAYER, 20)?;
    fs::create_dir_all(world.join("region"))?;
    fs::write(world.join("region/r.0.0.mca"), b"sentinel region contents")?;
    let before = contents(&root)?;
    let report = GameRootScanner::default().scan(std::slice::from_ref(&root), |_| true);
    assert!(report.issues.is_empty());
    assert_eq!(before, contents(&root)?);
    Ok(())
}

#[cfg(windows)]
#[test]
fn locked_stats_file_is_reported_and_other_worlds_continue() -> TestResult {
    use std::os::windows::fs::OpenOptionsExt;
    let (_temp, root) = game()?;
    let world = root.join("saves/locked");
    level(&world, "Locked")?;
    stats(&world, "stats", PLAYER, 20)?;
    let _lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(world.join(format!("stats/{PLAYER}.json")))?;
    level(&root.join("saves/valid"), "Valid")?;
    let report = GameRootScanner::default().scan(&[root], |_| true);
    assert_eq!(report.roots[0].worlds.len(), 2);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::CorruptedStats));
    Ok(())
}
