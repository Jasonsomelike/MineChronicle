use std::path::{Component, Path, PathBuf};

use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatsLayout {
    Legacy,
    Modern26,
    UnknownFuture,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatsLocation {
    pub layout: StatsLayout,
    pub directory: PathBuf,
}

impl StatsLocation {
    pub fn player_file(&self, uuid: Uuid) -> PathBuf {
        self.directory.join(format!("{uuid}.json"))
    }
}

/// Candidate locations only. Implementations must not enumerate or read files.
pub trait StatsLocationResolver {
    fn locations(&self, world: &Path) -> Vec<StatsLocation>;
}

pub struct LegacyStatsLocation;
impl StatsLocationResolver for LegacyStatsLocation {
    fn locations(&self, world: &Path) -> Vec<StatsLocation> {
        vec![StatsLocation {
            layout: StatsLayout::Legacy,
            directory: world.join("stats"),
        }]
    }
}

pub struct Modern26StatsLocation;
impl StatsLocationResolver for Modern26StatsLocation {
    fn locations(&self, world: &Path) -> Vec<StatsLocation> {
        vec![StatsLocation {
            layout: StatsLayout::Modern26,
            directory: world.join("players").join("stats"),
        }]
    }
}

#[derive(Debug, Error)]
#[error("future stats location must be a non-empty relative path without parent components")]
pub struct InvalidStatsLocation;

/// Explicit extension for a future layout, never a recursive disk search.
pub struct FutureStatsLocation {
    relative: PathBuf,
}
impl FutureStatsLocation {
    pub fn new(relative: PathBuf) -> Result<Self, InvalidStatsLocation> {
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(InvalidStatsLocation);
        }
        Ok(Self { relative })
    }
}
impl StatsLocationResolver for FutureStatsLocation {
    fn locations(&self, world: &Path) -> Vec<StatsLocation> {
        vec![StatsLocation {
            layout: StatsLayout::UnknownFuture,
            directory: world.join(&self.relative),
        }]
    }
}

#[derive(Default)]
pub struct DefaultStatsLocationResolver;
impl StatsLocationResolver for DefaultStatsLocationResolver {
    fn locations(&self, world: &Path) -> Vec<StatsLocation> {
        let mut locations = LegacyStatsLocation.locations(world);
        locations.extend(Modern26StatsLocation.locations(world));
        locations
    }
}
