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
fn indexed(root: &Path, previous: Option<Index>) -> Index {
    let paths = sources(root);
    let mut files = Vec::new();
    for p in &paths {
        if p.is_dir() {
            loose_files(p, 0, &mut files);
        } else {
            files.push(p.clone());
        }
    }
    let signature = files
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
        .join("|");
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
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}
fn entity(index: &Index, key: &str) -> Resolution {
    let Some((ns, name)) = key.split_once(':') else {
        return missing("非法生物标识");
    };
    let prefix = format!("assets/{ns}/");
    let geometries: Vec<_> = index
        .assets
        .keys()
        .filter(|p| {
            p.starts_with(&format!("{prefix}geo/")) && p.ends_with(&format!("/{name}.geo.json"))
        })
        .collect();
    let skins: Vec<_> = index
        .assets
        .keys()
        .filter(|p| {
            p.starts_with(&format!("{prefix}textures/entity/"))
                && p.ends_with(&format!("/{name}.png"))
        })
        .collect();
    if geometries.len() != 1 || skins.len() != 1 {
        return missing("生物几何与皮肤不能唯一配对；需要Java渲染器绑定或专用适配器");
    }
    let Some(geometry) = json(index, geometries[0]) else {
        return missing("生物几何JSON不可读");
    };
    let Some(models) = geometry.get("minecraft:geometry").and_then(Value::as_array) else {
        return missing("非标准Bedrock几何格式");
    };
    if models.len() != 1 {
        return missing("生物包含多种几何，需要明确渲染器绑定");
    }
    let model = &models[0];
    let Some(bones) = model.get("bones").and_then(Value::as_array) else {
        return missing("生物几何无骨骼");
    };
    if bones.len() > 512
        || bones
            .iter()
            .map(|b| b.get("cubes").and_then(Value::as_array).map_or(0, Vec::len))
            .sum::<usize>()
            > 2048
    {
        return missing("生物几何复杂度超限");
    }
    let Some((bytes, source)) = read(index, skins[0]) else {
        return missing("生物皮肤不可读");
    };
    let width = model
        .pointer("/description/texture_width")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let height = model
        .pointer("/description/texture_height")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if width == 0 || height == 0 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return missing("生物材质尺寸或PNG无效");
    }
    Resolution {
        image: None,
        source: format!("{source} · {}", geometries[0]),
        reason: "自动配对同标识生物几何和原始皮肤（静态姿态）".into(),
        job: Some(
            serde_json::json!({"entityModel":{"format":"bedrock","textureWidth":width,"textureHeight":height,"bones":bones},"layers":[format!("data:image/png;base64,{}", STANDARD.encode(bytes))]}),
        ),
    }
}
fn resolve(index: &Index, key: &str, category: &str) -> Resolution {
    if category.ends_with("killed") || category.ends_with("killed_by") {
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
    let path = match asset_path(&id, "models", "json") {
        Some(p) => p,
        None => return missing("非法资源标识"),
    };
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
        return missing("动画材质需要帧提取，保留已有图标");
    }
    let Some((bytes, source)) = read(index, &path) else {
        return missing("未找到同标识物品材质；可能由Java动态生成");
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return missing("材质不是有效PNG");
    }
    Resolution {
        image: Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes))),
        source,
        reason: "自动发现本地原始材质".into(),
        job: None,
    }
}
#[tauri::command]
pub async fn resolve_stat_icons(
    requests: Vec<Request>,
) -> Result<BTreeMap<String, Resolution>, String> {
    if requests.len() > 100
        || requests
            .iter()
            .any(|r| r.roots.len() > 128 || r.key.len() > 512)
    {
        return Err("资源请求超过上限".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = CACHE
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "资源缓存锁失败")?;
        let mut result = BTreeMap::new();
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
                let answer = index
                    .answers
                    .get(&identity)
                    .cloned()
                    .unwrap_or_else(|| resolve(index, &key, &category));
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
}
