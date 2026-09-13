//! Read-only, lazy resource-pack discovery. Never executes mod classes.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, UNIX_EPOCH},
};

const CACHE_KEY_LEN: usize = 64;

#[derive(Clone, Default)]
pub struct IconCacheDir(pub std::sync::Arc<Mutex<Option<PathBuf>>>);

impl IconCacheDir {
    pub fn set(&self, path: Option<PathBuf>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = path;
        }
    }
    pub fn get(&self) -> Option<PathBuf> {
        self.0.lock().ok().and_then(|slot| slot.clone())
    }
}

const MAX_ASSET: u64 = 8 * 1024 * 1024;
#[derive(Clone)]
struct Asset {
    container: PathBuf,
    entry: Option<String>,
}
struct Index {
    checked: Instant,
    signature: String,
    assets: HashMap<String, Asset>,
    answers: HashMap<String, Resolution>,
    archives: Mutex<HashMap<PathBuf, zip::ZipArchive<fs::File>>>,
}
static CACHE: OnceLock<Mutex<HashMap<String, Index>>> = OnceLock::new();
#[derive(Deserialize)]
pub struct Request {
    pub key: String,
    pub category: String,
    pub roots: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveStatIconsArgs {
    pub requests: Vec<Request>,
    #[serde(default)]
    pub cache_only: bool,
}
#[derive(Clone, Serialize)]
pub struct Resolution {
    pub image: Option<String>,
    pub source: String,
    pub reason: String,
    pub job: Option<Value>,
}
fn missing(reason: impl Into<String>) -> Resolution {
    Resolution {
        image: None,
        source: String::new(),
        reason: reason.into(),
        job: None,
    }
}

fn cache_key(root: &str, signature: &str, category: &str, key: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(root.as_bytes());
    hasher.update(b"\0");
    hasher.update(signature.as_bytes());
    hasher.update(b"\0");
    hasher.update(category.as_bytes());
    hasher.update(b"\0");
    hasher.update(key.as_bytes());
    // Bump when icon pipeline output format changes so stale PNGs are not reused.
    hasher.update(b"\0box-v2");
    hasher.finalize().to_hex().to_string()
}

fn is_cache_key(key: &str) -> bool {
    key.len() == CACHE_KEY_LEN && key.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn cache_files(dir: &Path, key: &str) -> Option<(PathBuf, PathBuf)> {
    if !is_cache_key(key) {
        return None;
    }
    Some((
        dir.join(format!("{key}.png")),
        dir.join(format!("{key}.json")),
    ))
}

fn png_is_valid(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
}

fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
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

fn read_icon_cache(dir: &Path, key: &str) -> Option<Resolution> {
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

fn write_icon_cache(
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

fn data_url_png(image: &str) -> Option<Vec<u8>> {
    let body = image.strip_prefix("data:image/png;base64,")?;
    STANDARD.decode(body).ok()
}

fn attach_job_meta(mut resolution: Resolution, key: &str, root: &str) -> Resolution {
    if let Some(job) = resolution.job.as_mut() {
        if let Some(object) = job.as_object_mut() {
            object.insert("cacheKey".into(), Value::String(key.into()));
            object.insert("root".into(), Value::String(root.into()));
        }
    }
    resolution
}

fn children(path: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<_> = fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect();
    paths.sort();
    paths
}
fn sources(root: &Path) -> Vec<PathBuf> {
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
fn safe(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('\\')
        && !name.starts_with('/')
        && name.split('/').all(|s| s != ".." && s != ".")
}
fn loose_files(path: &Path, depth: usize, files: &mut Vec<PathBuf>) {
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
fn resource_signature(root: &Path) -> String {
    let paths = sources(root);
    let mut files = Vec::new();
    for p in &paths {
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

fn indexed(root: &Path, previous: Option<Index>) -> Index {
    let paths = sources(root);
    let signature = resource_signature(root);
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
    }
}
fn read(index: &Index, path: &str) -> Option<(Vec<u8>, String)> {
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
fn asset_path(id: &str, folder: &str, extension: &str) -> Option<String> {
    let (ns, name) = id.split_once(':').unwrap_or(("minecraft", id));
    if !safe(ns) || ns.contains('/') || !safe(name) {
        return None;
    }
    Some(format!("assets/{ns}/{folder}/{name}.{extension}"))
}
fn json(index: &Index, path: &str) -> Option<Value> {
    serde_json::from_slice(&read(index, path)?.0).ok()
}
fn model(index: &Index, id: &str, seen: &mut Vec<String>) -> Result<Value, String> {
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
fn texture_id(value: &Value, reference: &str) -> Option<String> {
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
fn texture_data(index: &Index, reference: &str) -> Option<String> {
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

fn animation_frame_height(index: &Index, png_path: &str, width: u32, height: u32) -> u32 {
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

fn animated_texture_job(index: &Index, png_path: &str) -> Option<Resolution> {
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

fn pick_entity_path<'a>(paths: &[&'a String], key_name: &str) -> Option<&'a String> {
    if paths.len() == 1 {
        return Some(paths[0]);
    }
    let preferred: Vec<&String> = paths
        .iter()
        .copied()
        .filter(|p| p.contains(&format!("/geo/entity/{key_name}")))
        .collect();
    let candidates = if preferred.is_empty() {
        paths
            .iter()
            .copied()
            .filter(|p| {
                p.contains(key_name)
                    && !p.contains("overlay")
                    && !p.contains("/layer")
                    && !p.ends_with("_spawn.geo.json")
            })
            .collect::<Vec<_>>()
    } else {
        preferred
    };
    if candidates.len() == 1 {
        return Some(candidates[0]);
    }
    None
}

fn snake_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() {
            if i != 0 {
                out.push('_');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn entity_name_aliases(ns: &str, name: &str) -> Vec<String> {
    let mut names = vec![name.to_string()];
    let snake = snake_case(name);
    if snake != name {
        names.push(snake);
    }
    let lower = name.to_ascii_lowercase();
    if !names.contains(&lower) {
        names.push(lower);
    }
    // Registry id differs from installed texture basename.
    if ns == "draconicevolution"
        && (name == "draconic_guardian" || name == "draconic_chaos_guardian")
    {
        names.push("chaos_guardian".into());
    }
    match (ns, name) {
        ("minecraft", "ender_dragon") => {
            names.push("enderdragon".into());
            names.push("dragon".into());
        }
        ("minecraft", "magma_cube") => {
            names.push("magmacube".into());
            names.push("magma".into());
        }
        ("minecraft", "cave_spider") => {
            names.push("cavespider".into());
        }
        ("iceandfire", "fire_dragon") => {
            names.push("dragon_fire".into());
            names.push("firedragon".into());
        }
        ("iceandfire", "ice_dragon") => {
            names.push("dragon_ice".into());
            names.push("icedragon".into());
        }
        ("iceandfire", "deathworm") => {
            names.push("death_worm".into());
        }
        _ if name.eq_ignore_ascii_case("PoisonSpider") => {
            names.push("poisonspider".into());
            names.push("poison_spider".into());
        }
        _ => {}
    }
    names.dedup();
    names
}

fn entity_resource_candidates(key: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some((ns, name)) = key.split_once(':') {
        if !ns.is_empty() && !name.is_empty() && !ns.contains('.') {
            out.push((ns.to_string(), name.to_string()));
            return out;
        }
    }
    let raw = key
        .strip_prefix("stat.entityKilledBy.")
        .or_else(|| key.strip_prefix("stat.killEntity."))
        .unwrap_or(key);
    if raw.is_empty() {
        return out;
    }
    if let Some((ns, name)) = raw.split_once('.') {
        out.push((ns.to_ascii_lowercase(), name.to_string()));
        if ns != ns.to_ascii_lowercase() {
            out.push((ns.to_string(), name.to_string()));
        }
    }
    let last = raw.rsplit('.').next().unwrap_or(raw);
    for ns in ["minecraft", "specialmobs"] {
        out.push((ns.to_string(), last.to_string()));
    }
    out.dedup();
    out
}

fn is_entity_stat(category: &str, key: &str) -> bool {
    category.ends_with("killed")
        || category.ends_with("killed_by")
        || (category == "legacy"
            && (key.starts_with("stat.entityKilledBy.") || key.starts_with("stat.killEntity.")))
}

/// Synthesize a simple two-box mob so texture-only entities still render in 3D
/// instead of dumping the raw UV unwrap as the icon.
fn representative_box_model(width: u32, height: u32) -> Value {
    let tall = height as f32 >= width as f32 * 1.2;
    let bones = if tall {
        serde_json::json!([
            {
                "name": "head",
                "pivot": [0, 12, 0],
                "cubes": [{ "origin": [-4, 12, -4], "size": [8, 8, 8], "uv": [0, 0] }]
            },
            {
                "name": "body",
                "pivot": [0, 12, 0],
                "cubes": [{ "origin": [-4, 0, -2], "size": [8, 12, 4], "uv": [16, 16] }]
            }
        ])
    } else {
        serde_json::json!([
            {
                "name": "head",
                "pivot": [0, 10, -4],
                "cubes": [{ "origin": [-4, 6, -8], "size": [8, 8, 8], "uv": [0, 0] }]
            },
            {
                "name": "body",
                "pivot": [0, 10, 0],
                "cubes": [{ "origin": [-4, 2, -3], "size": [8, 8, 6], "uv": [28, 8] }]
            }
        ])
    };
    serde_json::json!({
        "format": "bedrock",
        "textureWidth": width.max(1),
        "textureHeight": height.max(1),
        "bones": bones
    })
}

fn texture_only_entity(index: &Index, skin_path: &str, reason: &str) -> Resolution {
    let Some((bytes, source)) = read(index, skin_path) else {
        return missing("实体纹理不可读");
    };
    let Some((width, height)) = png_size(&bytes) else {
        return missing("实体纹理不是有效PNG");
    };
    let model = representative_box_model(width, height);
    Resolution {
        image: None,
        source,
        reason: format!("{reason}；以代表性盒模型立体渲染"),
        job: Some(serde_json::json!({
            "entityModel": model,
            "layers": [format!("data:image/png;base64,{}", STANDARD.encode(bytes))]
        })),
    }
}

fn find_skin_loose(index: &Index, ns: &str, aliases: &[String]) -> Option<String> {
    let prefix = format!("assets/{ns}/textures/entity/");
    let mut hits: Vec<&String> = index
        .assets
        .keys()
        .filter(|p| {
            if !p.starts_with(&prefix) || !p.ends_with(".png") {
                return false;
            }
            let file = p.rsplit('/').next().unwrap_or("");
            let base = file.trim_end_matches(".png").to_ascii_lowercase();
            aliases.iter().any(|a| {
                let a = a.to_ascii_lowercase();
                base == a
                    || base.ends_with(&format!("_{a}"))
                    || base.starts_with(&format!("{a}_"))
                    || base.contains(&a)
            }) && !base.contains("overlay")
                && !base.contains("layer")
                && !base.ends_with("_spawn")
                && !base.ends_with("_egg")
        })
        .collect();
    hits.sort();
    hits.dedup();
    if hits.len() == 1 {
        return Some(hits[0].clone());
    }
    None
}

fn entity(index: &Index, key: &str) -> Resolution {
    let candidates = entity_resource_candidates(key);
    if candidates.is_empty() {
        return missing("非法生物标识");
    }
    let mut last_missing = missing("生物几何与皮肤不能唯一配对；需要Java渲染器绑定或专用适配器");
    for (ns, name) in candidates {
        let aliases = entity_name_aliases(&ns, &name);
        let prefix = format!("assets/{ns}/");
        let geometries: Vec<_> = index
            .assets
            .keys()
            .filter(|p| {
                p.starts_with(&format!("{prefix}geo/"))
                    && p.ends_with(".geo.json")
                    && aliases
                        .iter()
                        .any(|a| p.ends_with(&format!("/{a}.geo.json")))
            })
            .collect();
        let skins: Vec<_> = index
            .assets
            .keys()
            .filter(|p| {
                p.starts_with(&format!("{prefix}textures/entity/"))
                    && p.ends_with(".png")
                    && aliases.iter().any(|a| p.ends_with(&format!("/{a}.png")))
                    && !p.contains("overlay")
                    && !p.ends_with("_spawn.png")
            })
            .collect();
        let geometry_path =
            pick_entity_path(&geometries, &name).or_else(|| geometries.first().copied());
        let skin_path = pick_entity_path(&skins, &name)
            .or_else(|| skins.first().copied())
            .cloned()
            .or_else(|| find_skin_loose(index, &ns, &aliases));
        if geometry_path.is_none() {
            if let Some(skin) = skin_path.as_deref() {
                return texture_only_entity(
                    index,
                    skin,
                    "使用实体原始纹理作图标（无可用 Bedrock 几何）",
                );
            }
            last_missing =
                missing("未找到该生物的 Bedrock 几何或唯一实体纹理；Java 动态模型需要专用适配器");
            continue;
        }
        let (Some(geometry_path), Some(skin_path)) = (geometry_path, skin_path) else {
            last_missing = missing("生物几何存在但未找到对应皮肤");
            continue;
        };
        let Some(geometry) = json(index, geometry_path) else {
            last_missing = missing("生物几何JSON不可读");
            continue;
        };
        let Some(models) = geometry.get("minecraft:geometry").and_then(Value::as_array) else {
            last_missing = missing("非标准Bedrock几何格式");
            continue;
        };
        if models.len() != 1 {
            last_missing = missing("生物包含多种几何，需要明确渲染器绑定");
            continue;
        }
        let model = &models[0];
        let Some(bones) = model.get("bones").and_then(Value::as_array) else {
            last_missing = missing("生物几何无骨骼");
            continue;
        };
        if bones.len() > 512
            || bones
                .iter()
                .map(|b| b.get("cubes").and_then(Value::as_array).map_or(0, Vec::len))
                .sum::<usize>()
                > 2048
        {
            last_missing = missing("生物几何复杂度超限");
            continue;
        }
        let Some((bytes, source)) = read(index, &skin_path) else {
            last_missing = missing("生物皮肤不可读");
            continue;
        };
        let width = model
            .pointer("/description/texture_width")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let height = model
            .pointer("/description/texture_height")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if width == 0 || height == 0 || !png_is_valid(&bytes) {
            last_missing = missing("生物材质尺寸或PNG无效");
            continue;
        }
        return Resolution {
            image: None,
            source: format!("{source} · {geometry_path}"),
            reason: "自动配对同标识生物几何和原始皮肤（静态姿态）".into(),
            job: Some(
                serde_json::json!({"entityModel":{"format":"bedrock","textureWidth":width,"textureHeight":height,"bones":bones},"layers":[format!("data:image/png;base64,{}", STANDARD.encode(bytes))]}),
            ),
        };
    }
    last_missing
}

fn resolve(index: &Index, key: &str, category: &str) -> Resolution {
    if is_entity_stat(category, key) {
        return entity(index, key);
    }
    let Some((ns, name)) = key.split_once(':') else {
        return missing("非资源统计键");
    };
    let mut id = format!("{ns}:item/{name}");
    if let Some(def) = asset_path(key, "items", "json").and_then(|p| json(index, &p)) {
        if let Some(reference) = def.pointer("/model/model").and_then(Value::as_str) {
            id = reference.into();
        } else {
            return missing("新版复合物品定义需要专用适配器");
        }
    }
    let mut path = match asset_path(&id, "models", "json") {
        Some(p) => p,
        None => return missing("非法资源标识"),
    };
    if !index.assets.contains_key(&path) {
        let block_id = format!("{ns}:block/{name}");
        if let Some(block_path) =
            asset_path(&block_id, "models", "json").filter(|p| index.assets.contains_key(p))
        {
            id = block_id;
            path = block_path;
        }
    }
    let texture = if index.assets.contains_key(&path) {
        let value = match model(index, &id, &mut Vec::new()) {
            Ok(v) => v,
            Err(e) => return missing(e),
        };
        if let Some(elements) = value.get("elements").and_then(Value::as_array) {
            if elements.len() > 512 || elements.is_empty() {
                return missing("模型元素数超限或为空");
            }
            let mut textures = serde_json::Map::new();
            for element in elements {
                if let Some(faces) = element.get("faces").and_then(Value::as_object) {
                    for face in faces.values() {
                        if face
                            .get("tintindex")
                            .and_then(Value::as_i64)
                            .is_some_and(|v| v >= 0)
                        {
                            return missing("模型需要游戏运行时染色");
                        }
                        let Some(reference) = face.get("texture").and_then(Value::as_str) else {
                            return missing("模型面缺少材质");
                        };
                        let Some(data) =
                            texture_id(&value, reference).and_then(|id| texture_data(index, &id))
                        else {
                            return missing("模型材质缺失、循环或含动画");
                        };
                        textures.insert(reference.into(), Value::String(data));
                    }
                }
            }
            return Resolution {
                image: None,
                source: read(index, &path).map(|r| r.1).unwrap_or_default(),
                reason: "自动解析本地立体模型".into(),
                job: Some(
                    serde_json::json!({"elements":elements,"textures":textures,"display":value.pointer("/display/gui")}),
                ),
            };
        }
        let textures = value.get("textures").and_then(Value::as_object);
        if textures.is_some_and(|t| t.contains_key("layer1")) {
            let mut layers = Vec::new();
            for n in 0..8 {
                let reference = format!("#layer{n}");
                if textures.and_then(|t| t.get(&format!("layer{n}"))).is_none() {
                    break;
                }
                let Some(data) =
                    texture_id(&value, &reference).and_then(|id| texture_data(index, &id))
                else {
                    return missing("多层物品存在缺失或动画材质");
                };
                layers.push(data);
            }
            return Resolution {
                image: None,
                source: read(index, &path).map(|r| r.1).unwrap_or_default(),
                reason: "自动合成原始多层物品材质".into(),
                job: Some(serde_json::json!({"layers":layers})),
            };
        }
        let Some(mut reference) = textures
            .and_then(|t| t.get("layer0"))
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return missing("模型未提供物品材质");
        };
        let mut seen = Vec::new();
        while let Some(alias) = reference.strip_prefix('#') {
            if seen.contains(&reference) || seen.len() >= 24 {
                return missing("材质引用循环");
            }
            seen.push(reference.clone());
            let Some(next) = textures.and_then(|t| t.get(alias)).and_then(Value::as_str) else {
                return missing("材质引用缺失");
            };
            reference = next.into();
        }
        asset_path(&reference, "textures", "png")
    } else {
        asset_path(&format!("{ns}:item/{name}"), "textures", "png")
    };
    let Some(path) = texture else {
        return missing("非法材质标识");
    };
    if index.assets.contains_key(&format!("{path}.mcmeta")) {
        if let Some(resolution) = animated_texture_job(index, &path) {
            return resolution;
        }
        return missing("动画材质无法提取首帧，保留已有图标");
    }
    let Some((bytes, source)) = read(index, &path) else {
        return missing("未找到同标识物品材质；可能由Java动态生成");
    };
    if !png_is_valid(&bytes) {
        return missing("材质不是有效PNG");
    }
    Resolution {
        image: Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes))),
        source,
        reason: "自动发现本地原始材质".into(),
        job: None,
    }
}

fn store_resolution_image(dir: &Path, key: &str, answer: &Resolution) {
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

#[derive(Deserialize)]
pub struct StoreIconRequest {
    pub cache_key: String,
    pub png: String,
    pub width: u32,
    pub height: u32,
    pub kind: String,
    pub source: String,
    pub reason: String,
}

#[tauri::command]
pub async fn store_stat_icon(
    cache_state: tauri::State<'_, IconCacheDir>,
    request: StoreIconRequest,
) -> Result<bool, String> {
    let Some(dir) = cache_state.get() else {
        return Ok(false);
    };
    let Some(bytes) = data_url_png(&request.png).or_else(|| STANDARD.decode(&request.png).ok())
    else {
        return Err("图标不是有效的PNG base64".into());
    };
    if bytes.len() as u64 > 2 * 1024 * 1024 {
        return Err("图标过大".into());
    }
    let Some((width, height)) = png_size(&bytes) else {
        return Err("图标不是有效PNG".into());
    };
    if request.width != width || request.height != height {
        return Err("图标尺寸与像素不一致".into());
    }
    let kind = if request.kind.is_empty() {
        "item".to_string()
    } else {
        request.kind
    };
    Ok(write_icon_cache(
        &dir,
        &request.cache_key,
        &bytes,
        (width, height),
        &kind,
        &request.source,
        &request.reason,
    ))
}

fn lookup_icon_cache_only(
    dir: Option<&Path>,
    category: &str,
    key: &str,
    roots: &[String],
    signatures: &mut HashMap<String, String>,
) -> Resolution {
    let Some(dir) = dir else {
        return missing("缓存目录不可用；可手动检查本机实例");
    };
    for root in roots {
        if !Path::new(root).is_absolute() {
            continue;
        }
        let signature = signatures
            .entry(root.clone())
            .or_insert_with(|| resource_signature(Path::new(root)));
        let key_hash = cache_key(root, signature, category, key);
        if let Some(hit) = read_icon_cache(dir, &key_hash) {
            return hit;
        }
    }
    missing("缓存未命中，可手动检查本机实例")
}

#[tauri::command]
pub async fn resolve_stat_icons(
    cache_state: tauri::State<'_, IconCacheDir>,
    args: ResolveStatIconsArgs,
) -> Result<BTreeMap<String, Resolution>, String> {
    let ResolveStatIconsArgs {
        requests,
        cache_only,
    } = args;
    if requests.len() > 100
        || requests
            .iter()
            .any(|r| r.roots.len() > 128 || r.key.len() > 512)
    {
        return Err("资源请求超过上限".into());
    }
    let cache_dir = cache_state.get();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = BTreeMap::new();
        if cache_only {
            let mut signatures: HashMap<String, String> = HashMap::new();
            for request in requests {
                let identity = format!("{}:{}", request.category, request.key);
                let answer = lookup_icon_cache_only(
                    cache_dir.as_deref(),
                    &request.category,
                    &request.key,
                    &request.roots,
                    &mut signatures,
                );
                result.insert(identity, answer);
            }
            return Ok(result);
        }
        let mut cache = CACHE
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "资源缓存锁失败")?;
        let mut grouped: BTreeMap<String, Vec<(String, String, String)>> = BTreeMap::new();
        for request in requests {
            let identity = format!("{}:{}", request.category, request.key);
            result.insert(identity.clone(), missing("没有可读取的来源实例"));
            for root in request.roots {
                if !Path::new(&root).is_absolute() {
                    continue;
                }
                grouped.entry(root).or_default().push((
                    identity.clone(),
                    request.key.clone(),
                    request.category.clone(),
                ));
            }
        }
        for (root, requests) in grouped {
            if requests.iter().all(|(id, _, _)| {
                result
                    .get(id)
                    .is_some_and(|a| a.image.is_some() || a.job.is_some())
            }) {
                continue;
            }
            if !cache
                .get(&root)
                .is_some_and(|i| i.checked.elapsed() < Duration::from_secs(30))
            {
                let previous = cache.remove(&root);
                if cache.len() >= 4 {
                    cache.clear();
                }
                cache.insert(root.clone(), indexed(Path::new(&root), previous));
            }
            let Some(index) = cache.get_mut(&root) else {
                continue;
            };
            for (identity, key, category) in requests {
                if result
                    .get(&identity)
                    .is_some_and(|a| a.image.is_some() || a.job.is_some())
                {
                    continue;
                }
                let key_hash = cache_key(&root, &index.signature, &category, &key);
                if let Some(dir) = cache_dir.as_ref() {
                    if let Some(hit) = read_icon_cache(dir, &key_hash) {
                        index.answers.insert(identity.clone(), hit.clone());
                        result.insert(identity, hit);
                        continue;
                    }
                }
                let answer = index
                    .answers
                    .get(&identity)
                    .cloned()
                    .unwrap_or_else(|| resolve(index, &key, &category));
                let answer = attach_job_meta(answer, &key_hash, &root);
                if let Some(dir) = cache_dir.as_ref() {
                    store_resolution_image(dir, &key_hash, &answer);
                }
                if index.answers.len() >= 100 {
                    index.answers.clear();
                }
                index.answers.insert(identity.clone(), answer.clone());
                result.insert(identity, answer);
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resource_pack_priority_corrupt_jar_and_new_mod_invalidation() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(root.join("resourcepacks")).unwrap();
        fs::write(root.join("mods/broken.jar"), b"not a zip").unwrap();
        let write_pack = |path: &Path, marker: u8| {
            let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
            zip.start_file(
                "assets/example/textures/item/test.png",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            zip.write_all(&[b"\x89PNG\r\n\x1a\n".as_slice(), &[marker]].concat())
                .unwrap();
            zip.finish().unwrap();
        };
        write_pack(&root.join("mods/example.jar"), 1);
        let index = indexed(root, None);
        let first = resolve(&index, "example:test", "minecraft:used");
        assert!(first.source.contains("example.jar"));
        write_pack(&root.join("resourcepacks/override.zip"), 2);
        fs::write(
            root.join("options.txt"),
            "resourcePacks:[\"vanilla\",\"file/override.zip\"]",
        )
        .unwrap();
        let index = indexed(root, Some(index));
        let second = resolve(&index, "example:test", "minecraft:used");
        assert!(second.source.contains("override.zip"));
        assert_ne!(first.image, second.image);
        fs::write(root.join("options.txt"), "resourcePacks:[\"vanilla\"]").unwrap();
        let index = indexed(root, Some(index));
        assert_eq!(
            resolve(&index, "example:test", "minecraft:used").image,
            first.image
        );
    }
    #[test]
    #[ignore = "Read-only audit of installed mod packs; requires local audit fixtures"]
    fn audit_installed_missing_resources() {
        let audit: Value =
            serde_json::from_slice(&fs::read("../.local/stat-resource-audit.json").unwrap())
                .unwrap();
        let requests: Value = serde_json::from_slice(
            &fs::read("../.local/coverage-after-0107-requests.json").unwrap(),
        )
        .unwrap();
        let mut results = Vec::new();
        for root in audit["roots"].as_array().unwrap() {
            let index = indexed(Path::new(root["path"].as_str().unwrap()), None);
            for request in requests
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["root"] == root["id"])
            {
                let answer = resolve(
                    &index,
                    request["key"].as_str().unwrap(),
                    request["category"].as_str().unwrap(),
                );
                results.push(serde_json::json!({"root":root["id"],"key":request["key"],"category":request["category"],"resolved":answer.image.is_some() || answer.job.is_some(),"source":answer.source,"reason":answer.reason}));
            }
        }
        fs::write(
            "../.local/runtime-resource-audit-0108.json",
            serde_json::to_vec_pretty(&results).unwrap(),
        )
        .unwrap();
        println!(
            "Resolved {} / {} previously missing requests",
            results.iter().filter(|r| r["resolved"] == true).count(),
            results.len()
        );
    }
    #[test]
    fn inherited_texture_alias_and_cycle_are_handled() {
        let dir = std::env::temp_dir().join(format!("mc-resources-{}", std::process::id()));
        fs::create_dir_all(dir.join("kubejs/assets/example/models/item")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/example/textures/item")).unwrap();
        fs::write(dir.join("kubejs/assets/example/models/item/parent.json"), r##"{"parent":"minecraft:item/generated","textures":{"layer0":"#base","base":"example:item/actual"}}"##).unwrap();
        fs::write(
            dir.join("kubejs/assets/example/models/item/test.json"),
            r#"{"parent":"example:item/parent"}"#,
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/example/textures/item/actual.png"),
            b"\x89PNG\r\n\x1a\n",
        )
        .unwrap();
        let index = indexed(&dir, None);
        assert!(resolve(&index, "example:test", "minecraft:used")
            .image
            .is_some());
        fs::write(
            dir.join("kubejs/assets/example/models/item/parent.json"),
            r#"{"parent":"example:item/test"}"#,
        )
        .unwrap();
        let index = indexed(&dir, Some(index));
        assert!(resolve(&index, "example:test", "minecraft:used")
            .reason
            .contains("循环"));
        assert!(resolve(&index, "example:test", "minecraft:killed")
            .image
            .is_none());
        assert!(asset_path("test:../../secret", "textures", "png").is_none());
    }

    fn minimal_png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes
    }

    #[test]
    fn icon_cache_roundtrip_and_invalidations() {
        let dir = tempfile::tempdir().unwrap();
        let key = cache_key("/root", "sig", "minecraft:used", "example:test");
        assert!(is_cache_key(&key));
        let png = minimal_png(16, 16);
        assert!(write_icon_cache(
            dir.path(),
            &key,
            &png,
            (16, 16),
            "item",
            "jar · path",
            "自动发现"
        ));
        let hit = read_icon_cache(dir.path(), &key).unwrap();
        assert!(hit
            .image
            .as_deref()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(hit.reason, "本地缓存图标");
        assert!(!write_icon_cache(
            dir.path(),
            "not-a-key",
            &png,
            (16, 16),
            "item",
            "s",
            "r"
        ));
        assert!(!write_icon_cache(
            dir.path(),
            &key,
            b"nope",
            (16, 16),
            "item",
            "s",
            "r"
        ));
        let other = cache_key("/root", "sig2", "minecraft:used", "example:test");
        assert_ne!(key, other);
        assert!(read_icon_cache(dir.path(), &other).is_none());
    }

    #[test]
    fn cache_only_hits_disk_without_jobs_and_misses_cleanly() {
        let game = tempfile::tempdir().unwrap();
        let root = game.path().join("instance");
        fs::create_dir_all(root.join("mods")).unwrap();
        let cache = tempfile::tempdir().unwrap();
        let signature = resource_signature(&root);
        let key = cache_key(
            &root.to_string_lossy(),
            &signature,
            "minecraft:used",
            "example:cached",
        );
        assert!(write_icon_cache(
            cache.path(),
            &key,
            &minimal_png(16, 16),
            (16, 16),
            "item",
            "jar",
            "自动发现"
        ));
        let hit = lookup_icon_cache_only(
            Some(cache.path()),
            "minecraft:used",
            "example:cached",
            &[root.to_string_lossy().to_string()],
            &mut HashMap::new(),
        );
        assert!(hit.image.is_some());
        assert!(hit.job.is_none());
        assert_eq!(hit.reason, "本地缓存图标");
        let miss = lookup_icon_cache_only(
            Some(cache.path()),
            "minecraft:used",
            "example:not_cached",
            &[root.to_string_lossy().to_string()],
            &mut HashMap::new(),
        );
        assert!(miss.image.is_none());
        assert!(miss.job.is_none());
        assert!(miss.reason.contains("缓存未命中"));
    }

    #[test]
    fn animated_texture_produces_frame_job() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("mc-anim");
        fs::create_dir_all(dir.join("kubejs/assets/example/textures/item")).unwrap();
        fs::write(
            dir.join("kubejs/assets/example/textures/item/spin.png"),
            minimal_png(16, 48),
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/example/textures/item/spin.png.mcmeta"),
            r#"{"animation":{"frame_height":16}}"#,
        )
        .unwrap();
        let index = indexed(&dir, None);
        let answer = resolve(&index, "example:spin", "minecraft:used");
        let job = answer.job.expect("animated job");
        assert_eq!(job.get("kind").and_then(Value::as_str), Some("frame"));
        assert_eq!(job.get("frameHeight").and_then(Value::as_u64), Some(16));
    }

    #[test]
    fn block_model_is_used_when_item_model_is_missing() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("mc-block");
        fs::create_dir_all(dir.join("kubejs/assets/example/models/block")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/example/textures/block")).unwrap();
        fs::write(
            dir.join("kubejs/assets/example/models/block/ore.json"),
            r##"{"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{"north":{"texture":"#all","uv":[0,0,16,16]}}}],"textures":{"all":"example:block/ore"}}"##,
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/example/textures/block/ore.png"),
            minimal_png(16, 16),
        )
        .unwrap();
        let index = indexed(&dir, None);
        let answer = resolve(&index, "example:ore", "minecraft:mined");
        assert!(answer.image.is_some() || answer.job.is_some());
        assert!(!answer.reason.contains("未找到同标识物品材质"));
    }

    #[test]
    fn entity_prefers_geo_entity_path() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("mc-entity");
        fs::create_dir_all(dir.join("kubejs/assets/example/geo")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/example/geo/entity")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/example/textures/entity")).unwrap();
        let geometry = r#"{"minecraft:geometry":[{"description":{"identifier":"geometry.foo","texture_width":64,"texture_height":32},"bones":[{"name":"body","cubes":[{"origin":[-4,0,-4],"size":[8,8,8],"uv":[0,0]}]}]}]}"#;
        fs::write(dir.join("kubejs/assets/example/geo/foo.geo.json"), geometry).unwrap();
        fs::write(
            dir.join("kubejs/assets/example/geo/entity/foo.geo.json"),
            geometry,
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/example/textures/entity/foo.png"),
            minimal_png(64, 32),
        )
        .unwrap();
        let index = indexed(&dir, None);
        let answer = resolve(&index, "example:foo", "minecraft:killed");
        let job = answer.job.expect("entity job");
        assert!(answer.source.contains("geo/entity/foo.geo.json"));
        assert!(job.get("entityModel").is_some());
    }

    #[test]
    fn legacy_entity_keys_and_texture_aliases_resolve() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("mc-legacy-entity");
        fs::create_dir_all(dir.join("kubejs/assets/specialmobs/textures/entity")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/draconicevolution/textures/entity")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/goety/textures/entity")).unwrap();
        fs::write(
            dir.join("kubejs/assets/specialmobs/textures/entity/PoisonSpider.png"),
            minimal_png(64, 32),
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/draconicevolution/textures/entity/chaos_guardian.png"),
            minimal_png(256, 256),
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/goety/textures/entity/apostle.png"),
            minimal_png(128, 128),
        )
        .unwrap();
        let index = indexed(&dir, None);
        let legacy = resolve(
            &index,
            "stat.entityKilledBy.SpecialMobs.PoisonSpider",
            "legacy",
        );
        assert!(
            legacy.image.is_some() || legacy.job.is_some(),
            "legacy poison spider: {}",
            legacy.reason
        );
        let guardian = resolve(
            &index,
            "draconicevolution:draconic_guardian",
            "minecraft:killed_by",
        );
        assert!(
            guardian.image.is_some() || guardian.job.is_some(),
            "draconic guardian: {}",
            guardian.reason
        );
        assert!(guardian.source.contains("chaos_guardian"));
        let apostle = resolve(&index, "goety:apostle", "minecraft:killed");
        assert!(
            apostle.image.is_some() || apostle.job.is_some(),
            "apostle: {}",
            apostle.reason
        );
        if let Some(job) = &apostle.job {
            assert!(job.get("entityModel").is_some());
        }
        if let Some(job) = &legacy.job {
            assert!(job.get("entityModel").is_some());
        }
        assert!(is_entity_stat("legacy", "stat.killEntity.Zombie"));
        assert!(!is_entity_stat("legacy", "stat.mineBlock.1"));
        assert_eq!(snake_case("PoisonSpider"), "poison_spider");
    }
}
