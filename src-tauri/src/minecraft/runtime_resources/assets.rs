//! Resource-pack discovery, the lazy asset index and model JSON.
use super::*;

pub(crate) fn children(path: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<_> = fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect();
    paths.sort();
    paths
}
pub(crate) fn sources(root: &Path) -> Vec<PathBuf> {
    let mut bases = vec![root.to_path_buf()];
    if root
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|n| n == "versions")
    {
        if let Some(base) = root.parent().and_then(Path::parent) {
            bases.insert(0, base.to_path_buf());
        }
    }
    let mut result = Vec::new();
    for base in &bases {
        result.extend(
            children(base)
                .into_iter()
                .filter(|p| p.extension().is_some_and(|e| e == "jar")),
        );
        result.extend(
            children(&base.join("mods"))
                .into_iter()
                .filter(|p| p.extension().is_some_and(|e| e == "jar")),
        );
        for directory in ["kubejs/assets", "resources/assets"] {
            let p = base.join(directory);
            if p.is_dir() {
                result.push(p);
            }
        }
    }
    // options.txt lists enabled packs low to high; later files override earlier ones.
    if let Ok(options) = fs::read_to_string(root.join("options.txt")) {
        if let Some(line) = options
            .lines()
            .find_map(|l| l.strip_prefix("resourcePacks:"))
        {
            if let Ok(packs) = serde_json::from_str::<Vec<String>>(line) {
                for name in packs {
                    let Some(name) = name.strip_prefix("file/") else {
                        continue;
                    };
                    if !safe(name) {
                        continue;
                    }
                    for base in &bases {
                        let p = base.join("resourcepacks").join(name);
                        if p.is_file() {
                            result.push(p);
                        } else if p.join("assets").is_dir() {
                            result.push(p.join("assets"));
                        }
                    }
                }
            }
        }
    }
    result
}
pub(crate) fn safe(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('\\')
        && !name.starts_with('/')
        && name.split('/').all(|s| s != ".." && s != ".")
}
pub(crate) fn loose_files(path: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    if depth > 16 || files.len() >= 200_000 {
        return;
    }
    for p in children(path) {
        if fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            continue;
        }
        if p.is_dir() {
            loose_files(&p, depth + 1, files);
        } else {
            files.push(p);
        }
    }
}

