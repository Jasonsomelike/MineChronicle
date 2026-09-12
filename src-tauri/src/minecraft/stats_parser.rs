use std::collections::BTreeMap;

use serde_json::{Map, Value};
use thiserror::Error;

use super::unique_json::UniqueJson;
use crate::domain::{NormalizedPlayerStats, PlayTimeFormat, StatsWarning};

pub const MAX_STATS_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum StatsParseError {
    #[error("stats JSON exceeds the {limit} byte safety limit")]
    InputTooLarge { limit: usize },
    #[error("invalid stats JSON at line {line}, column {column}")]
    InvalidJson { line: usize, column: usize },
    #[error("no supported play-time field was found")]
    UnknownFormat,
    #[error("{field} must be a JSON object")]
    InvalidStructure { field: String },
    #[error("{key} must be a non-negative i64 integer")]
    InvalidStatistic { key: String },
}

/// Pure parsing contract: no filesystem, launcher, version lookup or network IO.
pub trait StatsParser: Send + Sync {
    fn parse(&self, bytes: &[u8]) -> Result<NormalizedPlayerStats, StatsParseError>;
}

#[derive(Debug, Default)]
pub struct JsonStatsParser;

fn counter(key: &str, value: &Value) -> Result<i64, StatsParseError> {
    value
        .as_i64()
        .filter(|value| *value >= 0)
        .ok_or_else(|| StatsParseError::InvalidStatistic {
            key: key.to_owned(),
        })
}

fn object<'a>(value: &'a Value, field: &str) -> Result<&'a Map<String, Value>, StatsParseError> {
    value
        .as_object()
        .ok_or_else(|| StatsParseError::InvalidStructure {
            field: field.to_owned(),
        })
}

impl StatsParser for JsonStatsParser {
    fn parse(&self, bytes: &[u8]) -> Result<NormalizedPlayerStats, StatsParseError> {
        if bytes.len() > MAX_STATS_BYTES {
            return Err(StatsParseError::InputTooLarge {
                limit: MAX_STATS_BYTES,
            });
        }
        let UniqueJson(json) =
            serde_json::from_slice(bytes).map_err(|error| StatsParseError::InvalidJson {
                line: error.line(),
                column: error.column(),
            })?;
        let root = json.as_object().ok_or(StatsParseError::UnknownFormat)?;
        let modern = root
            .get("stats")
            .map(|value| object(value, "stats"))
            .transpose()?;
        let custom = modern
            .and_then(|stats| stats.get("minecraft:custom"))
            .map(|value| object(value, "minecraft:custom"))
            .transpose()?;
        let candidates = [
            (
                PlayTimeFormat::LegacyFlat,
                "stat.playOneMinute",
                root.get("stat.playOneMinute"),
            ),
            (
                PlayTimeFormat::ModernPlayTime,
                "minecraft:play_time",
                custom.and_then(|m| m.get("minecraft:play_time")),
            ),
            (
                PlayTimeFormat::ModernPlayOneMinute,
                "minecraft:play_one_minute",
                custom.and_then(|m| m.get("minecraft:play_one_minute")),
            ),
        ];
        let mut selected = None;
        let mut warnings = Vec::new();
        for (format, key, value) in candidates {
            if let Some(value) = value {
                let ticks = counter(key, value)?;
                match selected {
                    None => selected = Some((format, ticks)),
                    Some((selected_format, selected_ticks)) if selected_ticks != ticks => {
                        warnings.push(StatsWarning::ConflictingPlayTime {
                            selected_format,
                            selected_ticks,
                            other_format: format,
                            other_ticks: ticks,
                        });
                    }
                    _ => {}
                }
            }
        }
        let (format, play_ticks) = selected.ok_or(StatsParseError::UnknownFormat)?;
        let read_counter = |legacy: &str, modern_key: &str| -> Result<i64, StatsParseError> {
            let (key, value) = if format == PlayTimeFormat::LegacyFlat {
                (legacy, root.get(legacy))
            } else {
                (modern_key, custom.and_then(|m| m.get(modern_key)))
            };
            value
                .map(|value| counter(key, value))
                .transpose()
                .map(|value| value.unwrap_or(0))
        };
        let statistics: BTreeMap<String, Value> = modern
            .map(|m| m.clone().into_iter().collect())
            .unwrap_or_default();
        let mut extra_fields = BTreeMap::new();
        let mut legacy_fields = BTreeMap::new();
        for (key, value) in root {
            if key == "stats" {
                continue;
            }
            if key.starts_with("stat.")
                || key.starts_with("achievement.")
                || (format == PlayTimeFormat::LegacyFlat && key != "DataVersion")
            {
                legacy_fields.insert(key.clone(), value.clone());
            } else {
                extra_fields.insert(key.clone(), value.clone());
            }
        }
        let data_version = root
            .get("DataVersion")
            .map(|value| counter("DataVersion", value))
            .transpose()?;
        Ok(NormalizedPlayerStats {
            play_ticks,
            deaths: read_counter("stat.deaths", "minecraft:deaths")?,
            jumps: read_counter("stat.jump", "minecraft:jump")?,
            mob_kills: read_counter("stat.mobKills", "minecraft:mob_kills")?,
            leave_game_count: read_counter("stat.leaveGame", "minecraft:leave_game")?,
            walk_cm: read_counter("stat.walkOneCm", "minecraft:walk_one_cm")?,
            sprint_cm: read_counter("stat.sprintOneCm", "minecraft:sprint_one_cm")?,
            fly_cm: read_counter("stat.flyOneCm", "minecraft:fly_one_cm")?,
            format,
            data_version,
            statistics,
            legacy_statistics: legacy_fields,
            extra_fields,
            warnings,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_input_is_rejected_before_json_decoding() {
        assert_eq!(
            JsonStatsParser.parse(&vec![b' '; MAX_STATS_BYTES + 1]),
            Err(StatsParseError::InputTooLarge {
                limit: MAX_STATS_BYTES
            })
        );
    }

    #[test]
    fn unknown_scalar_category_survives() -> Result<(), StatsParseError> {
        let stats = JsonStatsParser.parse(
            br#"{"stats":{"minecraft:custom":{"minecraft:play_time":0},"mod:future":[1,"x"]}}"#,
        )?;
        assert_eq!(stats.statistics["mod:future"], serde_json::json!([1, "x"]));
        Ok(())
    }
}
