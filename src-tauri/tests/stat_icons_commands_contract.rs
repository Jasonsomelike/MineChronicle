//! Contract tests for the two icon commands that the statistics view calls.
//!
//! These were the only `#[tauri::command]`s in the crate never driven through
//! real IPC: `commands_contract.rs` covers `phase_status`, but `resolve_stat_icons`
//! and `store_stat_icon` were only exercised through their private helpers, so
//! their validation branches (size mismatch, invalid PNG, missing cache
//! directory) had no coverage.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::error::Error;
use tauri::{
    ipc::{CallbackFn, InvokeBody, InvokeResponseBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
    Manager,
};

/// Minimal PNG header plus IHDR; enough for the header-size validation.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes
}

fn invoke(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<InvokeResponseBody, Box<dyn Error>> {
    let url = "http://tauri.localhost".parse().map_err(|_| "bad url")?;
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url,
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map_err(|error| format!("ipc failed: {error}").into())
}

fn store_body(key: &str, png_bytes: &[u8], width: u32, height: u32) -> serde_json::Value {
    json!({
        "request": {
            "cache_key": key,
            "png": format!("data:image/png;base64,{}", STANDARD.encode(png_bytes)),
            "width": width,
            "height": height,
            "kind": "item",
            "source": "contract-test.jar",
            "reason": "contract test",
        }
    })
}

/// Builds an app and points the already-managed icon cache at `cache`.
///
/// `configure()` manages `IconCacheDir` itself, so it must be set through
/// `state()` rather than added with another `.manage()`.
fn app_with_cache(
    cache: Option<std::path::PathBuf>,
) -> Result<tauri::App<tauri::test::MockRuntime>, Box<dyn Error>> {
    let app = minechronicle_lib::configure(mock_builder()).build(mock_context(noop_assets()))?;
    app.state::<minechronicle_lib::minecraft::runtime_resources::IconCacheDir>()
        .set(cache);
    Ok(app)
}

#[test]
fn store_stat_icon_reports_false_without_a_cache_directory() -> Result<(), Box<dyn Error>> {
    // The cache directory is unset, so the command must report "not stored"
    // rather than failing.
    let app = app_with_cache(None)?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    let response = invoke(
        &webview,
        "store_stat_icon",
        store_body(&"a".repeat(64), &png(16, 16), 16, 16),
    )?;
    assert!(!response.deserialize::<bool>()?);
    Ok(())
}

#[test]
fn store_stat_icon_writes_the_cache_and_rejects_inconsistent_input() -> Result<(), Box<dyn Error>> {
    let temp = tempfile::tempdir()?;
    let cache = temp.path().to_path_buf();
    let app = app_with_cache(Some(cache.clone()))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;

    // A well-formed request stores the icon and its metadata sidecar.
    let key = "b".repeat(64);
    let response = invoke(
        &webview,
        "store_stat_icon",
        store_body(&key, &png(16, 16), 16, 16),
    )?;
    assert!(response.deserialize::<bool>()?);
    assert!(cache.join(format!("{key}.png")).is_file());
    assert!(cache.join(format!("{key}.json")).is_file());

    // The declared size must match the PNG header.
    let error = match invoke(
        &webview,
        "store_stat_icon",
        store_body(&key, &png(16, 16), 32, 32),
    ) {
        Ok(_) => return Err("a size mismatch should fail".into()),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("尺寸与像素不一致"),
        "unexpected error: {error}"
    );

    // The payload must actually be a PNG.
    let error = match invoke(
        &webview,
        "store_stat_icon",
        json!({
            "request": {
                "cache_key": key,
                "png": STANDARD.encode(b"not a png at all"),
                "width": 16,
                "height": 16,
                "kind": "item",
                "source": "",
                "reason": "",
            }
        }),
    ) {
        Ok(_) => return Err("an invalid PNG should fail".into()),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("不是有效PNG"),
        "unexpected error: {error}"
    );
    Ok(())
}

#[test]
fn resolve_stat_icons_answers_every_requested_key() -> Result<(), Box<dyn Error>> {
    // cacheOnly stays on the disk-cache path, so no instance roots are needed.
    let temp = tempfile::tempdir()?;
    let app = app_with_cache(Some(temp.path().to_path_buf()))?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;

    let response = invoke(
        &webview,
        "resolve_stat_icons",
        json!({
            "args": {
                "requests": [
                    { "key": "minecraft:stone", "category": "minecraft:mined", "roots": [] },
                    { "key": "minecraft:dirt", "category": "minecraft:mined", "roots": [] },
                    { "key": "minecraft:air", "category": "minecraft:used", "roots": [] },
                ],
                "cacheOnly": true,
            }
        }),
    )?;
    let resolved: serde_json::Value = response.deserialize()?;
    let map = resolved.as_object().ok_or("expected an object")?;
    assert_eq!(map.len(), 3, "every requested key needs an answer");
    for key in [
        "minecraft:mined:minecraft:stone",
        "minecraft:mined:minecraft:dirt",
        "minecraft:used:minecraft:air",
    ] {
        let entry = map.get(key).ok_or_else(|| format!("missing {key}"))?;
        assert!(entry.get("reason").is_some(), "{key} needs a reason");
    }
    Ok(())
}

#[test]
fn resolve_stat_icons_ignores_a_relative_root() -> Result<(), Box<dyn Error>> {
    // A relative root is not an instance directory; the request must still be
    // answered instead of erroring or reading something unexpected.
    let app = app_with_cache(None)?;
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build()?;
    let response = invoke(
        &webview,
        "resolve_stat_icons",
        json!({
            "args": {
                "requests": [
                    { "key": "minecraft:stone", "category": "minecraft:mined", "roots": ["relative/path"] },
                ],
                "cacheOnly": true,
            }
        }),
    )?;
    let resolved: serde_json::Value = response.deserialize()?;
    let entry = resolved
        .get("minecraft:mined:minecraft:stone")
        .ok_or("expected an answer for the requested key")?;
    assert!(entry["image"].is_null());
    Ok(())
}
