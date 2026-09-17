//! Sizes the discovery-stage cost on a synthetic tree (no real user data, no
//! registry access).
//!
//! Used to check whether discovery scales superlinearly, since `roots.contains`
//! was a linear scan and PCL/Setup.ini is re-parsed per container. Measured
//! per-instance cost was flat (1.87 ms at 60 instances, 1.82 ms at 240), i.e.
//! the pass is linear and dominated by per-instance syscalls, not bookkeeping:
//! `roots.contains` measured 0.013 ms and Setup.ini parsing 5.1 ms out of a
//! ~436 ms pass. Re-run with a different container count to re-check that.
//!
//! ```text
//! cargo run --release --example bench_discovery -- 40
//! ```
use minechronicle_lib::scanner::discover_and_scan_linked;
use std::{fs, path::Path, time::Instant};

/// Builds a container that looks like a PCL folder: `<root>/versions/<n>/`.
fn make_container(root: &Path, versions: usize) -> std::io::Result<()> {
    fs::create_dir_all(root.join("PCL"))?;
    fs::write(root.join("PCL/Setup.ini"), "LaunchArgumentIndieV2:4\n")?;
    for index in 0..versions {
        let version = root.join("versions").join(format!("v{index}"));
        fs::create_dir_all(&version)?;
        fs::write(
            version.join(format!("v{index}.json")),
            format!(r#"{{"id":"v{index}","type":"release"}}"#),
        )?;
        fs::create_dir_all(version.join("saves").join("world"))?;
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let containers: usize = std::env::args()
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(40);
    const VERSIONS: usize = 6;

    let dir = tempfile::tempdir()?;
    let launcher = dir.path().join("launcher");
    fs::create_dir_all(&launcher)?;
    for index in 0..containers {
        make_container(&launcher.join(format!("container{index}")), VERSIONS)?;
    }

    // Warm once, then time steady-state runs.
    let first = discover_and_scan_linked(std::slice::from_ref(&launcher), None, |_| true);
    let instances = first.instances.len();
    let roots = first.roots.len();

    const RUNS: u32 = 5;
    let started = Instant::now();
    for _ in 0..RUNS {
        std::hint::black_box(discover_and_scan_linked(
            std::slice::from_ref(&launcher),
            None,
            |_| true,
        ));
    }
    let per_run = started.elapsed().as_secs_f64() * 1000.0 / f64::from(RUNS);
    println!(
        "containers={containers} versions={VERSIONS} -> instances={instances} roots={roots}  {per_run:.2} ms/run"
    );
    Ok(())
}
