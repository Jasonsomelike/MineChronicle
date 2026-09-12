CREATE INDEX IF NOT EXISTS snapshots_by_player_world ON stat_snapshots(world_id,player_uuid,kind,id);
CREATE INDEX IF NOT EXISTS snapshots_by_time ON stat_snapshots(observed_at,id);
PRAGMA user_version=5;
