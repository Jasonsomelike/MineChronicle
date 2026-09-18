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

/// Creates a directory junction, used to test that the scanner resolves path
/// aliases and does not follow links below a root.
///
/// Implemented with `mklink /J` rather than PowerShell. The previous version
/// shelled out to `pwsh -CommandWithArgs`, which requires PowerShell 7+ and was
/// never declared as a prerequisite - so the test suite silently depended on a
/// tool the README did not mention. `cmd`'s `mklink` is present on every
/// supported Windows and needs no extra setup.
///
/// A junction (not a symlink) is used deliberately: it is what Minecraft
/// launchers actually create, it needs no elevation or developer mode, and
/// `std::fs::symlink_dir` would require the latter.
///
/// `mklink` is a `cmd` builtin, so the command line is assembled by hand and
/// appended with `raw_arg`. Passing it as a normal argument lets Rust escape the
/// inner quotes with backslashes, which `cmd` does not understand - that
/// produced `Invalid switch - "linked"` and, for other paths, a spurious
/// "filename, directory name, or volume label syntax is incorrect".
#[cfg(windows)]
pub fn directory_link(alias: &Path, target: &Path) -> TestResult {
    use std::os::windows::process::CommandExt;

    // Both arguments must stay inside a temporary fixture tree.
    if !alias.is_absolute() || !target.is_absolute() {
        return Err("fixture paths must be absolute".into());
    }
    // A quote cannot appear in a valid Windows path, so this cannot break the
    // quoting below; reject it rather than building an ambiguous command line.
    let (Some(alias_text), Some(target_text)) = (alias.to_str(), target.to_str()) else {
        return Err("fixture paths must be valid UTF-8".into());
    };
    if alias_text.contains('"') || target_text.contains('"') {
        return Err("fixture paths must not contain quotes".into());
    }
    let output = std::process::Command::new("cmd")
        .arg("/C")
        .raw_arg(format!("mklink /J \"{alias_text}\" \"{target_text}\""))
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "mklink /J failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(())
}
#[cfg(unix)]
pub fn directory_link(alias: &Path, target: &Path) -> TestResult {
    std::os::unix::fs::symlink(target, alias)?;
    Ok(())
}
