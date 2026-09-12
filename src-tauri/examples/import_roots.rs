//! Explicit maintenance import; uses the same scanner and repository as the desktop command.
use minechronicle_lib::{
    database::{read_models::ScanSummary, Repository},
    scanner::{discover_and_scan, local_names},
};
use std::path::PathBuf;
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut args = std::env::args_os().skip(1);
    let database = PathBuf::from(
        args.next()
            .ok_or("Usage: import_roots <database> <root>...")?,
    );
    let roots: Vec<PathBuf> = args.map(PathBuf::from).collect();
    if roots.is_empty() || roots.len() > 32 {
        return Err("Provide 1–32 explicit roots".into());
    }
    let mut summary: ScanSummary = discover_and_scan(&roots, |_| true).into();
    let scopes: Vec<_> = roots
        .iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .collect();
    for root in &mut summary.roots {
        let names = local_names(&root.path, &scopes, &mut summary.issues);
        for world in &mut root.worlds {
            for player in &mut world.players {
                if let Some(name) = names.get(&uuid::Uuid::parse_str(&player.uuid)?) {
                    player.preferred_name = Some(name.clone());
                    player.name_source = Some("usercache".into());
                }
            }
        }
    }
    let mut repository = Repository::open(&database)?;
    repository.import(&summary, &roots)?;
    let saved = repository.load()?;
    println!(
        "Saved {} roots, {} worlds, {} PCL instances; {} scan issues",
        saved.roots.len(),
        saved.roots.iter().map(|r| r.worlds.len()).sum::<usize>(),
        saved.instances.len(),
        saved.issues.len()
    );
    Ok(())
}
