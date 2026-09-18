mod support;
use minechronicle_lib::launcher::{LauncherAdapter, PclAdapter};
use minechronicle_lib::{
    database::{read_models::ScanSummary, Repository},
    scanner::discover_and_scan,
};
use std::{fs, path::Path};
use support::*;

fn instance(
    container: &Path,
    name: &str,
    config: &str,
    libraries: serde_json::Value,
) -> TestResult {
    let path = container.join("versions").join(name);
    fs::create_dir_all(path.join("PCL"))?;
    fs::write(path.join("PCL/Setup.ini"), config)?;
    fs::write(
        path.join(format!("{name}.json")),
        serde_json::to_vec(
            &serde_json::json!({"id":name,"inheritsFrom":"1.21.1","type":"release","libraries":libraries}),
        )?,
    )?;
    Ok(())
}

#[test]
fn registry_folder_list_keeps_cross_directory_names_and_deduplicates() -> TestResult {
    let temp = tempfile::tempdir()?;
    let a = temp.path().join("中文 世界");
    let b = temp.path().join("other");
    fs::create_dir_all(&a)?;
    let text = format!(
        "中文>{}|Second>{}|Alias>{}",
        a.display(),
        b.display(),
        a.display()
    );
    let folders = minechronicle_lib::launcher::pcl_folders::parse_folders(&text)?;
    assert_eq!(folders.len(), 2);
    assert_eq!(folders[0].name, "中文");
    assert!(folders[0].available);
    assert!(!folders[1].available);
    assert!(minechronicle_lib::launcher::pcl_folders::parse_folders("bad>relative").is_err());
    assert!(minechronicle_lib::launcher::pcl_folders::parse_folders("broken").is_err());
    Ok(())
}

#[test]
fn linked_launcher_applies_its_global_settings_to_external_folders() -> TestResult {
    let (temp, root) = game()?;
    let launcher = temp.path().join("separate-launcher");
    fs::create_dir_all(launcher.join("PCL"))?;
    fs::write(launcher.join("PCL/Setup.ini"), "LaunchArgumentIndieV2:4")?;
    instance(&root, "NeverPlayed", "", serde_json::json!([]))?;
    instance(
        &root,
        "ExplicitShared",
        "VersionArgumentIndieV2:False",
        serde_json::json!([]),
    )?;
    // Irrelevant content must not consume the discovery budget for the next folder.
    let junk = root.join("versions/NeverPlayed/arbitrary-mod-cache/a/b/c/d/e/f/g");
    fs::create_dir_all(junk)?;
    let report = minechronicle_lib::scanner::discover_and_scan_linked(
        std::slice::from_ref(&root),
        Some(&launcher),
        |_| true,
    );
    assert_eq!(report.instances.len(), 2);
    let fresh = report
        .instances
        .iter()
        .find(|i| i.name == "NeverPlayed")
        .ok_or("missing")?;
    assert!(fresh.game_root.ends_with("versions/NeverPlayed"));
    assert_eq!(fresh.launcher_path, launcher);
    let shared = report
        .instances
        .iter()
        .find(|i| i.name == "ExplicitShared")
        .ok_or("missing")?;
    assert_eq!(shared.game_root, fs::canonicalize(root)?);
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    Ok(())
}
#[test]
fn pcl_shared_and_isolated_instances_preserve_root_relationships() -> TestResult {
    let (temp, root) = game()?;
    instance(
        &root,
        "Shared A",
        "VersionArgumentIndieV2:False",
        serde_json::json!([]),
    )?;
    instance(
        &root,
        "Shared B",
        "VersionArgumentIndie:2",
        serde_json::json!([]),
    )?;
    instance(
        &root,
        "Modded",
        "VersionArgumentIndieV2:True",
        serde_json::json!([{"name":"net.neoforged:neoforge:21.1.247"}]),
    )?;
    level(&root.join("saves/shared"), "Shared world")?;
    stats(&root.join("saves/shared"), "stats", PLAYER, 72000)?;
    level(
        &root.join("versions/Modded/saves/isolated"),
        "Isolated world",
    )?;
    stats(
        &root.join("versions/Modded/saves/isolated"),
        "stats",
        PLAYER,
        400,
    )?;
    let report = discover_and_scan(std::slice::from_ref(&root), |_| true);
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    assert_eq!(report.instances.len(), 3);
    assert_eq!(report.roots.len(), 2);
    assert_eq!(
        report.instances[0]
            .mod_loader
            .as_ref()
            .map(|m| m.name.as_str()),
        Some("NeoForge")
    );
    let path = temp.path().join("library.sqlite3");
    let mut repo = Repository::open(&path).map_err(|e| e.to_string())?;
    let summary: ScanSummary = report.into();
    for _ in 0..2 {
        repo.import(&summary, &[]).map_err(|e| e.to_string())?;
    }
    let saved = repo.load().map_err(|e| e.to_string())?;
    assert_eq!(saved.instances.len(), 3);
    assert_eq!(saved.historical_ticks, "72400");
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row("SELECT count(*) FROM instance_world_links", [], |r| r
            .get::<_, i64>(0))?,
        3
    );
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM stat_snapshots WHERE kind='initial_import'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        2
    );
    Ok(())
}
#[test]
fn global_rules_and_local_overrides_follow_pcl_metadata() -> TestResult {
    let (temp, root) = game()?;
    fs::create_dir_all(temp.path().join("PCL"))?;
    fs::write(
        temp.path().join("PCL/Setup.ini"),
        "LaunchArgumentIndieV2:1\nCacheAccess:synthetic-secret-never-persist",
    )?;
    instance(
        &root,
        "Fabric",
        "VersionArgumentIndie:0",
        serde_json::json!([{"name":"net.fabricmc:fabric-loader:0.19.3"}]),
    )?;
    instance(
        &root,
        "Vanilla",
        "VersionArgumentIndie:0",
        serde_json::json!([]),
    )?;
    instance(
        &root,
        "Explicit",
        "VersionArgumentIndieV2:False\nVersionArgumentIndie:1",
        serde_json::json!([{"name":"net.fabricmc:fabric-loader:0.19.3"}]),
    )?;
    let report = discover_and_scan(&[temp.path().to_owned()], |_| true);
    assert_eq!(report.instances.len(), 3);
    let fabric = report
        .instances
        .iter()
        .find(|i| i.name == "Fabric")
        .ok_or("Fabric missing")?;
    assert!(fabric.game_root.ends_with("versions/Fabric"));
    let explicit = report
        .instances
        .iter()
        .find(|i| i.name == "Explicit")
        .ok_or("Explicit missing")?;
    assert_eq!(explicit.game_root, fs::canonicalize(&root)?);
    assert!(!serde_json::to_string(&report.instances)?.contains("synthetic-secret"));
    Ok(())
}
#[test]
fn malformed_and_external_metadata_are_not_guessed_or_followed() -> TestResult {
    let (temp, root) = game()?;
    instance(
        &root,
        "Invalid",
        "VersionArgumentIndieV2:potato",
        serde_json::json!([]),
    )?;
    instance(&root, "Missing", "", serde_json::json!([]))?;
    let outside = temp.path().join("outside");
    instance(
        &outside,
        "External",
        "VersionArgumentIndie:1",
        serde_json::json!([]),
    )?;
    let report = discover_and_scan(&[root], |_| true);
    assert!(report.instances.is_empty());
    assert_eq!(report.issues.iter().filter(|i|i.kind==minechronicle_lib::scanner::ScanIssueKind::InvalidLauncherMetadata).count(),2);
    Ok(())
}

