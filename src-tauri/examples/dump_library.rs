//! Dumps the full load() result as pretty JSON.
//!
//! Used to prove a load() refactor is behaviour-preserving: run it against the
//! same archive copy before and after the change and compare the SHA-256 of the
//! output (the `database_path` field reflects the argument, so use one path).
//!
//! ```text
//! cargo run --release --example dump_library -- path/to/archive-copy.sqlite3 > after.json
//! ```
use minechronicle_lib::database::Repository;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: dump_library <archive.sqlite3>")?;
    let repo = Repository::open(std::path::Path::new(&path))?;
    let library = repo.load()?;
    // Pretty-print so a textual diff points at the exact differing field.
    println!("{}", serde_json::to_string_pretty(&library)?);
    Ok(())
}
