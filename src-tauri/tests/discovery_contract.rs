mod support;
use minechronicle_lib::scanner::{discover_and_scan, local_names, ScanIssueKind};
use std::fs;
use support::*;

#[test]
fn upper_directory_discovers_isolated_versions_and_own_saves() -> TestResult {
    let (temp, root) = game()?;
    level(&root.join("saves/main"), "Main")?;
    level(&root.join("versions/Mod Pack/saves/111"), "Nested")?;
    level(
        &root.join("instances/Pack/.minecraft/saves/other"),
        "Instance",
    )?;
    level(&temp.path().join("unselected/saves/outside"), "Outside")?;
    let report = discover_and_scan(&[root], |_| true);
    assert!(!report.cancelled);
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    assert_eq!(report.roots.len(), 3);
    assert_eq!(
        report.roots.iter().map(|r| r.worlds.len()).sum::<usize>(),
        3
    );
    Ok(())
}

#[test]
fn resource_directories_and_nested_junctions_are_not_traversed() -> TestResult {
    let (temp, root) = game()?;
    level(&root.join("assets/fake/saves/world"), "Ignored")?;
    level(&root.join(".mixin.out/fake/saves/world"), "Ignored")?;
    level(&root.join("xaero/fake/saves/world"), "Ignored")?;
    let outside = temp.path().join("outside");
    level(&outside.join("saves/world"), "Link target")?;
    directory_link(&root.join("linked"), &outside)?;
    let report = discover_and_scan(&[root], |_| true);
    assert_eq!(report.roots.len(), 1);
    assert!(report.roots[0].worlds.is_empty());
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::SymlinkSkipped));
    Ok(())
}

#[test]
fn depth_limit_is_explicit_and_relative_paths_are_rejected() -> TestResult {
    let (_temp, root) = game()?;
    level(&root.join("a/b/c/d/e/f/g/saves/world"), "Too deep")?;
    let report = discover_and_scan(&[root], |_| true);
    assert_eq!(report.roots.len(), 1);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::ScanLimitReached));
    let relative = discover_and_scan(&["relative".into()], |_| true);
    assert!(relative.roots.is_empty());
    assert_eq!(relative.issues[0].kind, ScanIssueKind::InvalidRoot);
    Ok(())
}

#[test]
fn discovery_can_be_cancelled_before_world_files_are_read() -> TestResult {
    let (_temp, root) = game()?;
    level(&root.join("saves/world"), "Cancel")?;
    let report = discover_and_scan(&[root], |_| false);
    assert!(report.cancelled);
    assert!(report.roots[0].worlds.is_empty());
    Ok(())
}

#[test]
fn names_use_nearest_authorized_cache_and_ignore_extra_fields() -> TestResult {
    let (temp, root) = game()?;
    let nested = root.join("versions/Pack");
    fs::create_dir_all(&nested)?;
    fs::write(
        temp.path().join("usercache.json"),
        serde_json::to_vec(&serde_json::json!([{"uuid":OTHER,"name":"Outside"}]))?,
    )?;
    fs::write(
        root.join("usercache.json"),
        serde_json::to_vec(&serde_json::json!([{"uuid":PLAYER,"name":"ParentName"}]))?,
    )?;
    fs::write(
        nested.join("usercache.json"),
        serde_json::to_vec(
            &serde_json::json!([{"uuid":PLAYER,"name":"NearestName","irrelevant":"not imported"}]),
        )?,
    )?;
    let root = fs::canonicalize(root)?;
    let nested = fs::canonicalize(nested)?;
    let mut issues = Vec::new();
    let names = local_names(&nested, &[root], &mut issues);
    assert!(issues.is_empty());
    assert_eq!(names.len(), 1);
    assert_eq!(
        names
            .get(&uuid::Uuid::parse_str(PLAYER)?)
            .map(String::as_str),
        Some("NearestName")
    );
    let narrow = local_names(&nested, std::slice::from_ref(&nested), &mut issues);
    assert_eq!(narrow, names);
    Ok(())
}

#[test]
fn malformed_conflicting_and_linked_name_caches_do_not_invent_names() -> TestResult {
    let (temp, root) = game()?;
    let root = fs::canonicalize(root)?;
    let path = root.join("usercache.json");
    fs::write(&path, b"not json")?;
    let mut issues = Vec::new();
    assert!(local_names(&root, std::slice::from_ref(&root), &mut issues).is_empty());
    assert_eq!(issues[0].kind, ScanIssueKind::InvalidPlayerCache);
    fs::write(
        &path,
        serde_json::to_vec(
            &serde_json::json!([{"uuid":PLAYER,"name":"One"},{"uuid":PLAYER,"name":"Two"},{"uuid":OTHER,"name":" invalid "}]),
        )?,
    )?;
    assert!(local_names(&root, std::slice::from_ref(&root), &mut issues).is_empty());
    fs::rename(&path, temp.path().join("old-cache"))?;
    fs::create_dir(&path)?;
    assert!(local_names(&root, std::slice::from_ref(&root), &mut issues).is_empty());
    Ok(())
}
