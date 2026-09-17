//! Icon disk cache: stable keys, PNG validation, read/write.
use super::*;

/// Stable across restarts: do NOT mix resource_signature (mtimes) into the key.
/// Pipeline format version lives in the suffix; invalidate by bumping it.
pub(crate) fn cache_key(root: &str, _signature: &str, category: &str, key: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(root.as_bytes());
    hasher.update(b"\0");
    hasher.update(category.as_bytes());
    hasher.update(b"\0");
    hasher.update(key.as_bytes());
    hasher.update(b"\0stable-v13");
    hasher.finalize().to_hex().to_string()
}

pub(crate) fn is_cache_key(key: &str) -> bool {
    key.len() == CACHE_KEY_LEN && key.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn cache_files(dir: &Path, key: &str) -> Option<(PathBuf, PathBuf)> {
    if !is_cache_key(key) {
        return None;
    }
    Some((
        dir.join(format!("{key}.png")),
        dir.join(format!("{key}.json")),
    ))
}

pub(crate) fn png_is_valid(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
}

pub(crate) fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !png_is_valid(bytes) {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

pub(crate) fn read_icon_cache(dir: &Path, key: &str) -> Option<Resolution> {
    let (png_path, meta_path) = cache_files(dir, key)?;
    let bytes = fs::read(png_path).ok()?;
    if !png_is_valid(&bytes) {
        return None;
    }
    let meta: Value = serde_json::from_slice(&fs::read(meta_path).ok()?).ok()?;
    let source = meta
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Some(Resolution {
        image: Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes))),
        source,
        reason: "本地缓存图标".into(),
        job: None,
    })
}

pub(crate) fn write_icon_cache(
    dir: &Path,
    key: &str,
    png: &[u8],
    size: (u32, u32),
    kind: &str,
    source: &str,
    reason: &str,
) -> bool {
    let (width, height) = size;
    let Some((png_path, meta_path)) = cache_files(dir, key) else {
        return false;
    };
    if png_size(png).is_none() || width == 0 || height == 0 || width > 2048 || height > 2048 {
        return false;
    }
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    if fs::write(&png_path, png).is_err() {
        return false;
    }
    let meta = serde_json::json!({
        "source": source,
        "reason": reason,
        "width": width,
        "height": height,
        "kind": kind,
    });
    match serde_json::to_vec(&meta) {
        Ok(json) => fs::write(&meta_path, json).is_ok(),
        Err(_) => {
            let _ = fs::remove_file(&png_path);
            false
        }
    }
}

pub(crate) fn data_url_png(image: &str) -> Option<Vec<u8>> {
    let body = image.strip_prefix("data:image/png;base64,")?;
    STANDARD.decode(body).ok()
}

pub(crate) fn attach_job_meta(mut resolution: Resolution, key: &str, root: &str) -> Resolution {
    if let Some(job) = resolution.job.as_mut() {
        if let Some(object) = job.as_object_mut() {
            object.insert("cacheKey".into(), Value::String(key.into()));
            object.insert("root".into(), Value::String(root.into()));
        }
    }
    resolution
}

pub(crate) fn store_resolution_image(dir: &Path, key: &str, answer: &Resolution) {
    let (Some(image), None) = (&answer.image, &answer.job) else {
        return;
    };
    let Some(bytes) = data_url_png(image) else {
        return;
    };
    let Some((width, height)) = png_size(&bytes) else {
        return;
    };
    write_icon_cache(
        dir,
        key,
        &bytes,
        (width, height),
        "item",
        &answer.source,
        &answer.reason,
    );
}
