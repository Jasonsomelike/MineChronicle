//! Read-only process matching diagnostic. The fixture branch is for native lifecycle verification.
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if std::env::args().any(|a| a == "--fixture") {
        std::thread::sleep(std::time::Duration::from_secs(30));
        return Ok(());
    }
    let games =
        minechronicle_lib::launcher::running::running_games().map_err(std::io::Error::other)?;
    let archive = std::env::args_os()
        .nth(1)
        .ok_or("Usage: inspect_running <archive>")?;
    let instances = minechronicle_lib::database::Repository::open(std::path::Path::new(&archive))?
        .load_instances()?;
    println!(
        "{}",
        serde_json::to_string(&minechronicle_lib::launcher::running::match_instances(
            &games, &instances
        ))?
    );
    Ok(())
}
