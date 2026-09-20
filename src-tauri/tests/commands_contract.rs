use std::error::Error;

use serde_json::json;
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
};

#[test]
fn registered_phase_command_reports_actual_capabilities() -> Result<(), Box<dyn Error>> {
    let app = minechronicle_lib::configure(mock_builder()).build(mock_context(noop_assets()))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    let response = get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "phase_status".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse()?,
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map_err(|error| std::io::Error::other(error.to_string()))?;
    assert_eq!(
        response.deserialize::<serde_json::Value>()?,
        json!({"phase":10,"offline":true,"scanning_available":true})
    );
    Ok(())
}

/// The icon request cap must not be tied to the statistics page size. It used to
/// be exactly 100 while `StatisticsPage.page_size` was also 100, so one extra
/// row (or any page-size change) rejected the whole batch.
#[test]
fn icon_requests_accept_a_page_larger_than_the_old_cap() -> Result<(), Box<dyn Error>> {
    let app = minechronicle_lib::configure(mock_builder()).build(mock_context(noop_assets()))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    let request = |count: usize| -> Result<InvokeRequest, Box<dyn Error>> {
        Ok(InvokeRequest {
            cmd: "resolve_stat_icons".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse()?,
            body: InvokeBody::Json(json!({
                "args": {
                    "requests": (0..count)
                        .map(|i| json!({
                            "key": format!("test:block_{i}"),
                            "category": "minecraft:mined",
                            "roots": [],
                        }))
                        .collect::<Vec<_>>(),
                    "cacheOnly": true,
                }
            })),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        })
    };

    // 101 was the first count the old cap rejected; it must now succeed.
    let response = get_ipc_response(&webview, request(101)?)
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    let resolved = response.deserialize::<serde_json::Value>()?;
    assert_eq!(
        resolved.as_object().map(|m| m.len()),
        Some(101),
        "every requested key should get an answer"
    );

    // Far beyond the limit must still be refused, not attempted.
    let error = match get_ipc_response(&webview, request(501)?) {
        Ok(_) => return Err("over the cap should fail".into()),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("资源请求超过上限"),
        "unexpected error: {error}"
    );
    Ok(())
}

/// Argument names across the IPC boundary must be camelCase on the JavaScript
/// side, because Tauri maps camelCase to the Rust parameter's snake_case and only
/// in that direction.
///
/// This shipped broken: the frontend sent `ended_at`, so the command reported
/// "missing required key endedAt" and the dialog could never save. The browser
/// check passed anyway because the mock fixture accepted the wrong key, which is
/// exactly the gap this test closes - it goes through the real invoke path, so a
/// misnamed key fails here instead of in front of the user.
#[test]
fn manual_end_command_accepts_the_key_the_frontend_sends() -> Result<(), Box<dyn Error>> {
    let temp = tempfile::tempdir()?;
    let archive = temp.path().join("archive.sqlite3");
    // A separate connection: `Repository` keeps its own private, and the schema
    // is created by opening one.
    minechronicle_lib::database::Repository::open(&archive)
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    {
        let connection = rusqlite::Connection::open(&archive)?;
        connection.execute(
            "INSERT INTO observed_sessions(game_root,instance_name,pids,started_at,status) \
             VALUES('root','Instance','[]','2026-09-18T13:52:20Z','interrupted')",
            [],
        )?;
    }

    // DatabaseState is managed in `run()`, not `configure()`, so the test adds it.
    let app = minechronicle_lib::configure(mock_builder())
        .manage(minechronicle_lib::database::DatabaseState {
            path: archive.clone(),
        })
        .build(mock_context(noop_assets()))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;

    // Returns the error text rather than panicking, so each assertion below can
    // say what it expected. The URL is a fixed valid literal but is still
    // propagated instead of unwrapped: clippy denies `unwrap_used` here.
    let invoke = |body: serde_json::Value| -> Result<(), String> {
        let url = "http://tauri.localhost"
            .parse()
            .map_err(|error| format!("test URL is invalid: {error}"))?;
        get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: "set_observed_session_end".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url,
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
    };

    // A misnamed key is rejected before the body is ever read, so this is the
    // signal the test exists for. `ended_at` is what shipped and broke.
    //
    // Keys sit at the top level of the payload: Tauri resolves each parameter
    // with a direct `payload.get(key)` (`tauri::ipc::command`, `deserialize_json`),
    // not through an `args` wrapper. The `resolve_stat_icons` test above happens
    // to nest under `args` because that command takes a single struct-like
    // parameter, which is a different path.
    let snake = invoke(json!({ "id": 1, "ended_at": "2026-09-18T14:30:00Z" }));
    let snake_error = match snake {
        Ok(()) => return Err("snake_case `ended_at` must not be the wire name".into()),
        Err(error) => error,
    };
    assert!(
        snake_error.contains("endedAt"),
        "the rejection must name the expected camelCase key, got: {snake_error}"
    );

    // The shape the frontend actually sends must get past argument binding.
    invoke(json!({ "id": 1, "endedAt": "2026-09-18T14:22:20Z" })).map_err(|error| {
        std::io::Error::other(format!("camelCase `endedAt` must bind, got: {error}"))
    })?;

    let repo = minechronicle_lib::database::Repository::open(&archive)
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    let session = repo
        .observed_sessions()
        .map_err(|error| std::io::Error::other(error.to_string()))?
        .into_iter()
        .find(|s| s.id == 1)
        .ok_or("session missing")?;
    assert_eq!(session.status, "closed");
    assert_eq!(session.ended_at.as_deref(), Some("2026-09-18T14:22:20Z"));
    assert_eq!(session.ended_source.as_deref(), Some("manual"));
    Ok(())
}