/// File identity only — does not open archives.
/// Takes the already-resolved source list so callers that also need it do not
/// walk the directory twice (the walk itself measured ~0.23 ms per build; the
/// stat pass below dominates at ~29 ms for a 300-jar instance).
pub(crate) fn resource_signature(paths: &[PathBuf]) -> String {
    let mut files = Vec::new();
    for p in paths {
        if p.is_dir() {
            loose_files(p, 0, &mut files);
        } else {
            files.push(p.clone());
        }
    }
    files
        .iter()
        .map(|p| {
            let m = fs::metadata(p).ok();
            format!(
                "{}:{}:{}",
                p.display(),
                m.as_ref().map_or(0, |m| m.len()),
                m.and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_nanos())
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

pub(crate) fn indexed(root: &Path, previous: Option<Index>) -> Index {
    let paths = sources(root);
    let signature = resource_signature(&paths);
    if let Some(mut old) = previous {
        if old.signature == signature {
            old.checked = Instant::now();
            return old;
        }
    }
    let mut assets = HashMap::new();
    for p in paths {
        if p.is_dir() {
            let mut loose = Vec::new();
            loose_files(&p, 0, &mut loose);
            for f in loose {
                if let Ok(rel) = f.strip_prefix(&p) {
                    assets.insert(
                        format!("assets/{}", rel.to_string_lossy().replace('\\', "/")),
                        Asset {
                            container: f,
                            entry: None,
                        },
                    );
                }
            }
        } else if let Ok(file) = fs::File::open(&p) {
            if let Ok(zip) = zip::ZipArchive::new(file) {
                for name in zip.file_names().take(200_000) {
                    if name.starts_with("assets/")
                        && safe(name)
                        && (name.ends_with(".json")
                            || name.ends_with(".png")
                            || name.ends_with(".mcmeta"))
                    {
                        assets.insert(
                            name.into(),
                            Asset {
                                container: p.clone(),
                                entry: Some(name.into()),
                            },
                        );
                    }
                }
            }
        }
    }
    Index {
        checked: Instant::now(),
        signature,
        assets,
        answers: HashMap::new(),
        archives: Mutex::new(HashMap::new()),
        model_class_files: Mutex::new(HashMap::new()),
        java_attempts: std::sync::atomic::AtomicUsize::new(0),
    }
}
pub(crate) fn read(index: &Index, path: &str) -> Option<(Vec<u8>, String)> {
    let a = index.assets.get(path)?;
    let mut bytes = Vec::new();
    if let Some(entry) = &a.entry {
        let mut archives = index.archives.lock().ok()?;
        if !archives.contains_key(&a.container) {
            if archives.len() >= 8 {
                archives.clear();
            }
            archives.insert(
                a.container.clone(),
                zip::ZipArchive::new(fs::File::open(&a.container).ok()?).ok()?,
            );
        }
        let zip = archives.get_mut(&a.container)?;
        let entry = zip.by_name(entry).ok()?;
        if entry.size() > MAX_ASSET {
            return None;
        }
        entry.take(MAX_ASSET + 1).read_to_end(&mut bytes).ok()?;
    } else {
        let file = fs::File::open(&a.container).ok()?;
        file.take(MAX_ASSET + 1).read_to_end(&mut bytes).ok()?;
    }
    if bytes.len() as u64 > MAX_ASSET {
        return None;
    }
    Some((bytes, format!("{} · {}", a.container.display(), path)))
}
pub(crate) fn asset_path(id: &str, folder: &str, extension: &str) -> Option<String> {
    let (ns, name) = id.split_once(':').unwrap_or(("minecraft", id));
    if !safe(ns) || ns.contains('/') || !safe(name) {
        return None;
    }
    Some(format!("assets/{ns}/{folder}/{name}.{extension}"))
}
pub(crate) fn json(index: &Index, path: &str) -> Option<Value> {
    serde_json::from_slice(&read(index, path)?.0).ok()
}
pub(crate) fn model(index: &Index, id: &str, seen: &mut Vec<String>) -> Result<Value, String> {
    if seen.len() >= 24 || seen.iter().any(|s| s == id) {
        return Err("模型父链循环或超过24层".into());
    }
    seen.push(id.into());
    let mut value = json(
        index,
        &asset_path(id, "models", "json").ok_or("非法模型标识")?,
    )
    .ok_or("模型资源不存在")?;
    if let Some(loader) = value.get("loader").and_then(Value::as_str) {
        if matches!(
            loader,
            "forge:separate_transforms" | "neoforge:separate_transforms"
        ) {
            value = value
                .pointer("/perspectives/gui")
                .or_else(|| value.get("base"))
                .cloned()
                .ok_or("分视角模型未定义GUI或base")?;
        } else {
            return Err(format!("需要自定义模型加载器：{loader}"));
        }
    }
    if let Some(parent) = value
        .get("parent")
        .and_then(Value::as_str)
        .map(str::to_owned)
    {
        if ![
            "item/generated",
            "minecraft:item/generated",
            "item/handheld",
            "minecraft:item/handheld",
            "builtin/generated",
            "minecraft:builtin/generated",
        ]
        .contains(&parent.as_str())
        {
            let base = model(index, &parent, seen)?;
            let mut textures = base
                .get("textures")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(local) = value.get("textures").and_then(Value::as_object) {
                textures.extend(local.clone());
            }
            if let Some(obj) = value.as_object_mut() {
                if obj.get("elements").is_none() {
                    if let Some(e) = base.get("elements") {
                        obj.insert("elements".into(), e.clone());
                    }
                }
                if obj.get("display").is_none() {
                    if let Some(e) = base.get("display") {
                        obj.insert("display".into(), e.clone());
                    }
                }
                obj.insert("textures".into(), Value::Object(textures));
            }
        }
    }
    Ok(value)
}
pub(crate) fn texture_id(value: &Value, reference: &str) -> Option<String> {
    let mut reference = reference.to_owned();
    let mut seen = Vec::new();
    while let Some(alias) = reference.strip_prefix('#') {
        if seen.len() >= 24 || seen.contains(&reference) {
            return None;
        }
        seen.push(reference.clone());
        reference = value.get("textures")?.get(alias)?.as_str()?.into();
    }
    Some(reference)
}
pub(crate) fn texture_data(index: &Index, reference: &str) -> Option<String> {
    let path = asset_path(reference, "textures", "png")?;
    if index.assets.contains_key(&format!("{path}.mcmeta")) {
        return None;
    }
    let (bytes, _) = read(index, &path)?;
    if !png_is_valid(&bytes) {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

pub(crate) fn animation_frame_height(
    index: &Index,
    png_path: &str,
    width: u32,
    height: u32,
) -> u32 {
    let default = if height >= width && height.is_multiple_of(width) {
        width
    } else {
        height.max(1)
    };
    let Some(meta) = json(index, &format!("{png_path}.mcmeta")) else {
        return default;
    };
    let Some(anim) = meta.get("animation") else {
        return default;
    };
    if let Some(frame_height) = anim.get("frame_height").and_then(Value::as_u64) {
        if frame_height > 0 && frame_height <= u64::from(height) {
            return frame_height as u32;
        }
    }
    default
}

pub(crate) fn animated_texture_job(index: &Index, png_path: &str) -> Option<Resolution> {
    let (bytes, source) = read(index, png_path)?;
    let (width, height) = png_size(&bytes)?;
    let frame_height = animation_frame_height(index, png_path, width, height);
    if frame_height == 0 || frame_height > height {
        return None;
    }
    Some(Resolution {
        image: None,
        source,
        reason: "自动提取动画材质首帧".into(),
        job: Some(serde_json::json!({
            "kind": "frame",
            "layers": [format!("data:image/png;base64,{}", STANDARD.encode(bytes))],
            "frameHeight": frame_height,
        })),
    })
}
