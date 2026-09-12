use minechronicle_lib::{
    database::{read_models::ScanSummary, Repository},
    launcher::pcl_folders,
    scanner::discover_and_scan_linked,
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let link = pcl_folders::discover()?;
    println!("{}", serde_json::to_string_pretty(&link)?);
    let paths = link
        .folders
        .iter()
        .map(|f| f.path.clone())
        .collect::<Vec<_>>();
    let launcher = if link.launchers.len() == 1 {
        Some(link.launchers[0].as_path())
    } else {
        None
    };
    let report = discover_and_scan_linked(&paths, launcher, |_| true);
    for folder in &link.folders {
        let instances = report
            .instances
            .iter()
            .filter(|i| {
                i.instance_path.parent().and_then(|p| p.parent()) == Some(folder.path.as_path())
            })
            .collect::<Vec<_>>();
        println!("{}: {} instances", folder.name, instances.len());
        for instance in instances {
            println!(
                "  {} | {:?} | {:?}",
                instance.name, instance.minecraft_version, instance.mod_loader
            );
        }
    }
    println!(
        "{} roots; {} issues",
        report.roots.len(),
        report.issues.len()
    );
    for issue in report.issues.iter().take(10) {
        println!("{:?}: {}", issue.kind, issue.message);
    }
    if let Some(database) = std::env::args().nth(1) {
        let summary: ScanSummary = report.into();
        let mut repo =
            Repository::open(std::path::Path::new(&database)).map_err(|e| e.to_string())?;
        repo.import(&summary, &paths).map_err(|e| e.to_string())?;
        println!("Archive imported");
    }
    Ok(())
}
