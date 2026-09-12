//! Explicit scoped recovery of missed save updates. Preserve configured inputs,
//! initial baselines and unrelated roots; do not invent observation timestamps.
use minechronicle_lib::{
    database::{read_models::ScanSummary, Repository},
    scanner::{local_names, GameRootScanner},
};
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut args = std::env::args_os().skip(1);
    let database = PathBuf::from(
        args.next()
            .ok_or("Usage: reconcile_roots <archive> <root>...")?,
    );
    let roots: Vec<_> = args.map(PathBuf::from).collect();
    if roots.is_empty() || roots.len() > 32 {
        return Err("Provide 1–32 explicit roots".into());
    }
    let mut repo = Repository::open(&database)?;
    let inputs = repo.inputs()?;
    let scopes: Vec<_> = inputs
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .collect();
    let mut summary: ScanSummary = GameRootScanner::default().scan(&roots, |_| true).into();
    if summary.cancelled || summary.roots.is_empty() {
        return Err("Recovery scan did not complete".into());
    }
    for root in &mut summary.roots {
        let names = local_names(&root.path, &scopes, &mut summary.issues);
        for player in root.worlds.iter_mut().flat_map(|w| &mut w.players) {
            if let Some(name) = names.get(&uuid::Uuid::parse_str(&player.uuid)?) {
                player.preferred_name = Some(name.clone());
                player.name_source = Some("usercache".into());
            }
        }
    }
    // Retain unrelated diagnostics, matching the background tracker.
    let library = repo.load()?;
    summary
        .issues
        .extend(library.issues.into_iter().filter(|issue| {
            !summary
                .roots
                .iter()
                .any(|root| issue.path.starts_with(&root.path))
        }));
    repo.import(&summary, &inputs)?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "reconciled_roots": summary.roots.iter().map(|r| &r.path).collect::<Vec<_>>(),
            "scan_revision": repo.scan_revision()?,
            "historical_ticks": repo.load()?.historical_ticks,
            "tracking": repo.tracking_summary()?
        }))?
    );
    Ok(())
}
