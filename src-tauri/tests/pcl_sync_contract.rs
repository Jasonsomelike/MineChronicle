mod support;
use minechronicle_lib::{
    commands::ScanControl,
    database::{DbResult, Repository},
    launcher::{
        pcl_folders::{PclFolder, PclLink},
        sync::PclSync,
    },
};
use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};
use support::*;
fn db<T>(r: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    r.map_err(|e| e as _)
}
fn version(root: &Path, name: &str) -> TestResult {
    let path = root.join("versions").join(name);
    fs::create_dir_all(&path)?;
    fs::write(
        path.join(format!("{name}.json")),
        serde_json::to_vec(&serde_json::json!({"id":name,"type":"release"}))?,
    )?;
    Ok(())
}
fn wait(mut condition: impl FnMut() -> bool) -> TestResult {
    let start = Instant::now();
    while !condition() {
        if start.elapsed() > Duration::from_secs(15) {
            return Err("PCL sync timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}
#[test]
fn service_imports_new_instances_rechecks_isolation_and_persists_pause() -> TestResult {
    let (temp, root) = game()?;
    let root = fs::canonicalize(root)?;
    let launcher = temp.path().join("PCL launcher");
    fs::create_dir_all(launcher.join("PCL"))?;
    fs::write(launcher.join("PCL/Setup.ini"), "LaunchArgumentIndieV2:4")?;
    version(&root, "One")?;
    level(&root.join("versions/One/saves/w"), "World")?;
    stats(&root.join("versions/One/saves/w"), "stats", PLAYER, 100)?;
    let link = PclLink {
        folders: vec![PclFolder {
            name: "Fixture".into(),
            path: root.clone(),
            available: true,
        }],
        launchers: vec![launcher.clone()],
        issues: vec![],
    };
    let database = temp.path().join("db");
    let provider = link.clone();
    let service = PclSync::start_with(
        database.clone(),
        ScanControl::default(),
        move || Ok(provider.clone()),
        Duration::from_millis(300),
    );
    wait(|| service.status().revision > 0)?;
    let repo = db(Repository::open(&database))?;
    assert_eq!(db(repo.load())?.instances.len(), 1);
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    let first = service.status().revision;
    std::thread::sleep(Duration::from_millis(700));
    assert_eq!(service.status().revision, first);
    version(&root, "Two")?;
    wait(|| service.status().current_instances.len() == 2 && service.status().revision > first)?;
    assert_eq!(db(repo.load())?.instances.len(), 2);
    assert_eq!(service.status().added, 1);
    let revision = service.status().revision;
    fs::write(launcher.join("PCL/Setup.ini"), "LaunchArgumentIndieV2:0")?;
    wait(|| service.status().revision > revision)?;
    let changed = db(repo.load())?;
    assert_eq!(
        changed
            .instances
            .iter()
            .find(|i| i.name == "Two")
            .map(|i| &i.game_root),
        Some(&root)
    );
    assert_eq!(
        changed
            .instances
            .iter()
            .find(|i| i.name == "One")
            .map(|i| &i.game_root),
        Some(&root.join("versions/One"))
    );
    // PCL keeps existing saves isolated unless the instance explicitly overrides it.
    let revision = service.status().revision;
    fs::create_dir_all(root.join("versions/One/PCL"))?;
    fs::write(
        root.join("versions/One/PCL/Setup.ini"),
        "VersionArgumentIndieV2:False",
    )?;
    wait(|| service.status().revision > revision)?;
    assert!(db(repo.load())?
        .instances
        .iter()
        .all(|i| i.game_root == root));
    assert_eq!(db(repo.load())?.historical_ticks, "100");
    db(service.set_enabled(false))?;
    wait(|| !service.status().running)?;
    version(&root, "Three")?;
    std::thread::sleep(Duration::from_millis(650));
    assert_eq!(db(repo.load())?.instances.len(), 2);
    drop(service);
    let provider = link;
    let service = PclSync::start_with(
        database.clone(),
        ScanControl::default(),
        move || Ok(provider.clone()),
        Duration::from_millis(300),
    );
    std::thread::sleep(Duration::from_millis(500));
    assert!(!service.status().enabled);
    service.request();
    wait(|| service.status().revision > 0)?;
    assert_eq!(db(repo.load())?.instances.len(), 3);
    assert!(!service.status().enabled);
    drop(service);
    Ok(())
}
