//! Print archive read models for local diagnostics; never scans Minecraft files.
use minechronicle_lib::database::{activity::StatisticsFilter, Repository};
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Usage: inspect_archive <database> [query] [sort] [offset] [uuid]")?;
    let repo = Repository::open(std::path::Path::new(&path))?;
    let filter = if std::env::args().nth(2).as_deref() == Some("--filter") {
        serde_json::from_str(&std::env::args().nth(3).ok_or("Missing filter JSON")?)?
    } else {
        StatisticsFilter {
            query: std::env::args().nth(2).unwrap_or_default(),
            sort: std::env::args().nth(3).unwrap_or_default(),
            offset: std::env::args()
                .nth(4)
                .unwrap_or_default()
                .parse()
                .unwrap_or_default(),
            uuid: std::env::args().nth(5).unwrap_or_default(),
            ..Default::default()
        }
    };
    let statistics = repo.statistics(&filter)?;
    println!(
        "{}",
        serde_json::to_string(
            &serde_json::json!({"report":repo.load()?,"inputs":repo.inputs()?,"tracking":repo.tracking_summary()?,"health":repo.health_summary()?,"timeline":repo.timeline(&Default::default())?,"statistics":statistics,"pcl_last_synced":repo.setting("pcl_last_synced")?})
        )?
    );
    Ok(())
}
