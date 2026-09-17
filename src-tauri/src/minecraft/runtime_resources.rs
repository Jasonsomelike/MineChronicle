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
    /// jar path → filtered `*Model*.class` entry names (avoids rescanning every entity).
    model_class_files: Mutex<HashMap<PathBuf, Vec<String>>>,
    /// Budget for expensive Java bytecode extraction per index generation.
    java_attempts: std::sync::atomic::AtomicUsize,
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

/// Stable across restarts: do NOT mix resource_signature (mtimes) into the key.
/// Pipeline format version lives in the suffix; invalidate by bumping it.
fn cache_key(root: &str, _signature: &str, category: &str, key: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(root.as_bytes());
    hasher.update(b"\0");
    hasher.update(category.as_bytes());
    hasher.update(b"\0");
    hasher.update(key.as_bytes());
    hasher.update(b"\0stable-v13");
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
/// Takes the already-resolved source list so callers that also need it do not
/// walk the directory twice (the walk itself measured ~0.23 ms per build; the
/// stat pass below dominates at ~29 ms for a 300-jar instance).
fn resource_signature(paths: &[PathBuf]) -> String {
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

fn indexed(root: &Path, previous: Option<Index>) -> Index {
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
        names.push(snake.clone());
    }
    let lower = name.to_ascii_lowercase();
    if !names.contains(&lower) {
        names.push(lower.clone());
    }
    // Underscore-stripped (terrible_ten → terribleten)
    let compact = lower.replace('_', "");
    if !names.contains(&compact) {
        names.push(compact);
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
        ("iceandfire", "fire_dragon") | ("iceandfire", "firedragon") => {
            names.push("firedragon".into());
            names.push("dragon_fire".into());
            // Shared dragon body model in the mod.
            names.push("DragonBase".into());
        }
        ("iceandfire", "ice_dragon") | ("iceandfire", "icedragon") => {
            names.push("icedragon".into());
            names.push("dragon_ice".into());
            names.push("DragonBase".into());
        }
        ("iceandfire", "lightning_dragon") => {
            names.push("lightningdragon".into());
            names.push("DragonBase".into());
        }
        ("iceandfire", "deathworm") => {
            names.push("death_worm".into());
            names.push("DeathWorm".into());
        }
        ("iceandfire", "sea_serpent") => {
            names.push("SeaSerpent".into());
        }
        ("cataclysm", "ignis") => {
            names.push("ignis_idle_0".into());
        }
        ("cataclysm", "maledictus") => {
            names.push("maledictus_ghost".into());
        }
        ("specialmobs", _) if name.eq_ignore_ascii_case("PoisonSpider") => {
            names.push("poisonspider".into());
            names.push("poison".into());
        }
        _ if name.eq_ignore_ascii_case("PoisonSpider") => {
            names.push("poisonspider".into());
            names.push("poison".into());
        }
        _ => {}
    }
    names.dedup();
    names
}

fn skip_entity_asset(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains("/banner/")
        || lower.contains("/shield/")
        || lower.contains("/chest/")
        || lower.contains("dragon_armor")
        || lower.contains("overlay")
        || lower.ends_with("_spawn.png")
        || lower.ends_with("_egg.png")
        || lower.ends_with("_eyes.png")
        || lower.ends_with("_sleeping.png")
        || lower.ends_with("_breath.png")
        || lower.contains("_skeleton")
}

fn find_skin_folder_sample(index: &Index, ns: &str, aliases: &[String]) -> Option<String> {
    let prefix = format!("assets/{ns}/textures/entity/");
    for alias in aliases {
        let folder = format!("{prefix}{alias}/");
        let mut hits: Vec<&String> = index
            .assets
            .keys()
            .filter(|p| p.starts_with(&folder) && p.ends_with(".png") && !skip_entity_asset(p))
            .collect();
        hits.sort_by_key(|p| {
            let file = p.rsplit('/').next().unwrap_or("");
            let score = if file.contains("idle_0") || file.ends_with("_1.png") {
                0u8
            } else if file.ends_with("_0.png") {
                1
            } else {
                2
            };
            (score, (*p).clone())
        });
        if let Some(first) = hits.first() {
            return Some((*first).clone());
        }
    }
    None
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

/// Vanilla-compatible skins only. Custom Java-model UVs cannot be mapped safely.
fn vanilla_template_model(ns: &str, name: &str, width: u32, height: u32) -> Option<Value> {
    let _ = ns;
    let name = name.to_ascii_lowercase();
    let spider = name.contains("spider");
    let biped = matches!(
        name.as_str(),
        "zombie"
            | "skeleton"
            | "creeper"
            | "enderman"
            | "witch"
            | "villager"
            | "zombie_villager"
            | "husk"
            | "drowned"
            | "stray"
            | "bogged"
            | "wither_skeleton"
            | "piglin"
            | "piglin_brute"
            | "zombified_piglin"
            | "pillager"
            | "vindicator"
            | "vex"
            | "evoker"
            | "illusioner"
            | "warden"
    ) || name.contains("poisonspider")
        || name.contains("poison_spider")
        || name.ends_with("spider");
    let quad = matches!(
        name.as_str(),
        "pig" | "cow" | "sheep" | "wolf" | "cat" | "ocelot" | "horse" | "donkey" | "mule"
    ) || name.contains("bear")
        || name.contains("tusklin");
    let slime = name.contains("slime") || name.contains("magma");
    let bones = if spider && width == 64 && height == 32 {
        // Minecraft ModelSpider (Java) — proper leg pivots and Y rotations.
        // ModelSpider authors these as Java float literals: legs splay at
        // ±22.5° (inner) / ±45° (outer) and the rear segment pitches -45°.
        // Use the f32 constants so the values match the game's own floats.
        const LEG_YAW: f32 = std::f32::consts::FRAC_PI_4;
        const LEG_YAW_INNER: f32 = std::f32::consts::FRAC_PI_8;
        const REAR_PITCH: f32 = -std::f32::consts::FRAC_PI_4;
        let mut bones_json = serde_json::json!([
            {"name":"head","pivot":[0,15,-3],"rotation":[0.0,0.0,0.0],"cubes":[{"origin":[-4,-4,-8],"size":[8,8,8],"uv":[32,4]}]},
            {"name":"body","pivot":[0,15,0],"rotation":[0.0,0.0,0.0],"cubes":[{"origin":[-3,-3,-3],"size":[6,6,6],"uv":[0,0]}]},
            {"name":"rear","pivot":[0,15,9],"rotation":[REAR_PITCH,0.0,0.0],"cubes":[{"origin":[-5,-4,-6],"size":[10,8,12],"uv":[0,12]}]}
        ]);
        if let Some(arr) = bones_json.as_array_mut() {
            let legs: [[f32; 4]; 8] = [
                [-4.0, 15.0, 2.0, LEG_YAW],
                [4.0, 15.0, 2.0, -LEG_YAW],
                [-4.0, 15.0, 1.0, LEG_YAW_INNER],
                [4.0, 15.0, 1.0, -LEG_YAW_INNER],
                [-4.0, 15.0, 0.0, -LEG_YAW_INNER],
                [4.0, 15.0, 0.0, LEG_YAW_INNER],
                [-4.0, 15.0, -1.0, -LEG_YAW],
                [4.0, 15.0, -1.0, LEG_YAW],
            ];
            for (i, leg) in legs.iter().enumerate() {
                arr.push(serde_json::json!({
                    "name": format!("leg{i}"),
                    "pivot": [leg[0], leg[1], leg[2]],
                    "rotation": [0.0, leg[3], 0.0],
                    "cubes": [{"origin":[-15,-1,-1],"size":[16,2,2],"uv":[18,0]}]
                }));
            }
        }
        bones_json
    } else if biped && width == 64 && (height == 64 || height == 32) {
        serde_json::json!([
            {"name":"head","pivot":[0,24,0],"cubes":[{"origin":[-4,24,-4],"size":[8,8,8],"uv":[0,0]}]},
            {"name":"body","pivot":[0,24,0],"cubes":[{"origin":[-4,12,-2],"size":[8,12,4],"uv":[16,16]}]},
            {"name":"rightarm","pivot":[-5,22,0],"cubes":[{"origin":[-8,12,-2],"size":[4,12,4],"uv":[40,16]}]},
            {"name":"leftarm","pivot":[5,22,0],"cubes":[{"origin":[4,12,-2],"size":[4,12,4],"uv":[32,48]}]},
            {"name":"rightleg","pivot":[-1.9,12,0],"cubes":[{"origin":[-3.9,0,-2],"size":[4,12,4],"uv":[0,16]}]},
            {"name":"leftleg","pivot":[1.9,12,0],"cubes":[{"origin":[-0.1,0,-2],"size":[4,12,4],"uv":[16,48]}]}
        ])
    } else if quad && width == 64 && height == 32 {
        serde_json::json!([
            {"name":"head","pivot":[0,12,-6],"cubes":[{"origin":[-4,16,-14],"size":[8,8,6],"uv":[0,0]}]},
            {"name":"body","pivot":[0,12,0],"rotation":[-90,0,0],"cubes":[{"origin":[-5,10,-7],"size":[10,16,8],"uv":[28,8]}]},
            {"name":"leg0","pivot":[-3,12,7],"cubes":[{"origin":[-5,0,5],"size":[4,12,4],"uv":[0,16]}]},
            {"name":"leg1","pivot":[3,12,7],"cubes":[{"origin":[1,0,5],"size":[4,12,4],"uv":[0,16]}]},
            {"name":"leg2","pivot":[-3,12,-5],"cubes":[{"origin":[-5,0,-7],"size":[4,12,4],"uv":[0,16]}]},
            {"name":"leg3","pivot":[3,12,-5],"cubes":[{"origin":[1,0,-7],"size":[4,12,4],"uv":[0,16]}]}
        ])
    } else if slime && width >= 64 && height >= 32 {
        serde_json::json!([
            {"name":"cube","pivot":[0,0,0],"cubes":[{"origin":[-4,0,-4],"size":[8,8,8],"uv":[0,16]}]}
        ])
    } else {
        return None;
    };
    Some(serde_json::json!({
        // Java convention matches the renderer path used by extracted Java models.
        "format": "java",
        "textureWidth": width,
        "textureHeight": height,
        "bones": bones
    }))
}

fn vanilla_extra_skin_paths(ns: &str, name: &str) -> Vec<String> {
    let n = name.to_ascii_lowercase();
    match (ns, n.as_str()) {
        ("minecraft", "ender_dragon") | ("minecraft", "dragon") => {
            vec!["assets/minecraft/textures/entity/enderdragon/dragon.png".into()]
        }
        ("minecraft", "magma_cube") | ("minecraft", "magmacube") => {
            vec!["assets/minecraft/textures/entity/slime/magmacube.png".into()]
        }
        ("minecraft", "cave_spider") => {
            vec!["assets/minecraft/textures/entity/spider/cave_spider.png".into()]
        }
        ("iceandfire", "cyclops") => {
            vec!["assets/iceandfire/textures/models/cyclops/cyclops_0.png".into()]
        }
        ("iceandfire", "deathworm") => {
            vec![
                "assets/iceandfire/textures/models/deathworm/deathworm_white.png".into(),
                "assets/iceandfire/textures/models/deathworm/deathworm_red.png".into(),
            ]
        }
        ("iceandfire", "ghost") => {
            vec!["assets/iceandfire/textures/models/ghost/ghost_white.png".into()]
        }
        _ => vec![],
    }
}

fn texture_only_entity(
    index: &Index,
    skin_path: &str,
    ns: &str,
    name: &str,
    reason: &str,
) -> Resolution {
    let Some((bytes, source)) = read(index, skin_path) else {
        return missing("实体纹理不可读");
    };
    let Some((width, height)) = png_size(&bytes) else {
        return missing("实体纹理不是有效PNG");
    };
    if let Some(model) = vanilla_template_model(ns, name, width, height) {
        let n = name.to_ascii_lowercase();
        // Spiders read better from a low side-front angle.
        let rotation = if n.contains("spider") {
            serde_json::json!([8, 200, 0])
        } else {
            serde_json::json!([15, 155, 0])
        };
        return Resolution {
            image: None,
            source,
            reason: format!("{reason}；用原版模板立体渲染"),
            job: Some(serde_json::json!({
                "entityModel": model,
                "layers": [format!("data:image/png;base64,{}", STANDARD.encode(bytes))],
                "rotation": rotation,
            })),
        };
    }
    // Custom UV skins (Alex's Mobs etc.) cannot be mapped safely — do not invent icons.
    missing("仅有 Java 模型或自定义 UV 皮肤，无法安全生成立体图标；需专用适配器")
}

fn pascal_case(name: &str) -> String {
    name.split(['_', '-', ' '])
        .filter(|p| !p.is_empty())
        .map(|p| {
            let mut c = p.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect()
}

fn class_super_name(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 10 || &bytes[0..4] != b"\xCA\xFE\xBA\xBE" {
        return None;
    }
    let cp_count = u16::from_be_bytes([bytes[8], bytes[9]]) as usize;
    let mut o = 10;
    let mut utf: HashMap<u16, String> = HashMap::new();
    let mut classes: HashMap<u16, u16> = HashMap::new();
    let mut i = 1usize;
    while i < cp_count && o < bytes.len() {
        let tag = bytes[o];
        o += 1;
        match tag {
            1 => {
                let len = u16::from_be_bytes([bytes[o], bytes[o + 1]]) as usize;
                o += 2;
                if o + len <= bytes.len() {
                    utf.insert(
                        i as u16,
                        String::from_utf8_lossy(&bytes[o..o + len]).into_owned(),
                    );
                }
                o += len;
            }
            3 | 4 => o += 4,
            5 | 6 => {
                o += 8;
                i += 1;
            }
            7 => {
                let idx = u16::from_be_bytes([bytes[o], bytes[o + 1]]);
                classes.insert(i as u16, idx);
                o += 2;
            }
            8 | 16 | 19 | 20 => o += 2,
            9 | 10 | 11 | 12 | 17 | 18 => o += 4,
            15 => o += 3,
            _ => return None,
        }
        i += 1;
    }
    if o + 6 > bytes.len() {
        return None;
    }
    let super_idx = u16::from_be_bytes([bytes[o + 4], bytes[o + 5]]);
    let utf_idx = classes.get(&super_idx)?;
    let name = utf.get(utf_idx)?;
    Some(name.replace('/', "."))
}

fn read_zip_entry(container: &Path, entry: &str) -> Option<Vec<u8>> {
    let file = fs::File::open(container).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let mut handle = zip.by_name(entry).ok()?;
    if handle.size() > 4 * 1024 * 1024 {
        return None;
    }
    let mut bytes = Vec::new();
    handle.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn zip_entry_names(container: &Path) -> Vec<String> {
    let Ok(file) = fs::File::open(container) else {
        return Vec::new();
    };
    let Ok(zip) = zip::ZipArchive::new(file) else {
        return Vec::new();
    };
    zip.file_names().map(str::to_owned).collect()
}

fn model_class_entries(index: &Index, container: &Path) -> Vec<String> {
    if let Ok(cache) = index.model_class_files.lock() {
        if let Some(listed) = cache.get(container) {
            return listed.clone();
        }
    }
    let names: Vec<String> = zip_entry_names(container)
        .into_iter()
        .filter(|n| {
            n.ends_with(".class") && !n.contains('$') && {
                let file = n.rsplit('/').next().unwrap_or("");
                file.contains("Model")
            }
        })
        .collect();
    if let Ok(mut cache) = index.model_class_files.lock() {
        if cache.len() < 64 {
            cache.insert(container.to_path_buf(), names.clone());
        }
    }
    names
}

fn find_java_model_class(index: &Index, ns: &str, aliases: &[String]) -> Option<(PathBuf, String)> {
    let pascals: Vec<String> = aliases.iter().map(|a| pascal_case(a)).collect();
    let mut containers: Vec<PathBuf> = index.assets.values().map(|a| a.container.clone()).collect();
    containers.sort();
    containers.dedup();
    // Prefer jars that actually ship this namespace's assets.
    let ns_prefix = format!("assets/{ns}/");
    let mut preferred: Vec<PathBuf> = Vec::new();
    let mut rest: Vec<PathBuf> = Vec::new();
    for container in containers {
        if container.extension().is_none_or(|e| e != "jar") {
            continue;
        }
        let has_ns = index
            .assets
            .iter()
            .any(|(path, asset)| path.starts_with(&ns_prefix) && asset.container == container);
        if has_ns {
            preferred.push(container);
        } else {
            rest.push(container);
        }
    }
    for container in preferred.iter().chain(rest.iter()) {
        let names = model_class_entries(index, container);
        let hits: Vec<String> = names
            .iter()
            .filter(|n| {
                let file = n.rsplit('/').next().unwrap_or("");
                if file.contains("Layer") || file.contains("Armor") {
                    return false;
                }
                pascals.iter().any(|p| {
                    file == format!("Model{p}.class")
                        || file == format!("{p}Model.class")
                        || file == format!("Model{p}EntityModel.class")
                })
            })
            .cloned()
            .collect();
        // Prefer exact Model{Pascal} / {Pascal}Model over longer aliases.
        let mut ranked: Vec<(u8, String)> = hits
            .into_iter()
            .map(|h| {
                let file = h.rsplit('/').next().unwrap_or("").to_string();
                let rank = pascals
                    .iter()
                    .map(|p| {
                        if file == format!("Model{p}.class") || file == format!("{p}Model.class") {
                            0u8
                        } else {
                            1
                        }
                    })
                    .min()
                    .unwrap_or(2);
                (rank, h)
            })
            .collect();
        ranked.sort();
        if let Some((_, entry)) = ranked.first() {
            let class_name = entry.trim_end_matches(".class").replace('/', ".");
            return Some((container.clone(), class_name));
        }
    }
    None
}

fn collect_java_class_map(
    primary_jar: &Path,
    class_name: &str,
    index: &Index,
) -> HashMap<String, Vec<u8>> {
    let mut map = HashMap::new();
    let mut queue = vec![class_name.to_string()];
    let mut containers: Vec<PathBuf> = index.assets.values().map(|a| a.container.clone()).collect();
    if !containers.contains(&primary_jar.to_path_buf()) {
        containers.push(primary_jar.to_path_buf());
    }
    containers.sort();
    containers.dedup();
    while let Some(name) = queue.pop() {
        if map.contains_key(&name) || map.len() >= 12 {
            continue;
        }
        let entry = format!("{}.class", name.replace('.', "/"));
        let mut bytes = None;
        for jar in &containers {
            if let Some(b) = read_zip_entry(jar, &entry) {
                bytes = Some(b);
                break;
            }
        }
        let Some(bytes) = bytes else { continue };
        if let Some(parent) = class_super_name(&bytes) {
            if parent != "java.lang.Object"
                && !parent.ends_with(".EntityModel")
                && !parent.ends_with(".AdvancedEntityModel")
                && !parent.ends_with(".ListModel")
            {
                queue.push(parent);
            }
        }
        map.insert(name, bytes);
    }
    map
}

fn java_model_resolution(
    index: &Index,
    ns: &str,
    aliases: &[String],
    skin: &str,
) -> Option<Resolution> {
    // Cap expensive bytecode work so one scan cannot hang the UI.
    // Reset per resolve_stat_icons batch; a full page needs far more than a dozen.
    const MAX_JAVA_ATTEMPTS: usize = 256;
    if index
        .java_attempts
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        >= MAX_JAVA_ATTEMPTS
    {
        return None;
    }
    let (jar, class_name) = find_java_model_class(index, ns, aliases)?;
    let mut classes = collect_java_class_map(&jar, &class_name, index);
    if !classes.contains_key(&class_name) {
        return None;
    }
    // GeckoLib models keep geometry in .geo.json, not constructors — skip.
    if classes.values().any(|bytes| {
        class_super_name(bytes)
            .map(|s| s.to_ascii_lowercase().contains("geckolib"))
            .unwrap_or(false)
            || String::from_utf8_lossy(bytes).contains("software/bernie/geckolib")
    }) {
        return None;
    }
    // Keep IPC payloads bounded.
    const MAX_CLASS_BYTES: usize = 1_500_000;
    let mut total = 0usize;
    classes.retain(|_, bytes| {
        total += bytes.len();
        total <= MAX_CLASS_BYTES
    });
    if !classes.contains_key(&class_name) {
        return None;
    }
    // Prefer texture path embedded in the model/render classes.
    let mut class_b64 = serde_json::Map::new();
    let mut hinted_skin: Option<String> = None;
    let hint_name = aliases.first().map(String::as_str).unwrap_or("");
    for (name, bytes) in &classes {
        class_b64.insert(name.clone(), Value::String(STANDARD.encode(bytes)));
        if hinted_skin.is_none() {
            if let Some(path) = class_texture_hint(bytes, hint_name) {
                // path like textures/entity/spider/spider.png → asset key
                let asset = format!("assets/{}", path.trim_start_matches('/'));
                // namespace from class package is unknown; try current skin's ns prefix
                if let Some(ns_root) = skin.split("/assets/").nth(1) {
                    let ns = ns_root.split('/').next().unwrap_or("minecraft");
                    let candidate = format!("assets/{ns}/{path}");
                    if index.assets.contains_key(&candidate) {
                        hinted_skin = Some(candidate);
                    }
                }
                if hinted_skin.is_none() {
                    let _ = asset;
                }
            }
        }
    }
    let skin_path = hinted_skin.unwrap_or_else(|| skin.to_string());
    let (bytes, source) = read(index, &skin_path)?;
    if !png_is_valid(&bytes) {
        return None;
    }
    let (tw, th) = png_size(&bytes)?;
    let render_size = tw.max(th).clamp(512, 2048);
    // Do not override model texWidth/texHeight with PNG size — Java UVs
    // are authored against the constructor's texOffs canvas, not the file.
    Some(Resolution {
        image: None,
        source: format!("{source} · {class_name}"),
        reason: "从本机 class 字节码提取 Java 实体模型并立体渲染".into(),
        job: Some(serde_json::json!({
            "javaModel": {
                "className": class_name,
                "classes": class_b64,
            },
            "layers": [format!("data:image/png;base64,{}", STANDARD.encode(bytes))],
            "renderSize": render_size,
        })),
    })
}

fn class_texture_hint(bytes: &[u8], name: &str) -> Option<String> {
    // Scan constant-pool-ish ASCII for textures/entity/...png and prefer
    // paths that match the entity name (avoid overlay/short generic hits).
    let text = String::from_utf8_lossy(bytes);
    let mut best: Option<(i32, String)> = None;
    let mut rest = text.as_ref();
    while let Some(pos) = rest.find("textures/entity/") {
        let tail = &rest[pos..];
        let end = tail
            .find(|c: char| !(c.is_ascii_alphanumeric() || "/._-".contains(c)))
            .unwrap_or(tail.len().min(180));
        let candidate = &tail[..end];
        if candidate.ends_with(".png") && !candidate.contains("overlay") {
            let score = score_skin_path(candidate, name);
            if score >= 8 && best.as_ref().is_none_or(|(s, _)| score > *s) {
                best = Some((score, candidate.to_string()));
            }
        }
        rest = &rest[pos + 8..];
    }
    best.map(|(_, p)| p)
}

fn score_skin_path(path: &str, name: &str) -> i32 {
    let p = path.to_ascii_lowercase().replace('\\', "/");
    let n = name.to_ascii_lowercase();
    let mut score = 0i32;
    let tokens: Vec<&str> = n.split(['_', '-']).filter(|t| t.len() >= 3).collect();
    for token in &tokens {
        if p.contains(&format!("/{token}/")) {
            score += 20;
        } else if p.contains(&format!("/{token}")) {
            score += 8;
        } else if p.contains(*token) {
            score += 2;
        }
    }
    // Cross-family penalties (e.g. silverfish/poison.png for a spider).
    let cross = [
        ("spider", "silverfish", -80),
        ("spider", "/creeper/", -40),
        ("zombie", "/skeleton/", -40),
        ("zombie", "/creeper/", -40),
        ("bear", "/wolf/", -30),
        ("bear", "/cat/", -30),
        ("cave_spider", "/silverfish/", -60),
        ("magma", "/slime/", 15),
        ("slime", "/magma/", -25),
    ];
    for (entity, folder, delta) in cross {
        if n.contains(entity) && p.contains(folder) {
            score += delta;
        }
    }
    if n.contains("spider") && p.contains("/spider/") {
        score += 25;
    }
    if n.contains("cave_spider") && p.contains("cave_spider") {
        score += 20;
    }
    score
}

fn pick_best_skin(index: &Index, ns: &str, aliases: &[String], name: &str) -> Option<String> {
    let prefix = format!("assets/{ns}/textures/entity/");
    let mut best: Option<(i32, String)> = None;
    for path in index.assets.keys() {
        if !path.starts_with(&prefix) || !path.ends_with(".png") || skip_entity_asset(path) {
            continue;
        }
        let file = path.rsplit('/').next().unwrap_or("");
        let base = file
            .trim_end_matches(".png")
            .to_ascii_lowercase()
            .replace('_', "");
        let matched = aliases.iter().any(|a| {
            let a = a.to_ascii_lowercase().replace('_', "");
            !a.is_empty() && (base == a || base.contains(&a))
        });
        if !matched {
            continue;
        }
        let score = score_skin_path(path, name);
        // Weak contains-matches must not beat folder-affinity candidates.
        if score < 8 {
            continue;
        }
        if best.as_ref().is_none_or(|(s, _)| score > *s) {
            best = Some((score, path.clone()));
        }
    }
    best.map(|(_, p)| p)
}

fn vanilla_family_texture(name: &str) -> Option<&'static str> {
    let n = name.to_ascii_lowercase();
    if n.contains("cave_spider") {
        return Some("assets/minecraft/textures/entity/spider/cave_spider.png");
    }
    if n.contains("spider") {
        return Some("assets/minecraft/textures/entity/spider/spider.png");
    }
    if n.contains("zombie_villager") {
        return Some("assets/minecraft/textures/entity/zombie_villager/zombie_villager.png");
    }
    if n.contains("zombie") {
        return Some("assets/minecraft/textures/entity/zombie/zombie.png");
    }
    if n.contains("wither_skeleton") {
        return Some("assets/minecraft/textures/entity/skeleton/wither_skeleton.png");
    }
    if n.contains("skeleton") {
        return Some("assets/minecraft/textures/entity/skeleton/skeleton.png");
    }
    if n.contains("creeper") {
        return Some("assets/minecraft/textures/entity/creeper/creeper.png");
    }
    if n.contains("enderman") {
        return Some("assets/minecraft/textures/entity/enderman/enderman.png");
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
                if !p.starts_with(&format!("{prefix}geo/")) || !p.ends_with(".geo.json") {
                    return false;
                }
                let file = p.rsplit('/').next().unwrap_or("");
                let base = file
                    .trim_end_matches(".geo.json")
                    .to_ascii_lowercase()
                    .replace('_', "");
                aliases.iter().any(|a| {
                    let a = a.to_ascii_lowercase().replace('_', "");
                    base == a
                })
            })
            .collect();
        let skins: Vec<_> = index
            .assets
            .keys()
            .filter(|p| {
                p.starts_with(&format!("{prefix}textures/entity/"))
                    && p.ends_with(".png")
                    && aliases.iter().any(|a| {
                        let a = a.to_ascii_lowercase();
                        let file = p.rsplit('/').next().unwrap_or("");
                        let base = file.trim_end_matches(".png").to_ascii_lowercase();
                        base == a || base == a.replace('_', "")
                    })
                    && !skip_entity_asset(p)
            })
            .collect();
        let geometry_path =
            pick_entity_path(&geometries, &name).or_else(|| geometries.first().copied());
        let skin_path = pick_best_skin(index, &ns, &aliases, &name).or_else(|| {
            pick_entity_path(&skins, &name)
                .or_else(|| skins.first().copied())
                .cloned()
                .or_else(|| find_skin_folder_sample(index, &ns, &aliases))
        });
        if geometry_path.is_none() {
            if let Some(skin) = skin_path.as_deref() {
                if let Some(resolution) = java_model_resolution(index, &ns, &aliases, skin) {
                    return resolution;
                }
            }
            if let Some(vanilla) = vanilla_family_texture(&name) {
                if index.assets.contains_key(vanilla) {
                    if let Some(resolution) = java_model_resolution(index, &ns, &aliases, vanilla) {
                        return resolution;
                    }
                    let template = texture_only_entity(
                        index,
                        vanilla,
                        &ns,
                        &name,
                        "使用原版同族实体纹理与模板",
                    );
                    if template.job.is_some() {
                        return template;
                    }
                }
            }
            if let Some(skin) = skin_path.as_deref() {
                let template = texture_only_entity(
                    index,
                    skin,
                    &ns,
                    &name,
                    "使用实体原始纹理作图标（无可用 Bedrock 几何）",
                );
                if template.job.is_some() {
                    return template;
                }
            }
            for alt in vanilla_extra_skin_paths(&ns, &name) {
                if index.assets.contains_key(&alt) {
                    let template = texture_only_entity(
                        index,
                        &alt,
                        &ns,
                        &name,
                        "使用原版实体纹理作图标（无可用 Bedrock 几何）",
                    );
                    if template.job.is_some() {
                        return template;
                    }
                }
            }
            last_missing = missing("未找到该生物的 Bedrock 几何、Java 模型或可映射的原版模板纹理");
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
            .or_insert_with(|| resource_signature(&sources(Path::new(root))));
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
    // The cap must not be tied to the statistics page size: it was 100 while
    // `StatisticsPage.page_size` was also 100, so any page-size change (or one
    // extra row) rejected the entire batch with "资源请求超过上限". The frontend
    // now also chunks its requests, so this is a safety limit rather than a
    // budget the UI has to hit exactly.
    const MAX_REQUESTS: usize = 500;
    if requests.len() > MAX_REQUESTS
        || requests
            .iter()
            .any(|r| r.roots.len() > 128 || r.key.len() > 512)
    {
        return Err(format!(
            "资源请求超过上限（最多 {MAX_REQUESTS} 条，本次 {}）",
            requests.len()
        ));
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
            // Fresh budget per batch so a long-lived Index still allows a full page.
            index
                .java_attempts
                .store(0, std::sync::atomic::Ordering::Relaxed);
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
                let answer = index.answers.get(&identity).cloned().unwrap_or_else(|| {
                    // A single bad model must not crash the whole check.
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        resolve(index, &key, &category)
                    }))
                    .unwrap_or_else(|_| missing("图标解析内部错误，已跳过该条"))
                });
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
        // Signature is intentionally excluded so restarts keep hitting the same key.
        let same = cache_key("/root", "sig2", "minecraft:used", "example:test");
        assert_eq!(key, same);
        let other = cache_key("/root", "sig", "minecraft:killed", "example:test");
        assert_ne!(key, other);
        let other_root = cache_key("/other", "sig", "minecraft:used", "example:test");
        assert_ne!(key, other_root);
        assert!(read_icon_cache(dir.path(), &other).is_none());
    }

    #[test]
    fn cache_only_hits_disk_without_jobs_and_misses_cleanly() {
        let game = tempfile::tempdir().unwrap();
        let root = game.path().join("instance");
        fs::create_dir_all(root.join("mods")).unwrap();
        let cache = tempfile::tempdir().unwrap();
        let signature = resource_signature(&sources(&root));
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
    fn spider_skin_prefers_spider_folder_over_silverfish() {
        assert!(
            score_skin_path(
                "assets/specialmobs/textures/entity/spider/pale.png",
                "poison_spider"
            ) > score_skin_path(
                "assets/specialmobs/textures/entity/silverfish/poison.png",
                "poison_spider"
            )
        );
        assert!(
            score_skin_path(
                "assets/minecraft/textures/entity/spider/spider.png",
                "poison_spider"
            ) > 0
        );
        assert!(
            score_skin_path(
                "assets/minecraft/textures/entity/silverfish/silverfish.png",
                "poison_spider"
            ) < 0
        );
        assert_eq!(
            vanilla_family_texture("poison_spider"),
            Some("assets/minecraft/textures/entity/spider/spider.png")
        );
        assert_eq!(
            vanilla_family_texture("cave_spider"),
            Some("assets/minecraft/textures/entity/spider/cave_spider.png")
        );
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("mc-spider-skin");
        fs::create_dir_all(dir.join("kubejs/assets/specialmobs/textures/entity/spider")).unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/specialmobs/textures/entity/silverfish"))
            .unwrap();
        fs::create_dir_all(dir.join("kubejs/assets/minecraft/textures/entity/spider")).unwrap();
        fs::write(
            dir.join("kubejs/assets/specialmobs/textures/entity/silverfish/poison.png"),
            minimal_png(64, 32),
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/specialmobs/textures/entity/spider/pale.png"),
            minimal_png(64, 32),
        )
        .unwrap();
        fs::write(
            dir.join("kubejs/assets/minecraft/textures/entity/spider/spider.png"),
            minimal_png(64, 32),
        )
        .unwrap();
        let index = indexed(&dir, None);
        let answer = resolve(
            &index,
            "stat.entityKilledBy.SpecialMobs.PoisonSpider",
            "legacy",
        );
        assert!(
            !answer.source.contains("silverfish"),
            "poison spider source: {}",
            answer.source
        );
        assert!(
            answer.image.is_some() || answer.job.is_some(),
            "poison spider: {}",
            answer.reason
        );
    }

    #[test]
    fn java_model_class_name_patterns_include_suffix_model() {
        assert_eq!(pascal_case("ferrouslime"), "Ferrouslime");
        assert_eq!(pascal_case("crimson_mosquito"), "CrimsonMosquito");
        // Both ModelX and XModel file names must be discoverable.
        let file = "FerrouslimeModel.class";
        let p = pascal_case("ferrouslime");
        assert!(file == format!("Model{p}.class") || file == format!("{p}Model.class"));
        let file2 = "ModelCrimsonMosquito.class";
        let p2 = pascal_case("crimson_mosquito");
        assert!(file2 == format!("Model{p2}.class") || file2 == format!("{p2}Model.class"));
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
            guardian.image.is_none() || guardian.job.is_some() || guardian.reason.contains("Java"),
            "draconic guardian: {}",
            guardian.reason
        );
        let apostle = resolve(&index, "goety:apostle", "minecraft:killed");
        assert!(
            apostle.image.is_some()
                || apostle.job.is_some()
                || apostle.reason.contains("Java")
                || apostle.reason.contains("未找到"),
            "apostle: {}",
            apostle.reason
        );
        if let Some(job) = &legacy.job {
            assert!(job.get("entityModel").is_some(), "legacy job shape: {job}");
        }
        assert!(is_entity_stat("legacy", "stat.killEntity.Zombie"));
        assert!(!is_entity_stat("legacy", "stat.mineBlock.1"));
        assert_eq!(snake_case("PoisonSpider"), "poison_spider");
    }
}
