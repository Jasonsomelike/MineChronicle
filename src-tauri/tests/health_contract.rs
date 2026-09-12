mod support;
use minechronicle_lib::{
    database::{read_models::ScanSummary, DbResult, Repository},
    minecraft::level_dat::LevelDatReader,
    scanner::{GameRootScanner, ScanIssueKind},
};
use std::{fs, path::Path};
use support::*;
fn db<T>(r: DbResult<T>) -> Result<T, Box<dyn std::error::Error>> {
    r.map_err(|e| e as _)
}
fn import(repo: &mut Repository, root: &Path) -> TestResult {
    db(repo.import(
        &GameRootScanner::default()
            .scan(&[root.to_owned()], |_| true)
            .into(),
        &[root.to_owned()],
    ))?;
    Ok(())
}
#[test]
fn candidates_require_uuid_content_nontrivial_time_and_metadata() -> TestResult {
    let (temp, root) = game()?;
    for (name, title, uuid, ticks) in [
        ("a", "Shared", PLAYER, 100_000),
        ("b", "Shared", PLAYER, 100_000),
        ("different-name", "Other", PLAYER, 100_000),
        ("different-player", "Shared", OTHER, 100_000),
        ("different-stat", "Shared", PLAYER, 100_001),
        ("zero-a", "Zero", PLAYER, 0),
        ("zero-b", "Zero", PLAYER, 0),
    ] {
        let world = root.join("saves").join(name);
        level(&world, title)?;
        stats(&world, "stats", uuid, ticks)?;
    }
    let mut repo = db(Repository::open(&temp.path().join("archive.sqlite3")))?;
    import(&mut repo, &root)?;
    import(&mut repo, &root)?;
    let health = db(repo.health_summary())?;
    assert_eq!(health.candidates.len(), 1);
    let candidate = &health.candidates[0];
    assert_eq!(candidate.status, "pending");
    assert_eq!(candidate.evidence[0].ticks, "100000");
    assert_eq!(candidate.evidence[0].uuid, PLAYER);
    assert_eq!(candidate.evidence[0].stats_hash.len(), 64);
    assert_eq!(db(repo.load())?.historical_ticks, "500001");
    assert!(db(repo.tracking_summary())?.players.is_empty());
    Ok(())
}
#[test]
fn clone_decisions_persist_without_inventing_inherited_time_and_can_be_undone() -> TestResult {
    let (temp, root) = game()?;
    for name in ["a", "b"] {
        let world = root.join("saves").join(name);
        level(&world, "Shared")?;
        stats(&world, "stats", PLAYER, 100_000)?;
    }
    let path = temp.path().join("archive.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    import(&mut repo, &root)?;
    let health = db(repo.health_summary())?;
    let c = &health.candidates[0];
    let id = c.id;
    let parent = c.world_a.id;
    assert!(repo.decide_clone(id, "confirmed", None).is_err());
    db(repo.decide_clone(id, "deferred", None))?;
    import(&mut repo, &root)?;
    assert_eq!(db(repo.health_summary())?.candidates[0].status, "deferred");
    db(repo.decide_clone(id, "confirmed", Some(parent)))?;
    drop(repo);
    let mut repo = db(Repository::open(&path))?;
    let h = db(repo.health_summary())?;
    assert_eq!(h.confirmed_lineages, 1);
    assert_eq!(
        h.candidates[0].inherited_confidence.as_deref(),
        Some("unknown")
    );
    assert_eq!(h.candidates[0].parent_world_id, Some(parent));
    assert_eq!(db(repo.load())?.historical_ticks, "200000");
    assert!(db(repo.tracking_summary())?.players.is_empty());
    import(&mut repo, &root)?;
    assert_eq!(db(repo.health_summary())?.candidates[0].status, "confirmed");
    db(repo.decide_clone(id, "pending", None))?;
    assert_eq!(db(repo.health_summary())?.confirmed_lineages, 0);
    db(repo.decide_clone(id, "rejected", None))?;
    import(&mut repo, &root)?;
    assert_eq!(db(repo.health_summary())?.candidates[0].status, "rejected");
    Ok(())
}
#[test]
fn lineage_cycles_are_rejected_transactionally() -> TestResult {
    let (temp, root) = game()?;
    for name in ["a", "b", "c"] {
        let w = root.join("saves").join(name);
        level(&w, "Shared")?;
        stats(&w, "stats", PLAYER, 100_000)?;
    }
    let mut repo = db(Repository::open(&temp.path().join("db.sqlite3")))?;
    import(&mut repo, &root)?;
    let h = db(repo.health_summary())?;
    let mut pairs = h
        .candidates
        .iter()
        .map(|c| ((c.world_a.id, c.world_b.id), c.id))
        .collect::<std::collections::BTreeMap<_, _>>();
    let ids: std::collections::BTreeSet<_> = h
        .candidates
        .iter()
        .flat_map(|c| [c.world_a.id, c.world_b.id])
        .collect();
    let ids: Vec<_> = ids.into_iter().collect();
    let (a, b, c) = (ids[0], ids[1], ids[2]);
    db(repo.decide_clone(
        pairs.remove(&(a, b)).ok_or("missing pair")?,
        "confirmed",
        Some(a),
    ))?;
    db(repo.decide_clone(
        pairs.remove(&(b, c)).ok_or("missing pair")?,
        "confirmed",
        Some(b),
    ))?;
    assert!(repo
        .decide_clone(
            *pairs.get(&(a, c)).ok_or("missing pair")?,
            "confirmed",
            Some(c)
        )
        .is_err());
    assert_eq!(db(repo.health_summary())?.confirmed_lineages, 2);
    Ok(())
}
#[test]
fn health_reviews_are_durable_and_missing_world_is_detected_beside_empty_stats() -> TestResult {
    let (temp, root) = game()?;
    let a = root.join("saves/a");
    let b = root.join("saves/b");
    level(&a, "A")?;
    level(&b, "B")?;
    stats(&a, "stats", PLAYER, 100)?;
    stats(&b, "stats", OTHER, 200)?;
    let path = temp.path().join("archive.sqlite3");
    let mut repo = db(Repository::open(&path))?;
    import(&mut repo, &root)?;
    stats(&a, "stats", PLAYER, 90)?;
    import(&mut repo, &root)?;
    fs::write(a.join(format!("stats/{PLAYER}.json")), b"")?;
    fs::remove_dir_all(&b)?;
    import(&mut repo, &root)?;
    let h = db(repo.health_summary())?;
    assert!(h.items.iter().any(|i| i.kind == "WORLD_MISSING"));
    assert!(h.items.iter().any(|i| i.kind == "STAT_ROLLBACK"));
    assert!(h.items.iter().any(|i| i.kind == "UNRESOLVED_PLAYER"));
    assert!(!h.items.iter().any(|i| i.kind == "EMPTY_STATS"));
    let key = h
        .items
        .iter()
        .find(|i| i.kind == "STAT_ROLLBACK")
        .ok_or("rollback missing")?
        .key
        .clone();
    let pending = h.pending_count;
    db(repo.review_health(&key, true))?;
    drop(repo);
    let repo = db(Repository::open(&path))?;
    assert_eq!(db(repo.health_summary())?.pending_count, pending - 1);
    assert_eq!(db(repo.load())?.historical_ticks, "300");
    Ok(())
}
#[test]
fn metadata_seed_changes_are_not_hidden_by_cache() -> TestResult {
    let first = LevelDatReader.parse(&nbt("Seed")?)?;
    let mut changed = first.clone();
    changed.seed = Some(42);
    assert_ne!(first.fingerprint(), changed.fingerprint());
    let missing = LevelDatReader.parse(&fastnbt::to_bytes(&serde_json::json!({"Data":{}}))?)?;
    assert!(missing.fingerprint().is_none());
    Ok(())
}
#[test]
fn unsupported_and_corrupted_sources_remain_distinct_health_items() -> TestResult {
    let (temp, root) = game()?;
    let w = root.join("saves/w");
    level(&w, "Health")?;
    stats(&w, "stats", PLAYER, 120)?;
    let mut summary: ScanSummary = GameRootScanner::default()
        .scan(std::slice::from_ref(&root), |_| true)
        .into();
    for kind in [
        ScanIssueKind::CorruptedStats,
        ScanIssueKind::UnknownStatsFormat,
        ScanIssueKind::InaccessibleDirectory,
    ] {
        summary.issues.push(minechronicle_lib::scanner::ScanIssue {
            kind,
            path: fs::canonicalize(&w)?.join(format!("stats/{PLAYER}.json")),
            message: "Synthetic issue".into(),
        });
    }
    let mut repo = db(Repository::open(&temp.path().join("db.sqlite3")))?;
    db(repo.import(&summary, &[root]))?;
    let h = db(repo.health_summary())?;
    for kind in [
        "CORRUPTED_STATS",
        "UNKNOWN_STATS_FORMAT",
        "INACCESSIBLE_DIRECTORY",
    ] {
        let item = h
            .items
            .iter()
            .find(|i| i.kind == kind)
            .ok_or("missing health item")?;
        assert_eq!(item.target, fs::canonicalize(&w)?.to_string_lossy());
    }
    Ok(())
}
