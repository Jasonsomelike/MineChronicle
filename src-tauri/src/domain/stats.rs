use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayTimeFormat {
    LegacyFlat,
    ModernPlayTime,
    ModernPlayOneMinute,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatsWarning {
    ConflictingPlayTime {
        selected_format: PlayTimeFormat,
        selected_ticks: i64,
        other_format: PlayTimeFormat,
        other_ticks: i64,
    },
}

/// Current file counters only. Historical baselines and tracked deltas belong
/// to separate models in later phases; they must never be inferred here.
/// Unknown category/key values remain JSON, so mod extensions are lossless.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedPlayerStats {
    pub play_ticks: i64,
    pub deaths: i64,
    pub jumps: i64,
    pub mob_kills: i64,
    pub leave_game_count: i64,
    pub walk_cm: i64,
    pub sprint_cm: i64,
    pub fly_cm: i64,
    pub format: PlayTimeFormat,
    pub data_version: Option<i64>,
    pub statistics: BTreeMap<String, Value>,
    pub legacy_statistics: BTreeMap<String, Value>,
    pub extra_fields: BTreeMap<String, Value>,
    pub warnings: Vec<StatsWarning>,
}

impl NormalizedPlayerStats {
    /// Numeric access for known and unknown categories. Non-numeric extensions
    /// remain available through `statistics`, rather than being coerced.
    pub fn statistic(&self, category: &str, key: &str) -> Option<i64> {
        if category == "legacy" {
            if let Some(value) = self.legacy_statistics.get(key) {
                return value.as_i64();
            }
        }
        self.statistics.get(category)?.get(key)?.as_i64()
    }
}
