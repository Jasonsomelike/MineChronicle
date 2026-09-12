mod support;
use minechronicle_lib::{
    database::{
        activity::{ActivityFilter, StatisticsFilter},
        DbResult, Repository,
    },
    scanner::GameRootScanner,
};
use std::{fs, path::Path};
use support::*;
fn db<T>(r: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    r.map_err(|e| e as _)
}
fn import(repo: &mut Repository, root: &Path) -> TestResult {
    db(repo.import(
        &GameRootScanner::default()
            .scan(&[root.to_owned()], |_| true)
            .into(),
        &[root.to_owned()],
    ))?;
    Ok(())
}
#[test]
fn combinations_union_deduplicate_and_preserve_none() -> TestResult {
    let (temp, root) = game()?;
    let a = root.join("saves/a");
    let b = root.join("saves/b");
    level(&a, "A")?;
    level(&b, "B")?;
    stats(&a, "stats", PLAYER, 1200)?;
    stats(&b, "stats", OTHER, 2400)?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    import(&mut repo, &root)?;
    let all = db(repo.statistics(&StatisticsFilter::default()))?;
    assert_eq!(all.sources, 2);
    let rows = db(repo.timeline(&ActivityFilter::default()))?;
    // Obtain authoritative stored paths, including Windows extended path form.
    let mut worlds = rows
        .events
        .iter()
        .map(|e| e.world_path.clone())
        .collect::<Vec<_>>();
    worlds.sort();
    worlds.dedup();
    if worlds.is_empty() {
        // Imported history is deliberately excluded from the timeline.
        worlds = GameRootScanner::default()
            .scan(std::slice::from_ref(&root), |_| true)
            .roots
            .iter()
            .flat_map(|r| {
                r.worlds
                    .iter()
                    .map(|w| w.canonical_path.to_string_lossy().into_owned())
            })
            .collect();
    }
    let mut duplicate = worlds.clone();
    duplicate.extend(worlds.clone());
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            world_paths: Some(duplicate),
            ..Default::default()
        }))?
        .sources,
        2
    );
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            world_paths: Some(vec![]),
            ..Default::default()
        }))?
        .sources,
        0
    );
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            game_roots: Some(vec![]),
            ..Default::default()
        }))?
        .sources,
        0
    );
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            players_none: true,
            ..Default::default()
        }))?
        .sources,
        0
    );
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            world_path: worlds[0].clone(),
            ..Default::default()
        }))?
        .sources,
        1
    );
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            world_paths: Some(worlds),
            uuids: vec![PLAYER.into()],
            ..Default::default()
        }))?
        .sources,
        1
    );
    Ok(())
}
#[test]
fn statistics_sort_all_matches_before_pagination_and_keep_metadata_last() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "Sort")?;
    stats(&world, "stats", PLAYER, 1200)?;
    let mut values = serde_json::Map::new();
    for n in 0..110 {
        values.insert(format!("count_{n:03}"), serde_json::json!(n));
    }
    values.insert("unknown".into(), serde_json::json!({"state":true}));
    values.insert("negative".into(), serde_json::json!(-8));
    values.insert("tie_a".into(), serde_json::json!(42));
    values.insert("tie_b".into(), serde_json::json!(42));
    fs::write(
        world.join(format!("stats/{PLAYER}.json")),
        serde_json::to_vec(
            &serde_json::json!({"stats":{"minecraft:custom":{"minecraft:play_time":1200},"test:sort":values},"DataVersion":3955}),
        )?,
    )?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    import(&mut repo, &root)?;
    let first = db(repo.statistics(&StatisticsFilter {
        query: "test:sort".into(),
        sort: "value_desc".into(),
        ..Default::default()
    }))?;
    let second = db(repo.statistics(&StatisticsFilter {
        query: "test:sort".into(),
        sort: "value_desc".into(),
        offset: 100,
        ..Default::default()
    }))?;
    assert_eq!(first.total, 114);
    assert_eq!(first.rows.len(), 100);
    assert_eq!(second.rows.len(), 14);
    assert_eq!(first.rows[0].value.as_deref(), Some("109"));
    let keys: Vec<_> = first
        .rows
        .iter()
        .chain(&second.rows)
        .map(|r| r.key.as_str())
        .collect();
    assert_eq!(keys.last(), Some(&"unknown"));
    assert_eq!(keys[keys.len() - 2], "negative");
    let ties: Vec<_> = keys
        .iter()
        .filter(|k| k.starts_with("tie_") || **k == "count_042")
        .copied()
        .collect();
    assert_eq!(ties, vec!["count_042", "tie_a", "tie_b"]);
    let ascending = db(repo.statistics(&StatisticsFilter {
        sort: "value_asc".into(),
        ..Default::default()
    }))?;
    assert_eq!(ascending.rows[0].key, "negative");
    assert_eq!(ascending.rows[1].value.as_deref(), Some("0"));
    let last = db(repo.statistics(&StatisticsFilter {
        sort: "value_asc".into(),
        offset: 100,
        ..Default::default()
    }))?;
    assert!(last.rows.iter().rev().take(2).all(|r| r.value.is_none()));
    assert!(repo
        .statistics(&StatisticsFilter {
            sort: "invalid".into(),
            ..Default::default()
        })
        .is_err());
    Ok(())
}

