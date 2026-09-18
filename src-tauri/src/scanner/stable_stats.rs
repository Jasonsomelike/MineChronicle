use super::ScanIssueKind;
use crate::{
    domain::NormalizedPlayerStats,
    minecraft::{
        level_dat::read_bounded, JsonStatsParser, StatsParseError, StatsParser, MAX_STATS_BYTES,
    },
};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};
type Cached = HashMap<blake3::Hash, (usize, NormalizedPlayerStats)>;
static CACHE: OnceLock<Mutex<Cached>> = OnceLock::new();
fn parse_cached(bytes: &[u8]) -> Result<NormalizedPlayerStats, StatsParseError> {
    // Hash the actual bytes every time: preserved timestamps and same-size
    // rewrites must not hide changed statistics.
    let hash = blake3::hash(bytes);
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(values) = cache.lock() {
        if let Some((_, stats)) = values.get(&hash) {
            return Ok(stats.clone());
        }
    }
    let parsed = JsonStatsParser.parse(bytes)?;
    if let Ok(mut values) = cache.lock() {
        if values.len() >= 512
            || values.values().map(|v| v.0).sum::<usize>() + bytes.len() > 32 * 1024 * 1024
        {
            values.clear();
        }
        values.insert(hash, (bytes.len(), parsed.clone()));
    }
    Ok(parsed)
}

/// Initial attempt plus at most three retries for interrupted/truncated writes.
///
/// Retrying is only useful when the file might still be being written. Measured
/// cost of a retried call is ~300 ms (four reads with 100 ms sleeps) versus
/// ~4.5 ms for a healthy one, so the cases that cannot improve by waiting return
/// immediately:
///
///   - the file does not exist (it will not appear because we waited)
///   - the file is empty but unchanged for over 5 seconds (a stable empty file)
///   - the format is unsupported (retrying cannot change the structure)
///
/// A file that is empty or unparseable *and recently modified* still retries:
/// that is the case the loop exists for, and a Minecraft write in progress is
/// exactly what it looks like.
pub fn read_stats(path: &Path) -> Result<NormalizedPlayerStats, (ScanIssueKind, String)> {
    let mut failure = (ScanIssueKind::CorruptedStats, String::new());
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(100));
        }
        failure = match read_bounded(path, MAX_STATS_BYTES) {
            Ok(bytes) if bytes.iter().all(u8::is_ascii_whitespace) => {
                let error = (
                    ScanIssueKind::EmptyStats,
                    "统计文件为空，尚无可读取的数据；写入有效内容后会自动重试。".into(),
                );
                if file_is_stale(path) {
                    return Err(error);
                }
                error
            }
            Ok(bytes) => match parse_cached(&bytes) {
                Ok(stats) => return Ok(stats),
                Err(StatsParseError::InvalidJson { line, column }) => {
                    let error = (
                        ScanIssueKind::CorruptedStats,
                        format!("统计文件尚未写完或已损坏（第 {line} 行，第 {column} 列），重试后仍无法读取；已保留已有历史。"),
                    );
                    // A truncated write is worth retrying only while the file is
                    // still changing; an old one will not repair itself.
                    if file_is_stale(path) {
                        return Err(error);
                    }
                    error
                }
                Err(StatsParseError::UnknownFormat) => {
                    return Err((
                        ScanIssueKind::UnknownStatsFormat,
                        "尚不支持此统计结构，未把未知时长当作零。".into(),
                    ))
                }
                Err(e) => {
                    return Err((
                        ScanIssueKind::CorruptedStats,
                        format!("统计数据无效：{e}。已有历史保留。"),
                    ))
                }
            },
            Err(e) => {
                let error = (
                    ScanIssueKind::CorruptedStats,
                    format!("统计文件暂时无法读取：{e}。已有历史保留。"),
                );
                // A missing file is the common case here (a world whose player
                // has not written stats yet) and sleeping cannot fix it.
                if !path.exists() {
                    return Err(error);
                }
                error
            }
        };
    }
    Err(failure)
}

/// Whether a file has been unchanged long enough that retrying is pointless.
///
/// Returns true when the mtime is more than 5 seconds old. A file whose mtime
/// cannot be read is treated as stale, because an unreadable mtime gives no
/// reason to expect the next attempt to differ.
fn file_is_stale(path: &Path) -> bool {
    const SETTLE: Duration = Duration::from_secs(5);
    match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(modified) => SystemTime::now()
            .duration_since(modified)
            .is_ok_and(|age| age > SETTLE),
        Err(_) => true,
    }
}
