fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("Usage: migrate_archive <app-data-directory> <target-database>".into());
    }
    let path = minechronicle_lib::database::storage::migrate_archive(
        std::path::Path::new(&args[0]),
        std::path::Path::new(&args[1]),
    )?;
    println!("Archive migrated and verified: {}", path.display());
    Ok(())
}
