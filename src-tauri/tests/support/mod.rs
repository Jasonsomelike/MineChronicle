#![allow(dead_code)]
use flate2::{write::GzEncoder, Compression};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::TempDir;

pub type TestResult = Result<(), Box<dyn std::error::Error>>;
pub const PLAYER: &str = "00000000-0000-4000-8000-000000000001";
pub const OTHER: &str = "00000000-0000-4000-8000-000000000002";

#[derive(Serialize)]
struct Root {
    #[serde(rename = "Data")]
    data: Data,
}
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct Data {
    level_name: String,
    data_version: i32,
    version: Version,
    last_played: i64,
}
#[derive(Serialize)]
struct Version {
    #[serde(rename = "Name")]
    name: String,
}

pub fn nbt(name: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    Ok(fastnbt::to_bytes(&Root {
        data: Data {
            level_name: name.to_owned(),
            data_version: 3953,
            version: Version {
                name: "1.21".to_owned(),
            },
            last_played: 1_700_000_000_000,
        },
    })?)
}
pub fn gzip(bytes: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes)?;
    encoder.finish()
}
pub fn level(world: &Path, name: &str) -> TestResult {
    fs::create_dir_all(world)?;
    fs::write(world.join("level.dat"), gzip(&nbt(name)?)?)?;
    Ok(())
}
pub fn stats(world: &Path, layout: &str, player: &str, ticks: i64) -> TestResult {
    let directory = world.join(layout);
    fs::create_dir_all(&directory)?;
    fs::write(
        directory.join(format!("{player}.json")),
        serde_json::json!({"stats":{"minecraft:custom":{"minecraft:play_time":ticks}}}).to_string(),
    )?;
    Ok(())
}
pub fn game() -> Result<(TempDir, PathBuf), std::io::Error> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("GameRoot");
    fs::create_dir_all(root.join("saves"))?;
    Ok((directory, root))
}

#[cfg(windows)]
pub fn directory_link(alias: &Path, target: &Path) -> TestResult {
    // Both arguments must stay inside a temporary fixture tree. Pass paths as
    // native arguments rather than interpolating them into PowerShell source.
    if !alias.is_absolute() || !target.is_absolute() {
        return Err("fixture paths must be absolute".into());
    }
    let output = std::process::Command::new("pwsh")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-CommandWithArgs", "New-Item -ItemType Junction -Path $args[0] -Target $args[1] -ErrorAction Stop | Out-Null"])
        .arg(alias).arg(target).output()?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned().into());
    }
    Ok(())
}
#[cfg(unix)]
pub fn directory_link(alias: &Path, target: &Path) -> TestResult {
    std::os::unix::fs::symlink(target, alias)?;
    Ok(())
}
