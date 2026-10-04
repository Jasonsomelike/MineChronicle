//! 生成一份带合成数据的示例档案数据库，供新用户在导入自己的存档前体验界面。
//!
//! 数据全部虚构：游戏根目录在临时目录里现场生成（level.dat + stats JSON），
//! 走与正式扫描完全相同的 GameRootScanner → Repository::import 管线，因此
//! schema 永远与当前代码一致。生成后随 Release 分发；schema 变更时重新
//! 生成一份即可。
//!
//! 在仓库根目录运行：
//!
//!   cargo run --release --manifest-path src-tauri/Cargo.toml --example sample_db -- sample/minechronicle-sample.sqlite3

use flate2::{write::GzEncoder, Compression};
use minechronicle_lib::{
    commands::ScanSummary, database::Repository, launcher::running::ActiveInstance,
    scanner::GameRootScanner,
};
use serde::Serialize;
use std::{
    fs,
    io::Write as _,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

// 公开的示例身份（Mojang 官方展示账号），别名在导入后用 set_alias 指定。
const STEVE: &str = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const ALEX: &str = "86799e70-3e57-44b2-a5e4-3e5a08f7b9f0";

#[derive(Serialize)]
struct Root {
    #[serde(rename = "Data")]
    data: Data,
}
#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct Data {
    level_name: String,
    data_version: i32,
    version: Version,
    last_played: i64,
}
#[derive(Serialize)]
struct Version {
    #[serde(rename = "Name")]
    name: String,
}

/// 写出一个存档的 level.dat，并返回存档目录。1.13 起统计移入 players/stats，
/// 旧版直接在 stats/，两种布局各生成一份玩家读数以覆盖两代格式。
fn world(
    root: &Path,
    name: &str,
    data_version: i32,
    version: &str,
    last_played: i64,
) -> Result<PathBuf> {
    let directory = root.join("saves").join(name);
    let stats = if data_version >= 1466 {
        "players/stats"
    } else {
        "stats"
    };
    fs::create_dir_all(directory.join(stats))?;
    let nbt = fastnbt::to_bytes(&Root {
        data: Data {
            level_name: name.to_owned(),
            data_version,
            version: Version {
                name: version.to_owned(),
            },
            last_played,
        },
    })?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(&nbt)?;
    fs::write(directory.join("level.dat"), encoder.finish()?)?;
    Ok(directory)
}

fn player_ticks(world: &Path, layout_modern: bool, uuid: &str, ticks: i64) -> Result<()> {
    let stats = if layout_modern {
        "players/stats"
    } else {
        "stats"
    };
    fs::write(
        world.join(stats).join(format!("{uuid}.json")),
        serde_json::json!({"stats":{"minecraft:custom":{"minecraft:play_time":ticks}}}).to_string(),
    )?;
    Ok(())
}

fn main() -> Result<()> {
    let output = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("sample/minechronicle-sample.sqlite3"));
    if output.exists() {
        fs::remove_file(&output)?;
    }

    let temp = tempfile::tempdir()?;
    let root = temp.path().to_path_buf();
    let changfeng = world(&root, "长风谷", 3953, "1.21", 1_787_000_000_000)?;
    player_ticks(&changfeng, true, STEVE, 402_000)?;
    player_ticks(&changfeng, true, ALEX, 36_000)?;
    let jiuri = world(&root, "旧日矿道", 1343, "1.12.2", 1_786_000_000_000)?;
    player_ticks(&jiuri, false, STEVE, 72_000)?;
    let kongdao = world(&root, "空岛余晖", 3953, "1.21", 1_786_500_000_000)?;
    player_ticks(&kongdao, true, ALEX, 144_000)?;

    let report = GameRootScanner::default().scan(std::slice::from_ref(&root), |_| true);
    if !report.issues.is_empty() {
        return Err(format!("示例游戏根目录应能干净扫描: {:?}", report.issues).into());
    }

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut repository = Repository::open(&output)?;
    let summary = ScanSummary::from(report);
    repository.import(&summary, &[root])?;
    repository.set_alias(STEVE, "Steve")?;
    repository.set_alias(ALEX, "Alex")?;
    repository.set_setting("self_player_identity", "Steve")?;
    // 留下一条已结束的观测时段，让观测页不为空。
    repository.observe_instances(&[ActiveInstance {
        game_root: temp.path().join("launcher"),
        name: "示例启动器实例".into(),
        pids: vec![4242],
    }])?;
    repository.observe_instances(&[])?;
    let library = repository.load()?;
    drop(repository);

    // 干净收尾：确认没有遗留 WAL 旁路文件，示例库保持单文件可分发。
    for suffix in ["-wal", "-shm"] {
        let sidecar = output.with_extension(format!("sqlite3{suffix}"));
        if sidecar.exists() {
            let connection = rusqlite::Connection::open(&output)?;
            connection
                .pragma_update(None, "wal_checkpoint", "TRUNCATE")
                .ok();
            drop(connection);
            fs::remove_file(&sidecar).ok();
        }
    }

    let connection = rusqlite::Connection::open(&output)?;
    let players: i64 =
        connection.query_row("SELECT COUNT(*) FROM players", [], |row| row.get(0))?;
    println!("示例数据库已生成：{}", output.display());
    println!(
        "  体积 {} 字节，{} 个世界，players 表 {} 行",
        fs::metadata(&output).map(|m| m.len()).unwrap_or(0),
        library
            .roots
            .iter()
            .map(|root| root.worlds.len())
            .sum::<usize>(),
        players
    );
    println!("使用方式见 README 的「示例数据库」一节。");
    Ok(())
}
