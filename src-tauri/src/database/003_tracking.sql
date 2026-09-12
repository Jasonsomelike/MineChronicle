ALTER TABLE stat_snapshots ADD COLUMN normalized_hash TEXT;
ALTER TABLE tracked_deltas ADD COLUMN snapshot_id INTEGER REFERENCES stat_snapshots(id);
CREATE UNIQUE INDEX one_delta_per_snapshot ON tracked_deltas(snapshot_id);
CREATE TABLE tracking_cursors (
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  player_uuid TEXT NOT NULL REFERENCES players(uuid),
  play_ticks INTEGER NOT NULL CHECK(play_ticks >= 0),
  normalized_hash TEXT NOT NULL,
  snapshot_id INTEGER NOT NULL REFERENCES stat_snapshots(id),
  PRIMARY KEY(world_id,player_uuid)
);
CREATE TABLE stat_rollbacks (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  player_uuid TEXT NOT NULL REFERENCES players(uuid),
  old_ticks INTEGER NOT NULL,
  new_ticks INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL UNIQUE REFERENCES stat_snapshots(id),
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX deltas_by_time ON tracked_deltas(observed_at);
PRAGMA user_version=3;
