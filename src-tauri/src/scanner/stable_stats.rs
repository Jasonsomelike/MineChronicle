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
pub fn read_stats(path: &Path) -> Result<NormalizedPlayerStats, (ScanIssueKind, String)> {
    let mut failure = (ScanIssueKind::CorruptedStats, String::new());
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(100));
        }
        failure=match read_bounded(path,MAX_STATS_BYTES) {
            Ok(bytes) if bytes.iter().all(u8::is_ascii_whitespace)=>{
                let error=(ScanIssueKind::EmptyStats,"统计文件为空，尚无可读取的数据；写入有效内容后会自动重试。".into());
                if std::fs::metadata(path).and_then(|m|m.modified()).ok().and_then(|t|SystemTime::now().duration_since(t).ok()).is_some_and(|age|age>Duration::from_secs(5)){return Err(error);}
                error
            },
            Ok(bytes)=>match parse_cached(&bytes) {
                Ok(stats)=>return Ok(stats),
                Err(StatsParseError::InvalidJson{line,column})=>(ScanIssueKind::CorruptedStats,format!("统计文件尚未写完或已损坏（第 {line} 行，第 {column} 列），重试后仍无法读取；已保留已有历史。")),
                Err(StatsParseError::UnknownFormat)=>return Err((ScanIssueKind::UnknownStatsFormat,"尚不支持此统计结构，未把未知时长当作零。".into())),
                Err(e)=>return Err((ScanIssueKind::CorruptedStats,format!("统计数据无效：{e}。已有历史保留。"))),
            },
            Err(e)=>(ScanIssueKind::CorruptedStats,format!("统计文件暂时无法读取：{e}。已有历史保留。")),
        };
    }
    Err(failure)
}