#[test]
fn pcl_cached_loader_and_minecraft_version_fill_missing_json_metadata() -> TestResult {
    let (_temp, root) = game()?;
    instance(
        &root,
        "Neo",
        "VersionArgumentIndieV2:True\nVersionNeoForge:21.1.247\nVersionOriginal:1.21.1",
        serde_json::json!([]),
    )?;
    fs::write(root.join("versions/Neo/Neo.json"),br#"{"id":"Neo","type":"release","libraries":[{"name":"net.neoforged.fancymodloader:loader:4.0.43"}]}"#)?;
    let report = discover_and_scan(&[root], |_| true);
    assert_eq!(report.instances.len(), 1);
    assert_eq!(
        report.instances[0].minecraft_version.as_deref(),
        Some("1.21.1")
    );
    assert_eq!(
        report.instances[0]
            .mod_loader
            .as_ref()
            .map(|l| (l.name.as_str(), l.version.as_deref())),
        Some(("NeoForge", Some("21.1.247")))
    );
    assert!(report.issues.is_empty());
    Ok(())
}

#[test]
fn adapter_trait_discovers_metadata_without_parsing_world_files() -> TestResult {
    let (_temp, root) = game()?;
    instance(
        &root,
        "MetadataOnly",
        "VersionArgumentIndieV2:True",
        serde_json::json!([]),
    )?;
    let world = root.join("versions/MetadataOnly/saves/unreadable");
    fs::create_dir_all(&world)?;
    fs::write(world.join("level.dat"), b"not valid NBT")?;
    let instances = PclAdapter.discover_instances(&[root])?;
    assert_eq!(instances.len(), 1);
    assert_eq!(instances[0].name, "MetadataOnly");
    Ok(())
}
#[test]
fn migration_from_phase3_retains_snapshots_and_aliases() -> TestResult {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("old.sqlite3");
    let conn = rusqlite::Connection::open(&path)?;
    conn.execute_batch(include_str!("../src/database/001_initial.sql"))?;
    conn.execute(
        "INSERT INTO players(uuid,preferred_name) VALUES (?,?)",
        [PLAYER, "SavedName"],
    )?;
    drop(conn);
    Repository::open(&path).map_err(|e| e.to_string())?;
    let conn = rusqlite::Connection::open(path)?;
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
        7
    );
    assert_eq!(
        conn.query_row("SELECT preferred_name FROM players", [], |r| r
            .get::<_, String>(0))?,
        "SavedName"
    );
    Ok(())
}