#[test]
fn statistics_sort_keeps_precision_across_players() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "Exact")?;
    for player in [PLAYER, OTHER] {
        stats(&world, "stats", player, 0)?;
        fs::write(
            world.join(format!("stats/{player}.json")),
            serde_json::to_vec(
                &serde_json::json!({"stats":{"minecraft:custom":{"minecraft:play_time":0},"test:sort":{"a_smaller":9007199254740992_i64,"z_larger":9007199254740993_i64,"huge":i64::MAX,"ten":10,"nine":9}}}),
            )?,
        )?;
    }
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    import(&mut repo, &root)?;
    let descending = db(repo.statistics(&StatisticsFilter {
        sort: "value_desc".into(),
        query: "test:sort".into(),
        ..Default::default()
    }))?;
    assert_eq!(
        descending
            .rows
            .iter()
            .map(|r| r.key.as_str())
            .collect::<Vec<_>>(),
        vec!["huge", "z_larger", "a_smaller", "ten", "nine"]
    );
    assert_eq!(
        descending.rows[0].value.as_deref(),
        Some("18446744073709551614")
    );
    let one_player = db(repo.statistics(&StatisticsFilter {
        sort: "value_asc".into(),
        uuid: PLAYER.into(),
        query: "test:sort".into(),
        ..Default::default()
    }))?;
    assert_eq!(one_player.rows[0].value.as_deref(), Some("9"));
    assert_eq!(
        one_player.rows[4].value.as_deref(),
        Some("9223372036854775807")
    );
    Ok(())
}
#[test]
fn timeline_distinguishes_history_changes_rollback_and_filters_without_duplicate_scans(
) -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "World")?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    for ticks in [100, 100, 200, 180, 183] {
        stats(&world, "stats", PLAYER, ticks)?;
        import(&mut repo, &root)?;
    }
    let all = db(repo.timeline(&ActivityFilter::default()))?;
    assert_eq!(all.total, 3);
    assert_eq!(
        all.events
            .iter()
            .map(|e| e.kind.as_str())
            .collect::<Vec<_>>(),
        ["rollback", "increment", "initial_import"]
    );
    assert_eq!(all.events[0].old_ticks.as_deref(), Some("200"));
    assert_eq!(all.events[0].delta_ticks, "0");
    let filter = ActivityFilter {
        kind: "increment".into(),
        world_path: fs::canonicalize(&world)?.to_string_lossy().into_owned(),
        uuid: PLAYER.into(),
        ..Default::default()
    };
    assert_eq!(db(repo.timeline(&filter))?.total, 1);
    assert_eq!(
        db(repo.timeline(&ActivityFilter {
            uuid: OTHER.into(),
            ..filter.clone()
        }))?
        .total,
        0
    );
    assert!(repo
        .timeline(&ActivityFilter {
            from: "2026-02-30".into(),
            ..Default::default()
        })
        .is_err());
    assert!(repo
        .timeline(&ActivityFilter {
            from: "2026-02-02".into(),
            to: "2026-01-01".into(),
            ..Default::default()
        })
        .is_err());
    assert_eq!(
        db(repo.timeline(&ActivityFilter {
            to: "2000-01-01".into(),
            ..Default::default()
        }))?
        .total,
        0
    );
    Ok(())
}
#[test]
fn timeline_paginates_after_removing_zero_duration_noise() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "World")?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    for ticks in (20..=1100).step_by(20) {
        stats(&world, "stats", PLAYER, ticks)?;
        import(&mut repo, &root)?;
    }
    fs::write(
        world.join(format!("stats/{PLAYER}.json")),
        br#"{"stats":{"minecraft:custom":{"minecraft:play_time":1100,"minecraft:jumps":9}}}"#,
    )?;
    import(&mut repo, &root)?;
    let a = db(repo.timeline(&ActivityFilter::default()))?;
    let b = db(repo.timeline(&ActivityFilter {
        offset: 50,
        ..Default::default()
    }))?;
    assert_eq!(a.total, 55);
    assert_eq!(a.events.len(), 50);
    assert_eq!(b.events.len(), 5);
    assert_eq!(a.events[0].kind, "increment");
    assert!(a
        .events
        .iter()
        .all(|e| e.kind != "tracking_started" && e.kind != "stats_changed"));
    assert!(a
        .events
        .iter()
        .all(|x| b.events.iter().all(|y| x.id != y.id)));
    Ok(())
}
#[test]
fn statistics_aggregate_precisely_preserve_extensions_and_keep_initial_separate() -> TestResult {
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "World")?;
    let mut repo = db(Repository::open(&temp.path().join("db")))?;
    for player in [PLAYER, OTHER] {
        stats(&world, "stats", player, i64::MAX)?;
    }
    import(&mut repo, &root)?;
    let current = db(repo.statistics(&StatisticsFilter::default()))?;
    assert_eq!(current.counters["play_ticks"], "18446744073709551614");
    assert_eq!(current.sources, 2);
    fs::write(world.join(format!("stats/{PLAYER}.json")),br#"{"stats":{"minecraft:custom":{"minecraft:play_time":100,"minecraft:jumps":9,"minecraft:walk_one_cm":12345},"mod:extension":{"precise":9223372036854775807,"object":{"done":true}}}}"#)?;
    import(&mut repo, &root)?;
    let filter = StatisticsFilter {
        uuid: PLAYER.into(),
        query: "mod:extension".into(),
        ..Default::default()
    };
    let now = db(repo.statistics(&filter))?;
    assert_eq!(now.counters["play_ticks"], "100");
    assert_eq!(now.counters["walk_cm"], "12345");
    assert_eq!(now.total, 2);
    assert_eq!(
        now.rows
            .iter()
            .find(|r| r.key == "precise")
            .and_then(|r| r.value.as_deref()),
        Some("9223372036854775807")
    );
    assert!(now
        .rows
        .iter()
        .any(|r| r.key == "object" && r.value.is_none() && !r.samples.is_empty()));
    let historical = db(repo.statistics(&StatisticsFilter {
        mode: "initial".into(),
        ..Default::default()
    }))?;
    assert_eq!(historical.counters["play_ticks"], "18446744073709551614");
    fs::write(world.join(format!("stats/{PLAYER}.json")), [])?;
    import(&mut repo, &root)?;
    assert_eq!(
        db(repo.statistics(&StatisticsFilter::default()))?.unavailable,
        1
    );
    fs::remove_dir_all(&world)?;
    import(&mut repo, &root)?;
    assert_eq!(
        db(repo.statistics(&StatisticsFilter::default()))?.sources,
        0
    );
    assert_eq!(
        db(repo.statistics(&StatisticsFilter {
            mode: "initial".into(),
            ..Default::default()
        }))?
        .sources,
        2
    );
    Ok(())
}

#[test]
fn activity_commands_are_registered_and_serialize_exact_values() -> TestResult {
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
        webview::InvokeRequest,
    };
    let (temp, root) = game()?;
    let world = root.join("saves/w");
    level(&world, "IPC")?;
    stats(&world, "stats", PLAYER, i64::MAX)?;
    let path = temp.path().join("db");
    let mut repo = db(Repository::open(&path))?;
    import(&mut repo, &root)?;
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState { path })
        .build(mock_context(noop_assets()))?;
    let view = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    for command in ["timeline", "statistics"] {
        let response = get_ipc_response(
            &view,
            InvokeRequest {
                cmd: command.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse()?,
                body: InvokeBody::Json(serde_json::json!({"filter":{}})),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map_err(|e| std::io::Error::other(e.to_string()))?;
        let value = response.deserialize::<serde_json::Value>()?;
        let ticks = if command == "timeline" {
            &value["events"][0]["play_ticks"]
        } else {
            &value["counters"]["play_ticks"]
        };
        assert_eq!(ticks, "9223372036854775807");
    }
    Ok(())
}
