//! Read-only timing of the same discovery/scanner pipeline used by the app.
use minechronicle_lib::{
    database::Repository,
    launcher::pcl_folders,
    scanner::{discover_and_scan_linked, GameRootScanner, ScanLimits},
};
use std::time::{Duration, Instant};
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let link = pcl_folders::discover()?;
    println!("{}", serde_json::to_string(&link)?);
    let roots: Vec<_> = link.folders.iter().map(|f| f.path.clone()).collect();
    let started = Instant::now();
    let launcher = if !std::env::args().any(|a| a == "--unlinked") && link.launchers.len() == 1 {
        link.launchers.first().map(|p| p.as_path())
    } else {
        None
    };
    let mut callbacks = 0;
    let report = discover_and_scan_linked(&roots, launcher, |_| {
        callbacks += 1;
        started.elapsed() < Duration::from_secs(90)
    });
    println!(
        "discovery_ms={} callbacks={} roots={} worlds={} instances={} issues={} cancelled={}",
        started.elapsed().as_millis(),
        callbacks,
        report.roots.len(),
        report.roots.iter().map(|r| r.worlds.len()).sum::<usize>(),
        report.instances.len(),
        report.issues.len(),
        report.cancelled
    );
    for folder in &link.folders {
        println!(
            "{}: {} instances",
            folder.name,
            report
                .instances
                .iter()
                .filter(|i| i.instance_path.parent().and_then(|p| p.parent())
                    == Some(folder.path.as_path()))
                .count()
        );
    }
    if let Some(path) = std::env::args().nth(1).filter(|s| !s.starts_with("--")) {
        let repo = Repository::open(std::path::Path::new(&path))?;
        let saved = repo.load()?;
        for folder in &link.folders {
            println!(
                "saved {}: {}",
                folder.name,
                saved
                    .instances
                    .iter()
                    .filter(|i| i.instance_path.parent().and_then(|p| p.parent())
                        == Some(folder.path.as_path()))
                    .count()
            );
        }
        let paths: Vec<_> = saved.roots.into_iter().map(|r| r.path).collect();
        let start = Instant::now();
        let scan = GameRootScanner {
            limits: ScanLimits {
                roots: 256,
                ..Default::default()
            },
        }
        .scan(&paths, |_| true);
        println!(
            "saved_root_scan_ms={} worlds={}",
            start.elapsed().as_millis(),
            scan.roots.iter().map(|r| r.worlds.len()).sum::<usize>()
        );
        let warm = Instant::now();
        let scan = GameRootScanner {
            limits: ScanLimits {
                roots: 256,
                ..Default::default()
            },
        }
        .scan(&paths, |_| true);
        println!(
            "warm_root_scan_ms={} worlds={}",
            warm.elapsed().as_millis(),
            scan.roots.iter().map(|r| r.worlds.len()).sum::<usize>()
        );
    }
    Ok(())
}
