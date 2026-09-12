# Synthetic fixtures

All files were authored for tests. No user Minecraft files, names, credentials,
or real player UUIDs are included. The two UUIDs are synthetic identifiers.

| Directory | Deliberately represented structure |
| --- | --- |
| minecraft_1_12 | Flat `stat.playOneMinute`, old counters, achievements |
| minecraft_1_16 | `stats.minecraft:custom.minecraft:play_one_minute` |
| minecraft_1_21 | `stats.minecraft:custom.minecraft:play_time`, generic categories and mod data |
| minecraft_26_1 | Two player files under `players/stats`, intentionally no `level.dat` |

These fixtures validate structural compatibility, not a complete export of each
Minecraft release. `DataVersion` never selects the parser. `corrupted.json` is
intentionally truncated and must stay invalid.

The rollback sequence only validates parsing of current values in Phase 1.
Snapshot/delta rollback behavior belongs to Phase 7; clone hashes and deduplication
are not implemented here. Shared-root tests validate the domain relationship,
not filesystem canonicalization or scanner deduplication (Phase 2).
