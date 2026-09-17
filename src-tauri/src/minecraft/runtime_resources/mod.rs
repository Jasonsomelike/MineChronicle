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

pub(crate) mod assets;
mod cache;
mod commands;
mod entity;
mod java_model;
mod resolve;

// Sibling modules reach these through `use super::*`, so re-export at the
// visibility the extracted items actually have.
pub(crate) use assets::*;
pub(crate) use cache::*;
pub use commands::*;
pub(crate) use entity::*;
pub(crate) use java_model::*;
pub(crate) use resolve::*;

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

pub(crate) const MAX_ASSET: u64 = 8 * 1024 * 1024;
#[derive(Clone)]
pub(crate) struct Asset {
    container: PathBuf,
    entry: Option<String>,
}
pub(crate) struct Index {
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
pub(crate) static CACHE: OnceLock<Mutex<HashMap<String, Index>>> = OnceLock::new();
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
pub(crate) fn missing(reason: impl Into<String>) -> Resolution {
    Resolution {
        image: None,
        source: String::new(),
        reason: reason.into(),
        job: None,
    }
}

/// Stable across restarts: do NOT mix resource_signature (mtimes) into the key.
/// Pipeline format version lives in the suffix; invalidate by bumping it.
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
