use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use thiserror::Error;
static METADATA_CACHE: OnceLock<Mutex<HashMap<blake3::Hash, WorldMetadata>>> = OnceLock::new();

pub const MAX_LEVEL_FILE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_LEVEL_NBT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldMetadata {
    pub level_name: Option<String>,
    pub data_version: Option<i32>,
    pub minecraft_version: Option<String>,
    pub last_played: Option<i64>,
    pub seed: Option<i64>,
    pub game_time: Option<i64>,
}
impl WorldMetadata {
    pub fn fingerprint(&self) -> Option<String> {
        self.level_name.as_ref()?;
        self.data_version?;
        self.minecraft_version.as_ref()?;
        if self.last_played? <= 0 {
            return None;
        }
        Some(
            blake3::hash(&serde_json::to_vec(self).ok()?)
                .to_hex()
                .to_string(),
        )
    }
}

#[derive(Debug, Error)]
pub enum LevelDatError {
    #[error("level.dat could not be read: {0}")]
    Io(#[from] io::Error),
    #[error("level.dat is too large")]
    TooLarge,
    #[error("level.dat contains invalid NBT")]
    InvalidNbt,
}

#[derive(Deserialize)]
struct LevelRoot {
    #[serde(rename = "Data")]
    data: LevelData,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct LevelData {
    level_name: Option<String>,
    data_version: Option<i32>,
    version: Option<Version>,
    last_played: Option<i64>,
    random_seed: Option<i64>,
    world_gen_settings: Option<WorldGen>,
    time: Option<i64>,
}
#[derive(Deserialize)]
struct WorldGen {
    seed: Option<i64>,
}
#[derive(Deserialize)]
struct Version {
    #[serde(rename = "Name")]
    name: Option<String>,
}

pub struct LevelDatReader;
impl LevelDatReader {
    pub fn read(&self, path: &Path) -> Result<WorldMetadata, LevelDatError> {
        let bytes = read_bounded(path, MAX_LEVEL_FILE_BYTES)?;
        self.parse(&bytes)
    }

    pub fn parse(&self, bytes: &[u8]) -> Result<WorldMetadata, LevelDatError> {
        if bytes.len() > MAX_LEVEL_FILE_BYTES {
            return Err(LevelDatError::TooLarge);
        }
        let hash = blake3::hash(bytes);
        let cache = METADATA_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(values) = cache.lock() {
            if let Some(metadata) = values.get(&hash) {
                return Ok(metadata.clone());
            }
        }
        let decoded;
        let nbt = if bytes.starts_with(&[0x1f, 0x8b]) {
            let mut buffer = Vec::new();
            GzDecoder::new(bytes)
                .take(MAX_LEVEL_NBT_BYTES as u64 + 1)
                .read_to_end(&mut buffer)?;
            if buffer.len() > MAX_LEVEL_NBT_BYTES {
                return Err(LevelDatError::TooLarge);
            }
            decoded = buffer;
            decoded.as_slice()
        } else {
            bytes
        };
        let root: LevelRoot =
            fastnbt::from_bytes_with_opts(nbt, fastnbt::DeOpts::new().max_seq_len(1_000_000))
                .map_err(|_| LevelDatError::InvalidNbt)?;
        let metadata = WorldMetadata {
            level_name: root.data.level_name.filter(|name| !name.trim().is_empty()),
            data_version: root.data.data_version,
            minecraft_version: root.data.version.and_then(|v| v.name),
            last_played: root.data.last_played,
            seed: root
                .data
                .world_gen_settings
                .and_then(|w| w.seed)
                .or(root.data.random_seed),
            game_time: root.data.time,
        };
        if let Ok(mut values) = cache.lock() {
            if values.len() >= 512 {
                values.clear();
            }
            values.insert(hash, metadata.clone());
        }
        Ok(metadata)
    }
}

/// Read-only, bounded even if a file grows while Minecraft is writing it.
pub(crate) fn read_bounded(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file exceeds size limit",
        ));
    }
    Ok(bytes)
}
