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
