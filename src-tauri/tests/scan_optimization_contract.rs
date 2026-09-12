mod support;
use minechronicle_lib::{
    database::read_models::ScanSummary,
    scanner::{discover_and_scan, stable_stats::read_stats, GameRootScanner, ScanIssueKind},
    tracker::watcher::affected_roots,
};
use std::{collections::HashSet, fs};
use support::*;

#[test]
fn known_versions_do_not_descend_into_arbitrary_mod_data() -> TestResult {
    let (_temp, root) = game()?;
    level(&root.join("versions/Pack/saves/Real"), "Real")?;
    level(
        &root.join("versions/Pack/mod-generated-data/deep/saves/Fake"),
        "Fake",
    )?;
    level(&root.join("unrelated-cache/deep/saves/Fake"), "Fake")?;
    let report = discover_and_scan(&[root], |_| true);
    let names: Vec<_> = report
        .roots
        .iter()
        .flat_map(|r| &r.worlds)
        .map(|w| w.name.as_str())
        .collect();
    assert_eq!(names, ["Real"]);
    Ok(())
}

#[test]
fn an_exhausted_input_does_not_consume_the_next_inputs_budget() -> TestResult {
    let (temp, root) = game()?;
    for i in 0..10_001 {
        fs::write(root.join(format!("cache-{i}")), [])?;
    }
    let other = temp.path().join("Other");
    level(&other.join("nested/saves/Reachable"), "Reachable")?;
    let report = discover_and_scan(&[root, other], |_| true);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::ScanLimitReached));
    assert!(report
        .roots
        .iter()
        .flat_map(|r| &r.worlds)
        .any(|w| w.name == "Reachable"));
    Ok(())
}

#[test]
fn events_select_only_the_most_specific_root_without_prefix_collisions() -> TestResult {
    let (temp, root) = game()?;
    let nested = root.join("versions/Pack");
    level(&nested.join("saves/World"), "Nested")?;
    let report: ScanSummary = GameRootScanner::default()
        .scan(&[root.clone(), nested.clone()], |_| true)
        .into();
    let events = HashSet::from([nested.join("saves/World/stats/new.json")]);
    assert_eq!(
        affected_roots(&report, &events),
        [fs::canonicalize(&nested)?]
    );
    let unrelated = HashSet::from([temp.path().join("GameRoot-other/saves/world")]);
    assert!(affected_roots(&report, &unrelated).is_empty());
    let parent_event = HashSet::from([root.join("saves/new")]);
    assert_eq!(
        affected_roots(&report, &parent_event),
        [fs::canonicalize(root)?]
    );
    Ok(())
}

#[test]
fn cached_stats_detect_same_size_rewrites_with_preserved_timestamps() -> TestResult {
    let (_temp, root) = game()?;
    stats(&root, "stats", PLAYER, 100)?;
    let path = root.join(format!("stats/{PLAYER}.json"));
    let before = fs::metadata(&path)?;
    assert_eq!(read_stats(&path).map_err(|e| e.1)?.play_ticks, 100);
    stats(&root, "stats", PLAYER, 200)?;
    fs::OpenOptions::new()
        .write(true)
        .open(&path)?
        .set_times(fs::FileTimes::new().set_modified(before.modified()?))?;
    assert_eq!(fs::metadata(&path)?.len(), before.len());
    assert_eq!(fs::metadata(&path)?.modified()?, before.modified()?);
    assert_eq!(read_stats(&path).map_err(|e| e.1)?.play_ticks, 200);
    Ok(())
}
