use flate2::{write::GzEncoder, Compression};
use std::{env, fs, io::Write, path::PathBuf};

fn main() {
    tauri_build::build();
    let manifest_dir = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR")
            .unwrap_or_else(|| panic!("CARGO_MANIFEST_DIR is not set")),
    );
    let resources = manifest_dir.join("resources/stat-resources.json");
    println!("cargo:rerun-if-changed={}", resources.display());
    let source = fs::read(&resources)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", resources.display()));
    let output =
        PathBuf::from(env::var_os("OUT_DIR").unwrap_or_else(|| panic!("OUT_DIR is not set")))
            .join("stat-resources.json.gz");
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder
        .write_all(&source)
        .unwrap_or_else(|error| panic!("failed to compress statistic resources: {error}"));
    let compressed = encoder
        .finish()
        .unwrap_or_else(|error| panic!("failed to finish statistic resource compression: {error}"));
    fs::write(&output, &compressed)
        .unwrap_or_else(|error| panic!("failed to write {}: {error}", output.display()));
    println!(
        "cargo:warning=stat-resources.json: {} bytes compressed to {} bytes",
        source.len(),
        compressed.len()
    );
    // Tauri's app manifest is applied to the app binary, not integration test
    // executables. Its menu code imports TaskDialogIndirect from Common Controls 6.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/windows.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
