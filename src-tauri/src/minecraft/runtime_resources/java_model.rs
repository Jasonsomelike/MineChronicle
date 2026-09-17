//! Java bytecode model extraction. Reads constant pools; never executes classes.
use super::*;

pub(crate) fn class_super_name(bytes: &[u8]) -> Option<String> {
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

pub(crate) fn read_zip_entry(container: &Path, entry: &str) -> Option<Vec<u8>> {
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

pub(crate) fn zip_entry_names(container: &Path) -> Vec<String> {
    let Ok(file) = fs::File::open(container) else {
        return Vec::new();
    };
    let Ok(zip) = zip::ZipArchive::new(file) else {
        return Vec::new();
    };
    zip.file_names().map(str::to_owned).collect()
}

pub(crate) fn model_class_entries(index: &Index, container: &Path) -> Vec<String> {
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

pub(crate) fn find_java_model_class(
    index: &Index,
    ns: &str,
    aliases: &[String],
) -> Option<(PathBuf, String)> {
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

pub(crate) fn collect_java_class_map(
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

pub(crate) fn java_model_resolution(
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

pub(crate) fn class_texture_hint(bytes: &[u8], name: &str) -> Option<String> {
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
