//! Performance-shape gate for the database read paths.
//!
//! Wall-clock thresholds are machine-dependent and flaky, and the old `load()`
//! N+1 was linear in round trips (one query per root, then per world) rather
//! than quadratic - so a timing ratio cannot separate the two shapes reliably.
//! This test counts the SQL statements `load()` actually executes instead, which
//! is deterministic and directly expresses the property that matters: the number
//! of round trips must not grow with the number of worlds.
//!
//! `rusqlite`'s `trace` feature is enabled in Cargo.toml for exactly this test.
//! Use `examples/bench_db.rs` for absolute timings.
mod support;
use minechronicle_lib::database::{
    read_models::{PlayerSummary, RootSummary, ScanSummary, WorldSummary},
    Repository,
};
use std::sync::atomic::{AtomicUsize, Ordering};

/// SQLite's trace hook carries only a function pointer, so the observer cannot
/// capture state; it accumulates here instead.
static STATEMENTS: AtomicUsize = AtomicUsize::new(0);

fn count_statement(_sql: &str) {
    STATEMENTS.fetch_add(1, Ordering::Relaxed);
}

/// Builds an archive with `roots` game roots of `worlds_per_root` worlds each.
fn archive(
    roots: usize,
    worlds_per_root: usize,
) -> Result<(tempfile::TempDir, std::path::PathBuf), Box<dyn std::error::Error>> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("shape.sqlite3");
    let mut repo = Repository::open(&path).map_err(|e| e.to_string())?;

    let mut report = ScanSummary::from(minechronicle_lib::scanner::ScanReport::default());
    for root_index in 0..roots {
        let root_path = temp.path().join(format!("root{root_index}"));
        let worlds = (0..worlds_per_root)
            .map(|world_index| WorldSummary {
                path: root_path.join("saves").join(format!("world{world_index}")),
                name: format!("World {world_index}"),
                status: minechronicle_lib::domain::WorldStatus::Present,
                data_version: Some(3465),
                minecraft_version: Some("1.21".into()),
                metadata_fingerprint: Some(format!("fp{root_index}-{world_index}")),
                players: vec![PlayerSummary {
                    uuid: format!(
                        "00000000-0000-4000-8000-{:012}",
                        root_index * 1000 + world_index
                    ),
                    preferred_name: Some(format!("Player {world_index}")),
                    name_source: Some("usercache".into()),
                    initial_play_ticks: Some("1200".into()),
                    normalized_stats: None,
                    play_ticks: Some("1200".into()),
                    source_paths: Vec::new(),
                    conflicting: false,
                }],
            })
            .collect();
        report.roots.push(RootSummary {
            path: root_path,
            requested_paths: Vec::new(),
            enumeration_complete: true,
            worlds,
        });
    }
    repo.import(&report, &[]).map_err(|e| e.to_string())?;
    drop(repo);
    Ok((temp, path))
}

/// Counts the statements `load()` runs on a fresh connection.
fn statements_for_load(path: &std::path::Path) -> Result<usize, Box<dyn std::error::Error>> {
    let repo = Repository::open(path).map_err(|e| e.to_string())?;
    repo.trace_statements(count_statement);
    STATEMENTS.store(0, Ordering::Relaxed);
    repo.load().map_err(|e| e.to_string())?;
    Ok(STATEMENTS.load(Ordering::Relaxed))
}

#[test]
fn load_round_trips_do_not_grow_with_world_count() -> Result<(), Box<dyn std::error::Error>> {
    const ROOTS: usize = 4;
    // Same roots, 8x the worlds. A per-world query would multiply the count by 8.
    let (small_temp, small_path) = archive(ROOTS, 2)?;
    let (large_temp, large_path) = archive(ROOTS, 16)?;

    let small = statements_for_load(&small_path)?;
    let large = statements_for_load(&large_path)?;

    assert!(small > 0, "trace should observe at least one statement");
    // The query count must stay flat: allow a small constant margin for any
    // per-root work, but nothing proportional to the world count.
    assert!(
        large <= small + ROOTS,
        "load() ran {small} statements for {} worlds but {large} for {} worlds. \
         A count that grows with the world count is the N+1 pattern this guards against.",
        ROOTS * 2,
        ROOTS * 16
    );

    // Sanity: the fixture really did grow, so the assertion above is meaningful.
    let repo = Repository::open(&large_path).map_err(|e| e.to_string())?;
    let library = repo.load().map_err(|e| e.to_string())?;
    let worlds: usize = library.roots.iter().map(|r| r.worlds.len()).sum();
    assert_eq!(worlds, ROOTS * 16);

    drop((small_temp, large_temp));
    Ok(())
}

#[test]
fn load_is_constant_in_statement_count_across_a_large_archive(
) -> Result<(), Box<dyn std::error::Error>> {
    // A second, wider check: doubling the roots must not multiply statements per
    // root. Guards against reintroducing a per-root prepare.
    let (small_temp, small_path) = archive(2, 4)?;
    let (large_temp, large_path) = archive(32, 4)?;

    let small = statements_for_load(&small_path)?;
    let large = statements_for_load(&large_path)?;

    assert!(
        large <= small + 4,
        "load() ran {small} statements for 2 roots but {large} for 32 roots; \
         per-root statements would scale with the root count."
    );

    drop((small_temp, large_temp));
    Ok(())
}
