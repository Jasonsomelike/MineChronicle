mod support;
use minechronicle_lib::{
    database::read_models::ScanSummary,
    scanner::{discover_and_scan, stable_stats::read_stats, GameRootScanner, ScanIssueKind},
    tracker::watcher::affected_roots,
};
use std::{collections::HashSet, fs};
use support::*;

#[test]
fn known_versions_do_not_descend_into_arbitrary_mod_data() -> TestResult {
    let (_temp, root) = game()?;
    level(&root.join("versions/Pack/saves/Real"), "Real")?;
    level(
        &root.join("versions/Pack/mod-generated-data/deep/saves/Fake"),
        "Fake",
    )?;
    level(&root.join("unrelated-cache/deep/saves/Fake"), "Fake")?;
    let report = discover_and_scan(&[root], |_| true);
    let names: Vec<_> = report
        .roots
        .iter()
        .flat_map(|r| &r.worlds)
        .map(|w| w.name.as_str())
        .collect();
    assert_eq!(names, ["Real"]);
    Ok(())
}

#[test]
fn an_exhausted_input_does_not_consume_the_next_inputs_budget() -> TestResult {
    let (temp, root) = game()?;
    for i in 0..10_001 {
        fs::write(root.join(format!("cache-{i}")), [])?;
    }
    let other = temp.path().join("Other");
    level(&other.join("nested/saves/Reachable"), "Reachable")?;
    let report = discover_and_scan(&[root, other], |_| true);
    assert!(report
        .issues
        .iter()
        .any(|i| i.kind == ScanIssueKind::ScanLimitReached));
    assert!(report
        .roots
        .iter()
        .flat_map(|r| &r.worlds)
        .any(|w| w.name == "Reachable"));
    Ok(())
}

#[test]
fn events_select_only_the_most_specific_root_without_prefix_collisions() -> TestResult {
    let (temp, root) = game()?;
    let nested = root.join("versions/Pack");
    level(&nested.join("saves/World"), "Nested")?;
    let report: ScanSummary = GameRootScanner::default()
        .scan(&[root.clone(), nested.clone()], |_| true)
        .into();
    let events = HashSet::from([nested.join("saves/World/stats/new.json")]);
    assert_eq!(
        affected_roots(&report, &events),
        [fs::canonicalize(&nested)?]
    );
    let unrelated = HashSet::from([temp.path().join("GameRoot-other/saves/world")]);
    assert!(affected_roots(&report, &unrelated).is_empty());
    let parent_event = HashSet::from([root.join("saves/new")]);
    assert_eq!(
        affected_roots(&report, &parent_event),
        [fs::canonicalize(root)?]
    );
    Ok(())
}

#[test]
fn cached_stats_detect_same_size_rewrites_with_preserved_timestamps() -> TestResult {
    let (_temp, root) = game()?;
    stats(&root, "stats", PLAYER, 100)?;
    let path = root.join(format!("stats/{PLAYER}.json"));
    let before = fs::metadata(&path)?;
    assert_eq!(read_stats(&path).map_err(|e| e.1)?.play_ticks, 100);
    stats(&root, "stats", PLAYER, 200)?;
    fs::OpenOptions::new()
        .write(true)
        .open(&path)?
        .set_times(fs::FileTimes::new().set_modified(before.modified()?))?;
    assert_eq!(fs::metadata(&path)?.len(), before.len());
    assert_eq!(fs::metadata(&path)?.modified()?, before.modified()?);
    assert_eq!(read_stats(&path).map_err(|e| e.1)?.play_ticks, 200);
    Ok(())
}

/// A file that cannot improve by waiting must not pay the retry loop.
///
/// `read_stats` retries up to four times with 100 ms sleeps, which measured
/// ~300 ms per call versus ~1 ms for a healthy file. Retrying is only useful for
/// a write in progress, so a missing file (and a file unchanged for over five
/// seconds) must return on the first attempt. The scan visits every stats file
/// it can see, so a wasted 300 ms per missing file is a real scan-time cost.
#[test]
fn unreadable_stats_do_not_pay_the_retry_delay() -> TestResult {
    use std::time::{Duration, Instant};

    let (_temp, root) = game()?;
    fs::create_dir_all(root.join("stats"))?;

    // A missing file will not appear because we waited.
    let missing = root.join("stats/absent.json");
    let started = Instant::now();
    assert!(read_stats(&missing).is_err());
    let missing_ms = started.elapsed();

    // A stable empty file: written, then aged past the settle window.
    let empty = root.join("stats/empty.json");
    fs::write(&empty, b"")?;
    let old = std::time::SystemTime::now() - Duration::from_secs(60);
    fs::OpenOptions::new()
        .write(true)
        .open(&empty)?
        .set_times(fs::FileTimes::new().set_modified(old))?;
    let started = Instant::now();
    let error = read_stats(&empty);
    let empty_ms = started.elapsed();
    let kind = match error {
        Err((kind, _)) => kind,
        Ok(_) => return Err("an empty file must be reported, not parsed".into()),
    };
    assert_eq!(
        kind,
        ScanIssueKind::EmptyStats,
        "an aged empty file is still reported as empty, just not retried"
    );

    // Both must be far below one retry sleep (100 ms), let alone three.
    for (label, elapsed) in [("missing", missing_ms), ("aged empty", empty_ms)] {
        assert!(
            elapsed < Duration::from_millis(100),
            "{label} took {elapsed:?}; it should not have entered the retry loop"
        );
    }
    Ok(())
}

/// A recently written, still-empty file IS worth retrying: that is a Minecraft
/// write in progress, which is what the loop exists for.
#[test]
fn a_freshly_written_empty_file_still_retries() -> TestResult {
    use std::time::{Duration, Instant};

    let (_temp, root) = game()?;
    fs::create_dir_all(root.join("stats"))?;
    let fresh = root.join("stats/fresh.json");
    fs::write(&fresh, b"")?;

    let started = Instant::now();
    let _ = read_stats(&fresh);
    let elapsed = started.elapsed();
    assert!(
        elapsed >= Duration::from_millis(250),
        "a fresh empty file should still be retried, took {elapsed:?}"
    );
    Ok(())
}
