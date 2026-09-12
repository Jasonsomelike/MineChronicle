mod support;
use minechronicle_lib::commands::{cancel_scan, scan_game_roots};
use std::sync::{Arc, Mutex};
use support::*;
use tauri::{
    ipc::{CallbackFn, Channel, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
    Manager,
};

#[test]
fn registered_scan_command_reads_fixture_and_serializes_ticks_losslessly() -> TestResult {
    let (_temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Synthetic IPC")?;
    stats(&world, "stats", PLAYER, i64::MAX)?;
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState {
            path: _temp.path().join("test.sqlite3"),
        })
        .build(mock_context(noop_assets()))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    let response = get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "scan_game_roots".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse()?,
            body: InvokeBody::Json(
                serde_json::json!({"paths":[root],"onProgress":"__CHANNEL__:10"}),
            ),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map_err(|e| std::io::Error::other(e.to_string()))?;
    let json = response.deserialize::<serde_json::Value>()?;
    assert_eq!(json["roots"][0]["worlds"][0]["name"], "Synthetic IPC");
    assert_eq!(
        json["roots"][0]["worlds"][0]["players"][0]["play_ticks"],
        "9223372036854775807"
    );
    assert_eq!(json["issues"], serde_json::json!([]));
    assert_eq!(json["cancelled"], false);
    assert_eq!(json["saved"], true);
    assert_eq!(json["historical_ticks"], "9223372036854775807");
    Ok(())
}

#[test]
fn background_command_emits_progress_and_allows_another_scan_after_completion() -> TestResult {
    let (_temp, root) = game()?;
    level(&root.join("saves/world"), "Progress")?;
    stats(&root.join("saves/world"), "stats", PLAYER, 40)?;
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState {
            path: _temp.path().join("test.sqlite3"),
        })
        .build(mock_context(noop_assets()))?;
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    let channel = Channel::new(move |body| {
        let event: serde_json::Value = body.deserialize()?;
        captured
            .lock()
            .map_err(|_| std::io::Error::other("test event lock poisoned"))?
            .push(event);
        Ok(())
    });
    let result = tauri::async_runtime::block_on(scan_game_roots(
        vec![root.to_string_lossy().into_owned()],
        channel,
        app.state(),
        app.state(),
    ))?;
    assert!(!result.cancelled);
    assert_eq!(
        events
            .lock()
            .map_err(|_| "poisoned")?
            .last()
            .map(|e| e["player_files_scanned"].clone()),
        Some(serde_json::json!(1))
    );
    let again = tauri::async_runtime::block_on(scan_game_roots(
        vec![root.to_string_lossy().into_owned()],
        Channel::new(|_| Ok(())),
        app.state(),
        app.state(),
    ))?;
    assert_eq!(again.roots.len(), 1);
    Ok(())
}

#[test]
fn cancellation_stops_work_and_does_not_poison_the_next_scan() -> TestResult {
    let (_temp, root) = game()?;
    level(&root.join("saves/world"), "Cancel")?;
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState {
            path: _temp.path().join("test.sqlite3"),
        })
        .build(mock_context(noop_assets()))?;
    let handle = app.handle().clone();
    let channel = Channel::new(move |_| {
        cancel_scan(handle.state());
        Ok(())
    });
    let result = tauri::async_runtime::block_on(scan_game_roots(
        vec![root.to_string_lossy().into_owned()],
        channel,
        app.state(),
        app.state(),
    ))?;
    assert!(result.cancelled);
    assert!(result.roots[0].worlds.is_empty());
    assert!(!result.saved);
    assert!(!_temp.path().join("test.sqlite3").exists());
    let again = tauri::async_runtime::block_on(scan_game_roots(
        vec![root.to_string_lossy().into_owned()],
        Channel::new(|_| Ok(())),
        app.state(),
        app.state(),
    ))?;
    assert!(!again.cancelled);
    assert_eq!(again.roots[0].worlds.len(), 1);
    Ok(())
}

#[test]
fn invalid_request_is_rejected_before_scanning() -> TestResult {
    let _temp = tempfile::tempdir()?;
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState {
            path: _temp.path().join("test.sqlite3"),
        })
        .build(mock_context(noop_assets()))?;
    for roots in [vec![], vec![String::new()], vec!["unused".to_owned(); 33]] {
        let result = tauri::async_runtime::block_on(scan_game_roots(
            roots,
            Channel::new(|_| Err(std::io::Error::other("progress should not be invoked").into())),
            app.state(),
            app.state(),
        ));
        assert!(result.is_err());
    }
    Ok(())
}

#[test]
fn registered_library_commands_restore_saved_worlds_and_player_aliases() -> TestResult {
    let (_temp, root) = game()?;
    let world = root.join("saves/world");
    level(&world, "Persisted IPC")?;
    stats(&world, "stats", PLAYER, 72000)?;
    let database_path = _temp.path().join("library.sqlite3");
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState {
            path: database_path.clone(),
        })
        .build(mock_context(noop_assets()))?;
    tauri::async_runtime::block_on(scan_game_roots(
        vec![root.to_string_lossy().into_owned()],
        Channel::new(|_| Ok(())),
        app.state(),
        app.state(),
    ))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    let invoke = |cmd: &str, body| {
        get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost"
                    .parse()
                    .map_err(|error| std::io::Error::other(format!("{error}")))?,
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map_err(|e| std::io::Error::other(e.to_string()))
    };
    let alias = invoke(
        "set_player_alias",
        serde_json::json!({"uuid":PLAYER,"name":"SyntheticBuilder"}),
    )?
    .deserialize::<serde_json::Value>()?;
    assert_eq!(
        alias["roots"][0]["worlds"][0]["players"][0]["preferred_name"],
        "SyntheticBuilder"
    );
    let loaded =
        invoke("load_library", serde_json::json!({}))?.deserialize::<serde_json::Value>()?;
    assert_eq!(loaded["report"]["historical_ticks"], "72000");
    assert_eq!(loaded["inputs"], serde_json::json!([root]));
    assert!(invoke(
        "set_player_alias",
        serde_json::json!({"uuid":"invalid","name":"Ignored"})
    )
    .is_err());
    let reopened =
        minechronicle_lib::database::Repository::open(&database_path).map_err(|e| e.to_string())?;
    assert_eq!(
        reopened.load().map_err(|e| e.to_string())?.roots[0].worlds[0].players[0]
            .preferred_name
            .as_deref(),
        Some("SyntheticBuilder")
    );
    Ok(())
}
