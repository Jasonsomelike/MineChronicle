//! Attribute statistics() cost and check whether the result is stable.
//!
//! The audit measured ~24 ms of JSON parsing for 63k stat entries. This times
//! the whole call, then a page at a different offset, to show whether cost
//! scales with the page position (it should not, since every call rebuilds the
//! full aggregate before paginating).
use minechronicle_lib::database::{
    activity::{StatisticsFilter, StatisticsPage},
    Repository,
};
use std::time::Instant;

fn time_call(
    repo: &Repository,
    filter: &StatisticsFilter,
    runs: u32,
) -> Result<(f64, StatisticsPage), Box<dyn std::error::Error + Send + Sync>> {
    let started = Instant::now();
    let mut page = None;
    for _ in 0..runs {
        page = Some(repo.statistics(filter)?);
    }
    Ok((
        started.elapsed().as_secs_f64() * 1000.0 / f64::from(runs),
        page.ok_or("no result")?,
    ))
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: bench_statistics <db>")?;
    let repo = Repository::open(std::path::Path::new(&path))?;

    // Warm once so the first call's lazy work is not attributed to the average.
    let _ = repo.statistics(&StatisticsFilter {
        mode: "current".into(),
        ..Default::default()
    })?;

    for (label, mode) in [("current", "current"), ("initial", "initial")] {
        let filter = StatisticsFilter {
            mode: mode.into(),
            ..Default::default()
        };
        let (ms, page) = time_call(&repo, &filter, 20)?;
        println!(
            "{label:8} statistics(): {ms:6.2} ms   rows {} / total {}   categories {}",
            page.rows.len(),
            page.total,
            page.categories.len()
        );
    }

    // Does a later page cost the same? It should if the whole aggregate is
    // rebuilt before pagination.
    for offset in [0u32, 100, 5000] {
        let filter = StatisticsFilter {
            mode: "current".into(),
            offset,
            ..Default::default()
        };
        let (ms, page) = time_call(&repo, &filter, 20)?;
        println!(
            "offset {offset:5}: {ms:6.2} ms   returned {} rows (total {})",
            page.rows.len(),
            page.total
        );
    }

    // Group filtering happens after the aggregate too.
    for group in ["all", "mined", "custom"] {
        let filter = StatisticsFilter {
            mode: "current".into(),
            group: group.into(),
            ..Default::default()
        };
        let (ms, page) = time_call(&repo, &filter, 20)?;
        println!(
            "group {group:8}: {ms:6.2} ms   returned {} rows (total {})",
            page.rows.len(),
            page.total
        );
    }
    Ok(())
}
