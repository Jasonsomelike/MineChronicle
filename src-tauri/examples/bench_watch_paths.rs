//! Measure watch_paths(): how much filesystem work it does per reconcile.
//!
//! The audit notes it is called twice per round (once on the stored library, once
//! on the freshly scanned summary) and that it stats the same directories
//! repeatedly. This times a call so the claim can be judged against the scan it
//! runs alongside.
use minechronicle_lib::{database::Repository, tracker::watcher::watch_paths};
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: bench_watch_paths <db>")?;
    let repo = Repository::open(std::path::Path::new(&path))?;
    let library = repo.load()?;

    let first = watch_paths(&library);
    println!("watch_paths returned {} paths", first.len());

    const N: u32 = 200;
    let started = Instant::now();
    for _ in 0..N {
        std::hint::black_box(watch_paths(&library));
    }
    let per = started.elapsed().as_secs_f64() * 1000.0 / f64::from(N);
    println!(
        "watch_paths: {per:.3} ms per call (x2 per reconcile = {:.3} ms)",
        per * 2.0
    );

    // Count the stat calls it makes, to show the redundancy.
    let roots = library.roots.len();
    let worlds: usize = library.roots.iter().map(|r| r.worlds.len()).sum();
    println!(
        "  {roots} roots, {worlds} worlds -> up to {} safe_dir calls per invocation",
        roots * 2 + worlds * 4
    );

    let started = Instant::now();
    for _ in 0..20 {
        std::hint::black_box(repo.load()?);
    }
    let load_ms = started.elapsed().as_secs_f64() * 1000.0 / 20.0;
    println!("repo.load() for comparison: {load_ms:.3} ms");
    Ok(())
}
