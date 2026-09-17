//! Per-statistic dispatcher: picks the resolution strategy for a key.
use super::*;

pub(crate) fn resolve(index: &Index, key: &str, category: &str) -> Resolution {
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
