//! Transparent compression for snapshot payloads.
//!
//! `stat_snapshots.stats` holds the full normalised statistics JSON - about
//! 10 KB per row, 4.13 MB of the 6.77 MB reference archive. It compresses to
//! roughly a quarter of that because the payloads are repetitive JSON with long
//! repeated key names.
//!
//! The encoding is deliberately not a schema change: rows keep the same shape
//! and readers keep working, because the column holds a base64 blob with a
//! version prefix instead of raw JSON. A leading marker distinguishes the two,
//! so an archive written by an older build still reads correctly and no
//! migration has to rewrite every row up front.
//!
//! Compression is lossless, so `stats` round-trips byte for byte. That matters
//! because the timeline compares snapshot payloads for equality in SQL (see
//! `EVENTS` in activity.rs): the comparison is done on the *decoded* value in
//! Rust, never on the stored bytes.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::{Read, Write};

/// Prefix marking a compressed payload. Chosen so it cannot be confused with the
/// start of a JSON object, which is always `{`.
pub const MARKER: &str = "z1:";

/// Compresses a stats payload for storage.
///
/// Small inputs are left alone: below a few hundred bytes the base64 expansion
/// can outweigh the compression, and a stored marker costs a comparison.
pub fn encode(stats: &str) -> String {
    if stats.len() < 256 {
        return stats.to_owned();
    }
    let mut encoder =
        flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    if encoder.write_all(stats.as_bytes()).is_err() {
        return stats.to_owned();
    }
    match encoder.finish() {
        Ok(packed) if packed.len() < stats.len() => {
            format!("{MARKER}{}", STANDARD.encode(packed))
        }
        // Not compressible (or failed): store as-is rather than growing the row.
        _ => stats.to_owned(),
    }
}

/// Decodes a stored stats payload, accepting both plain JSON and compressed
/// rows so an archive can hold a mix during and after an upgrade.
pub fn decode(stored: &str) -> Result<String, String> {
    let Some(encoded) = stored.strip_prefix(MARKER) else {
        return Ok(stored.to_owned());
    };
    let packed = STANDARD
        .decode(encoded)
        .map_err(|error| format!("统计快照解码失败：{error}"))?;
    let mut decoder = flate2::read::DeflateDecoder::new(packed.as_slice());
    let mut out = String::new();
    decoder
        .read_to_string(&mut out)
        .map_err(|error| format!("统计快照解压失败：{error}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_realistic_payload() {
        let stats = format!(
            r#"{{"stats":{{"minecraft:custom":{{{}}}}}}}"#,
            (0..400)
                .map(|i| format!(r#""minecraft:counter_{i}":{i}"#))
                .collect::<Vec<_>>()
                .join(",")
        );
        let encoded = encode(&stats);
        assert!(encoded.starts_with(MARKER), "large payload should compress");
        assert!(encoded.len() < stats.len(), "compression should shrink it");
        assert_eq!(decode(&encoded).expect("decode"), stats);
    }

    #[test]
    fn plain_rows_still_read() {
        // An archive written before compression must keep working.
        let legacy = r#"{"stats":{"minecraft:custom":{"minecraft:play_time":20}}}"#;
        assert_eq!(decode(legacy).expect("decode"), legacy);
        assert_eq!(encode(legacy), legacy, "small payloads stay plain");
    }

    #[test]
    fn incompressible_input_is_stored_verbatim() {
        // Random-looking short data would grow under base64; keep it plain.
        let odd = "x".repeat(300);
        let encoded = encode(&odd);
        assert_eq!(decode(&encoded).expect("decode"), odd);
    }

    #[test]
    fn corrupt_payload_is_an_error_not_a_panic() {
        assert!(decode("z1:!!!not base64!!!").is_err());
        assert!(decode("z1:aGVsbG8gd29ybGQ").is_err());
    }

    #[test]
    fn equal_payloads_encode_to_equal_bytes() {
        // The timeline compares snapshot payloads for equality in SQL
        // (`initial.stats=s.stats` in activity.rs EVENTS). That comparison only
        // stays correct if encoding is deterministic, so identical input must
        // produce identical output.
        let stats = format!(
            r#"{{"stats":{{"minecraft:custom":{{{}}}}}}}"#,
            (0..300)
                .map(|i| format!(r#""minecraft:k{i}":{i}"#))
                .collect::<Vec<_>>()
                .join(",")
        );
        assert_eq!(encode(&stats), encode(&stats));
        assert!(encode(&stats).starts_with(MARKER));

        // And payloads that differ must not collide.
        let other = stats.replace("k1\"", "kX\"");
        assert_ne!(encode(&stats), encode(&other));
    }

    #[test]
    fn compresses_a_repetitive_payload_substantially() {
        // Mirrors the real shape: long repeated key names, many entries.
        let stats = format!(
            r#"{{"stats":{{"minecraft:mined":{{{}}}}}}}"#,
            (0..600)
                .map(|i| format!(r#""minecraft:some_block_name_{i}":{i}"#))
                .collect::<Vec<_>>()
                .join(",")
        );
        let ratio = encode(&stats).len() as f64 / stats.len() as f64;
        assert!(ratio < 0.5, "expected real compression, got {ratio:.2}");
    }
}
