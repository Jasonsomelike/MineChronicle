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
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return Vec::new();
    };
    zip.file_names().map(str::to_owned).collect()
}

fn find_java_model_class(index: &Index, aliases: &[String]) -> Option<(PathBuf, String)> {
    let pascals: Vec<String> = aliases.iter().map(|a| pascal_case(a)).collect();
    let mut containers: Vec<PathBuf> = index
        .assets
        .values()
        .map(|a| a.container.clone())
        .collect();
    containers.sort();
    containers.dedup();
    for container in containers {
        if container.extension().is_none_or(|e| e != "jar") {
            continue;
        }
        let names = zip_entry_names(&container);
        let hits: Vec<String> = names
            .iter()
            .filter(|n| {
                n.ends_with(".class")
                    && n.contains("/model/")
                    && !n.contains('$')
                    && !n.contains("Layer")
                    && !n.contains("Armor")
                    && pascals.iter().any(|p| {
                        let want = format!("Model{p}");
                        n.ends_with(&format!("{want}.class"))
                    })
            })
            .cloned()
            .collect();
        if hits.len() != 1 {
            continue;
        }
        let entry = hits[0].clone();
        let class_name = entry.trim_end_matches(".class").replace('/', ".");
        return Some((container, class_name));
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
    let mut containers: Vec<PathBuf> = index
        .assets
        .values()
        .map(|a| a.container.clone())
        .collect();
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

fn java_model_resolution(index: &Index, aliases: &[String], skin: &str) -> Option<Resolution> {
    let (jar, class_name) = find_java_model_class(index, aliases)?;
    let classes = collect_java_class_map(&jar, &class_name, index);
    if !classes.contains_key(&class_name) {
        return None;
    }
    let mut class_b64 = serde_json::Map::new();
    for (name, bytes) in &classes {
        class_b64.insert(name.clone(), Value::String(STANDARD.encode(bytes)));
    }
    let (bytes, source) = read(index, skin)?;
    if !png_is_valid(&bytes) {
        return None;
    }
    let (tw, th) = png_size(&bytes)?;
    let render_size = tw.max(th).clamp(512, 2048);
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
            "textureWidth": tw,
            "textureHeight": th,
            "renderSize": render_size,
        })),
    })
}

