#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    if let Err(error) = minechronicle_lib::run() {
        eprintln!("MineChronicle could not start: {error}");
        std::process::exit(1);
    }
}
