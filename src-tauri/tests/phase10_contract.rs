mod support;
use minechronicle_lib::{
    commands::ScanControl,
    database::{
        activity::{ActivityFilter, StatisticsFilter},
        DbResult, Repository,
    },
    launcher::{
        running::{game_from_args, match_instances, ActiveInstance, RunningGame},
        DiscoveredInstance,
    },
    minecraft::translations::stat_label,
    scanner::GameRootScanner,
    tracker::watcher::Tracker,
};
use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use support::*;
fn db<T>(r: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    r.map_err(|e| e as _)
}
fn wait(mut ready: impl FnMut() -> bool) -> TestResult {
    let started = Instant::now();
    while !ready() {
        if started.elapsed() > Duration::from_secs(15) {
            return Err("active instance tracking timeout".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}
#[test]
fn combinations_use_a_set_and_chinese_search_preserves_identifiers() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "Players")?;
    stats(&world, "stats", PLAYER, 100)?;
    stats(&world, "stats", OTHER, 200)?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    db(repo.import(
        &GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .into(),
        &[root],
    ))?;
    let selection = vec![PLAYER.into(), OTHER.into(), PLAYER.into()];
    let combined = db(repo.statistics(&StatisticsFilter {
        uuids: selection.clone(),
        ..Default::default()
    }))?;
    assert_eq!(combined.sources, 2);
    assert_eq!(combined.counters["play_ticks"], "300");
    assert_eq!(
        db(repo.timeline(&ActivityFilter {
            uuids: selection,
            ..Default::default()
        }))?
        .total,
        2
    );
    assert!(repo
        .statistics(&StatisticsFilter {
            uuids: vec!["' OR 1=1".into()],
            ..Default::default()
        })
        .is_err());
    let chinese = db(repo.statistics(&StatisticsFilter {
        query: "游戏时长".into(),
        ..Default::default()
    }))?;
    assert!(chinese
        .rows
        .iter()
        .any(|r| r.key == "minecraft:play_time" && r.label.is_some()));
    assert_eq!(
        stat_label("minecraft:mined", "minecraft:diamond_ore").as_deref(),
        Some("钻石矿石")
    );
    assert!(stat_label("minecraft:mined", "unknown:untranslated").is_none());
    Ok(())
}
#[test]
fn active_roots_only_final_flush_and_idle_no_imports() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/active");
    level(&world, "Active")?;
    stats(&world, "stats", PLAYER, 100)?;
    let inactive = temp.path().join("inactive");
    let other = inactive.join("saves/closed");
    level(&other, "Closed")?;
    stats(&other, "stats", OTHER, 500)?;
    let archive = temp.path().join("db");
    let mut repo = db(Repository::open(&archive))?;
    db(repo.import(
        &GameRootScanner::default()
            .scan(&[root.clone(), inactive.clone()], |_| true)
            .into(),
        &[root.clone(), inactive],
    ))?;
    let active = Arc::new(Mutex::new(Vec::<ActiveInstance>::new()));
    let activity = Arc::clone(&active);
    let probe_error = Arc::new(AtomicBool::new(false));
    let injected_error = Arc::clone(&probe_error);
    let tracker =
        Tracker::start_with_activity(archive.clone(), ScanControl::default(), move || {
            if injected_error.load(Ordering::Acquire) {
                return Err("temporary process query failure".into());
            }
            Ok(activity.lock().map_err(|_| "activity lock")?.clone())
        });
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(tracker.status().revision, 0);
    assert_eq!(tracker.status().watched_directories, 0);
    active.lock().map_err(|_| "lock")?.push(ActiveInstance {
        game_root: fs::canonicalize(&root)?,
        name: "Active".into(),
        pids: vec![42],
    });
    wait(|| tracker.status().watched_directories >= 4 && !tracker.status().running)?;
    let first_revision = tracker.status().revision;
    stats(&other, "stats", OTHER, 900)?;
    stats(&world, "stats", PLAYER, 200)?;
    wait(|| {
        repo.tracking_summary().is_ok_and(|s| {
            s.players
                .iter()
                .any(|p| p.uuid == PLAYER && p.ticks == "100")
        })
    })?;
    assert!(!db(repo.tracking_summary())?
        .players
        .iter()
        .any(|p| p.uuid == OTHER && p.ticks != "0"));
    let revision = tracker.status().revision;
    assert!(revision > first_revision);
    // A repeated save emits a native event but must not create a scan transaction.
    stats(&world, "stats", PLAYER, 200)?;
    std::thread::sleep(Duration::from_secs(4));
    assert_eq!(tracker.status().revision, revision);
    // Another importer can change the archive between otherwise identical native events.
    stats(&world, "stats", PLAYER, 400)?;
    db(repo.import(
        &GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .into(),
        std::slice::from_ref(&root),
    ))?;
    stats(&world, "stats", PLAYER, 200)?;
    wait(|| repo.tracking_summary().is_ok_and(|s| s.rollback_count == 1))?;
    probe_error.store(true, Ordering::Release);
    wait(|| {
        tracker
            .status()
            .error
            .is_some_and(|e| e.contains("temporary process query failure"))
    })?;
    assert_eq!(tracker.status().active_instances.len(), 1);
    assert!(tracker.status().watched_directories >= 4);
    assert_eq!(db(repo.observed_sessions())?[0].status, "running");
    probe_error.store(false, Ordering::Release);
    stats(&world, "stats", PLAYER, 260)?;
    active.lock().map_err(|_| "lock")?.clear();
    wait(|| tracker.status().active_instances.is_empty())?;
    // A late atomic save arriving after the first exit scan must still count.
    std::thread::sleep(Duration::from_secs(4));
    assert!(tracker.status().finalizing_instances > 0);
    assert!(tracker.status().watched_directories >= 4);
    stats(&world, "stats", PLAYER, 270)?;
    wait(|| {
        tracker.status().active_instances.is_empty()
            && tracker.status().watched_directories == 0
            && !tracker.status().running
    })?;
    assert!(db(repo.tracking_summary())?
        .players
        .iter()
        .any(|p| p.uuid == PLAYER && p.ticks == "370"));
    let sessions = db(repo.observed_sessions())?;
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].status, "closed");
    assert!(sessions[0].ended_at.is_some());
    let revision = tracker.status().revision;
    stats(&world, "stats", PLAYER, 300)?;
    std::thread::sleep(Duration::from_secs(4));
    assert_eq!(tracker.status().revision, revision);
    assert!(db(repo.tracking_summary())?
        .players
        .iter()
        .any(|p| p.uuid == PLAYER && p.ticks == "370"));
    drop(tracker);
    Ok(())
}
#[test]
fn game_process_matching_handles_spaces_shared_roots_and_unrelated_java() -> TestResult {
    let (temp, root) = game()?;
    let args = vec![
        "javaw.exe".into(),
        "--gameDir".into(),
        root.to_string_lossy().into_owned(),
        "--version=All the Mods 10".into(),
        "--accessToken".into(),
        "do-not-retain".into(),
    ];
    let game = game_from_args(21, &args).ok_or("game arguments")?;
    let instances: Vec<_> = ["All the Mods 10", "Shared"]
        .iter()
        .map(|name| DiscoveredInstance {
            launcher_path: temp.path().join("PCL"),
            instance_path: root.join("versions").join(name),
            name: (*name).into(),
            game_root: root.clone(),
            minecraft_version: None,
            mod_loader: None,
            isolation: "shared".into(),
        })
        .collect();
    let active = match_instances(
        &[
            game,
            RunningGame {
                pid: 22,
                game_root: root.clone(),
                version: Some("Shared".into()),
            },
        ],
        &instances,
    );
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].pids, [21, 22]);
    assert!(active[0].name.contains("All the Mods 10"));
    assert!(active[0].name.contains("Shared"));
    assert!(!serde_json::to_string(&active)?.contains("do-not-retain"));
    assert!(game_from_args(21, &["java".into(), "server.jar".into()]).is_none());
    assert!(game_from_args(21, &["--gameDir".into(), "relative".into()]).is_none());
    Ok(())
}
