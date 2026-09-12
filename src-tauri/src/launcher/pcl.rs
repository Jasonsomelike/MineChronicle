//! PCL metadata adapter. Reads an allowlist of settings, never authentication data.
use super::{DiscoveredInstance, LauncherAdapter};
use crate::{
    domain::{LauncherKind, ModLoader},
    scanner::{path_identity::is_link, ScanIssue, ScanIssueKind},
};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct PclAdapter;
#[derive(Default)]
pub struct PclDiscovery {
    pub instances: Vec<DiscoveredInstance>,
    pub issues: Vec<ScanIssue>,
}
const KEYS: &[&str] = &[
    "VersionArgumentIndieV2",
    "VersionArgumentIndie",
    "LaunchArgumentIndieV2",
    "LaunchArgumentIndie",
    "VersionOriginal",
    "VersionNeoForge",
    "VersionForge",
    "VersionFabric",
    "VersionQuilt",
    "VersionOptiFine",
];

fn safe_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| !is_link(&m))
}
fn bounded(path: &Path) -> io::Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path)?;
    if is_link(&meta) || !meta.is_file() || meta.len() > 2 * 1024 * 1024 {
        return Err(io::Error::other("配置不是普通文件或超过 2 MiB"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(io::Error::other("配置超过 2 MiB"));
    }
    Ok(bytes)
}
fn settings(path: &Path) -> io::Result<HashMap<String, String>> {
    let bytes = bounded(path)?;
    // PCL keys and values used here are ASCII. Filter bytes before decoding so
    // legacy GB18030 descriptions or unrelated private values are never retained.
    let mut values = HashMap::new();
    for line in bytes.split(|b| *b == b'\n') {
        let line = line.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(line);
        let Some(index) = line.iter().position(|b| *b == b':' || *b == b'=') else {
            continue;
        };
        let Ok(key) = std::str::from_utf8(&line[..index]) else {
            continue;
        };
        let key = key.trim();
        if KEYS.contains(&key) {
            let value = std::str::from_utf8(&line[index + 1..])
                .map_err(|_| io::Error::other("PCL 隔离设置编码无效"))?
                .trim();
            if values.insert(key.to_owned(), value.to_owned()).is_some() {
                return Err(io::Error::other("PCL 隔离设置存在重复键"));
            }
        }
    }
    Ok(values)
}
fn warning(result: &mut PclDiscovery, path: &Path, message: impl Into<String>) {
    result.issues.push(ScanIssue {
        kind: ScanIssueKind::InvalidLauncherMetadata,
        path: path.to_owned(),
        message: message.into(),
    });
}
fn loader(json: &Value) -> Option<ModLoader> {
    for (prefix, name) in [
        ("net.neoforged:neoforge:", "NeoForge"),
        ("net.minecraftforge:forge:", "Forge"),
        ("net.fabricmc:fabric-loader:", "Fabric"),
        ("org.quiltmc:quilt-loader:", "Quilt"),
        ("optifine:OptiFine:", "OptiFine"),
    ] {
        if let Some(version) = json
            .get("libraries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|lib| lib.get("name").and_then(Value::as_str))
            .find_map(|s| s.strip_prefix(prefix))
        {
            return Some(ModLoader {
                name: name.into(),
                version: Some(version.into()),
            });
        }
    }
    None
}

fn metadata_version(value: &str) -> Option<String> {
    if value.len() > 128
        || value.is_empty()
        || value == "0"
        || value.eq_ignore_ascii_case("false")
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
    {
        return None;
    }
    Some(value.to_owned())
}
fn cached_loader(local: &HashMap<String, String>) -> Option<ModLoader> {
    for (key, name) in [
        ("VersionNeoForge", "NeoForge"),
        ("VersionForge", "Forge"),
        ("VersionFabric", "Fabric"),
        ("VersionQuilt", "Quilt"),
        ("VersionOptiFine", "OptiFine"),
    ] {
        if let Some(version) = local.get(key).and_then(|v| metadata_version(v)) {
            return Some(ModLoader {
                name: name.into(),
                version: Some(version),
            });
        }
    }
    None
}
fn isolation(
    local: &HashMap<String, String>,
    global: &HashMap<String, String>,
    version: &Path,
    modded: bool,
    release: bool,
) -> io::Result<(bool, String)> {
    if let Some(value) = local.get("VersionArgumentIndieV2") {
        return match value.to_ascii_lowercase().as_str() {
            "true" | "1" => Ok((true, "PCL 显式隔离".into())),
            "false" | "0" => Ok((false, "PCL 显式共享".into())),
            _ => Err(io::Error::other("PCL V2 隔离值无效")),
        };
    }
    if let Some(value) = local.get("VersionArgumentIndie") {
        match value.as_str() {
            "1" => return Ok((true, "PCL 旧版显式隔离".into())),
            "2" => return Ok((false, "PCL 旧版显式共享".into())),
            "0" | "-1" => {}
            _ => return Err(io::Error::other("PCL 旧版隔离值无效")),
        }
    }
    for folder in ["mods", "saves"] {
        let path = version.join(folder);
        if safe_exists(&path) {
            let entries = fs::read_dir(&path)?;
            for entry in entries.take(10_000) {
                let meta = entry?.file_type()?;
                if (folder == "mods" && meta.is_file()) || (folder == "saves" && meta.is_dir()) {
                    return Ok((true, "PCL 根据现有内容隔离".into()));
                }
            }
        }
    }
    let value = global
        .get("LaunchArgumentIndieV2")
        .or_else(|| global.get("LaunchArgumentIndie"));
    let mode = match value {
        Some(v) => v
            .parse::<u8>()
            .map_err(|_| io::Error::other("PCL 全局隔离值无效"))?,
        None => {
            return Err(io::Error::other(
                "缺少可确认的 PCL 隔离配置；请在 PCL 设置一次版本隔离后重扫。",
            ))
        }
    };
    let isolated = match mode {
        0 => false,
        1 => modded,
        2 => !release,
        3 => modded || !release,
        4 => true,
        _ => return Err(io::Error::other("PCL 全局隔离值超出支持范围")),
    };
    Ok((isolated, "PCL 全局隔离规则".into()))
}

impl PclAdapter {
    /// `container` holds versions; all ancestors read are inside `scope`.
    pub fn scan_container(
        &self,
        container: &Path,
        scope: &Path,
        proceed: impl FnMut() -> bool,
    ) -> PclDiscovery {
        self.scan_linked_container(container, scope, None, proceed)
    }
    pub fn scan_linked_container(
        &self,
        container: &Path,
        scope: &Path,
        launcher: Option<&Path>,
        mut proceed: impl FnMut() -> bool,
    ) -> PclDiscovery {
        let mut result = PclDiscovery::default();
        if !container.starts_with(scope) || !safe_exists(&container.join("versions")) {
            return result;
        }
        let global_dir = launcher.or_else(|| {
            container
                .ancestors()
                .take_while(|p| p.starts_with(scope))
                .find(|p| safe_exists(&p.join("PCL")) && safe_exists(&p.join("PCL/Setup.ini")))
        });
        let global = match global_dir
            .map(|p| settings(&p.join("PCL/Setup.ini")))
            .transpose()
        {
            Ok(v) => v.unwrap_or_default(),
            Err(_) => {
                warning(
                    &mut result,
                    container,
                    "PCL 全局配置无法读取，将仅使用实例自身的明确配置。",
                );
                HashMap::new()
            }
        };
        let global_evidence = global_dir.is_some() || safe_exists(&container.join("PCL.ini"));
        let entries = match fs::read_dir(container.join("versions")) {
            Ok(v) => v,
            Err(_) => {
                warning(&mut result, container, "无法枚举 PCL 版本目录。");
                return result;
            }
        };
        for (index, entry) in entries.enumerate() {
            if !proceed() {
                break;
            }
            if index >= 256 {
                warning(
                    &mut result,
                    container,
                    "PCL 实例数量超过 256，请缩小扫描范围。",
                );
                break;
            }
            let entry = match entry {
                Ok(v) => v,
                Err(_) => {
                    warning(&mut result, container, "部分 PCL 版本目录无法读取。");
                    continue;
                }
            };
            let version = entry.path();
            if !entry.file_type().is_ok_and(|m| m.is_dir()) || !safe_exists(&version) {
                continue;
            }
            let pcl = version.join("PCL");
            let has_local = safe_exists(&pcl) && safe_exists(&pcl.join("Setup.ini"));
            if !global_evidence && !has_local {
                continue;
            }
            let local = if has_local {
                match settings(&pcl.join("Setup.ini")) {
                    Ok(v) => v,
                    Err(_) => {
                        warning(
                            &mut result,
                            &version,
                            "PCL 实例配置无效，未猜测其游戏根目录。",
                        );
                        continue;
                    }
                }
            } else {
                HashMap::new()
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let json: Value = match bounded(&version.join(format!("{name}.json")))
                .and_then(|b| serde_json::from_slice(&b).map_err(io::Error::other))
            {
                Ok(v) => v,
                Err(_) => {
                    warning(
                        &mut result,
                        &version,
                        "实例版本 JSON 无法读取，未导入该实例元数据。",
                    );
                    continue;
                }
            };
            let mod_loader = loader(&json).or_else(|| cached_loader(&local));
            let minecraft_version = json
                .get("inheritsFrom")
                .or_else(|| json.get("minecraftVersion"))
                .or_else(|| json.get("clientVersion"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    local
                        .get("VersionOriginal")
                        .and_then(|v| metadata_version(v))
                })
                .or_else(|| {
                    if mod_loader.is_none() {
                        json.get("id").and_then(Value::as_str).map(str::to_owned)
                    } else {
                        None
                    }
                });
            let release = json.get("type").and_then(Value::as_str) == Some("release");
            let (isolated, reason) =
                match isolation(&local, &global, &version, mod_loader.is_some(), release) {
                    Ok(v) => v,
                    Err(e) => {
                        warning(&mut result, &version, e.to_string());
                        continue;
                    }
                };
            let game_root = if isolated {
                version.clone()
            } else {
                container.to_owned()
            };
            match (fs::canonicalize(&version), fs::canonicalize(&game_root)) {
                (Ok(instance_path), Ok(game_root)) => result.instances.push(DiscoveredInstance {
                    launcher_path: global_dir.unwrap_or(container).to_owned(),
                    instance_path,
                    name,
                    game_root,
                    minecraft_version,
                    mod_loader,
                    isolation: reason,
                }),
                _ => warning(&mut result, &version, "实例目录暂时不可访问。"),
            }
        }
        result
            .instances
            .sort_by(|a, b| a.instance_path.cmp(&b.instance_path));
        result
    }
}
impl LauncherAdapter for PclAdapter {
    fn kind(&self) -> LauncherKind {
        LauncherKind::Pcl
    }
    fn discover_instances(
        &self,
        authorized_roots: &[PathBuf],
    ) -> io::Result<Vec<DiscoveredInstance>> {
        let mut instances = Vec::new();
        for input in authorized_roots.iter().take(32) {
            if !input.is_absolute() {
                return Err(io::Error::other("PCL 目录必须是绝对路径"));
            }
            let scope = fs::canonicalize(input)?;
            if scope.parent().is_none() {
                return Err(io::Error::other("不允许扫描整块磁盘"));
            }
            instances.extend(self.scan_container(&scope, &scope, || true).instances);
            // Launcher bases may hold .minecraft or several named game folders.
            // This adapter reads metadata only; the scanner handles world files.
            for entry in fs::read_dir(&scope)?.take(256) {
                let entry = entry?;
                if entry.file_type()?.is_dir() && safe_exists(&entry.path()) {
                    instances.extend(
                        self.scan_container(&entry.path(), &scope, || true)
                            .instances,
                    );
                }
            }
        }
        instances.sort_by(|a, b| a.instance_path.cmp(&b.instance_path));
        instances.dedup_by(|a, b| a.instance_path == b.instance_path);
        Ok(instances)
    }
}
