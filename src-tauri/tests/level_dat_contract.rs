mod support;
use minechronicle_lib::minecraft::level_dat::{
    LevelDatError, LevelDatReader, MAX_LEVEL_FILE_BYTES, MAX_LEVEL_NBT_BYTES,
};
use support::*;

#[test]
fn reads_gzipped_and_raw_nbt_with_unicode_metadata() -> TestResult {
    let bytes = nbt("方块世界 🌲")?;
    for input in [bytes.clone(), gzip(&bytes)?] {
        let value = LevelDatReader.parse(&input)?;
        assert_eq!(value.level_name.as_deref(), Some("方块世界 🌲"));
        assert_eq!(value.data_version, Some(3953));
        assert_eq!(value.minecraft_version.as_deref(), Some("1.21"));
        assert_eq!(value.last_played, Some(1_700_000_000_000));
    }
    Ok(())
}

#[test]
fn requires_a_data_compound_but_tolerates_missing_optional_fields() -> TestResult {
    let empty = fastnbt::to_bytes(&serde_json::json!({}))?;
    assert!(matches!(
        LevelDatReader.parse(&empty),
        Err(LevelDatError::InvalidNbt)
    ));
    let minimal =
        fastnbt::to_bytes(&serde_json::json!({"Data":{"mod:unknown":"kept out of metadata"}}))?;
    let parsed = LevelDatReader.parse(&minimal)?;
    assert_eq!(parsed.level_name, None);
    assert_eq!(parsed.data_version, None);
    Ok(())
}

#[test]
fn corrupted_nbt_gzip_and_checksum_are_errors() -> TestResult {
    for input in [
        vec![],
        vec![10, 0, 0],
        vec![0x1f, 0x8b, 0, 0],
        b"not NBT".to_vec(),
    ] {
        assert!(LevelDatReader.parse(&input).is_err());
    }
    let mut compressed = gzip(&nbt("Test")?)?;
    let length = compressed.len();
    compressed[length - 8] ^= 0xff;
    assert!(LevelDatReader.parse(&compressed).is_err());
    Ok(())
}

#[test]
fn compressed_and_decompressed_size_limits_are_enforced() -> TestResult {
    assert!(matches!(
        LevelDatReader.parse(&vec![0; MAX_LEVEL_FILE_BYTES + 1]),
        Err(LevelDatError::TooLarge)
    ));
    let bomb = gzip(&vec![0; MAX_LEVEL_NBT_BYTES + 1])?;
    assert!(matches!(
        LevelDatReader.parse(&bomb),
        Err(LevelDatError::TooLarge)
    ));
    Ok(())
}
