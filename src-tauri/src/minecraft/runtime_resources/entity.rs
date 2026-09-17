//! Entity naming, vanilla geometry templates and the entity icon path.
use super::*;

pub(crate) fn pick_entity_path<'a>(paths: &[&'a String], key_name: &str) -> Option<&'a String> {
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

pub(crate) fn snake_case(name: &str) -> String {
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

pub(crate) fn entity_name_aliases(ns: &str, name: &str) -> Vec<String> {
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

pub(crate) fn skip_entity_asset(path: &str) -> bool {
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

pub(crate) fn find_skin_folder_sample(
    index: &Index,
    ns: &str,
    aliases: &[String],
) -> Option<String> {
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

pub(crate) fn entity_resource_candidates(key: &str) -> Vec<(String, String)> {
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

pub(crate) fn is_entity_stat(category: &str, key: &str) -> bool {
    category.ends_with("killed")
        || category.ends_with("killed_by")
        || (category == "legacy"
            && (key.starts_with("stat.entityKilledBy.") || key.starts_with("stat.killEntity.")))
}

/// Vanilla-compatible skins only. Custom Java-model UVs cannot be mapped safely.
pub(crate) fn vanilla_template_model(
    ns: &str,
    name: &str,
    width: u32,
    height: u32,
) -> Option<Value> {
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

pub(crate) fn vanilla_extra_skin_paths(ns: &str, name: &str) -> Vec<String> {
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

pub(crate) fn texture_only_entity(
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

pub(crate) fn pascal_case(name: &str) -> String {
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

pub(crate) fn score_skin_path(path: &str, name: &str) -> i32 {
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

pub(crate) fn pick_best_skin(
    index: &Index,
    ns: &str,
    aliases: &[String],
    name: &str,
) -> Option<String> {
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

pub(crate) fn vanilla_family_texture(name: &str) -> Option<&'static str> {
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

pub(crate) fn entity(index: &Index, key: &str) -> Resolution {
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
