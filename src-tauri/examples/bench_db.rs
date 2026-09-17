//! Read-only timing of the database paths the UI polls, so a change to
//! Repository::open / load / health_summary can be compared against a baseline.
//!
//! Point it at a *copy* of an archive, not the live one, and compare the same
//! copy before and after a change:
//!
//! ```text
//! cargo run --release --example bench_db -- path/to/archive-copy.sqlite3
//! ```
//!
//! Reference numbers from the 0.10.12 real archive (64 roots, 97 worlds,
//! 203 world-players) after enabling WAL and removing load()'s N+1:
//! open ~1.2 ms, load ~2.2 ms, health_summary ~2.3 ms.
use minechronicle_lib::database::Repository;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: bench_db <archive.sqlite3>")?;
    let path = std::path::Path::new(&path);

    // Warm the OS page cache first so we measure work, not cold disk.
    let _ = Repository::open(path)?.load()?;
    let mode = Repository::open(path)?.journal_mode()?;

    const N: u32 = 50;
    let started = Instant::now();
    for _ in 0..N {
        let repo = Repository::open(path)?;
        std::hint::black_box(&repo);
    }
    let open_ms = started.elapsed().as_secs_f64() * 1000.0 / f64::from(N);

    let repo = Repository::open(path)?;
    let started = Instant::now();
    for _ in 0..N {
        std::hint::black_box(repo.load()?);
    }
    let load_ms = started.elapsed().as_secs_f64() * 1000.0 / f64::from(N);

    let started = Instant::now();
    for _ in 0..N {
        std::hint::black_box(repo.health_summary()?);
    }
    let health_ms = started.elapsed().as_secs_f64() * 1000.0 / f64::from(N);

    let library = repo.load()?;
    let worlds: usize = library.roots.iter().map(|r| r.worlds.len()).sum();
    let players: usize = library
        .roots
        .iter()
        .flat_map(|r| &r.worlds)
        .map(|w| w.players.len())
        .sum();

    println!(
        "archive: {} roots, {worlds} worlds, {players} world-players, journal_mode={mode}",
        library.roots.len()
    );
    println!("open()          {open_ms:8.3} ms");
    println!("load()          {load_ms:8.3} ms");
    println!("health_summary(){health_ms:8.3} ms");
    println!("open+load       {:8.3} ms", open_ms + load_ms);
    Ok(())
}
