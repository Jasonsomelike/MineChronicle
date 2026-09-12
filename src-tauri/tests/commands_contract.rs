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
