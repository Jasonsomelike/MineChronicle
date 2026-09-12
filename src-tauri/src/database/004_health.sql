CREATE TABLE clone_evidence (
  candidate_id INTEGER PRIMARY KEY REFERENCES clone_candidates(id),
  evidence TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE lineage_details (
  world_id INTEGER PRIMARY KEY REFERENCES worlds(id),
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES clone_candidates(id),
  inherited_ticks INTEGER,
  confidence TEXT NOT NULL CHECK(confidence IN ('exact','estimated','unknown')),
  confirmed_by_user INTEGER NOT NULL CHECK(confirmed_by_user=1),
  confirmed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE health_reviews (key TEXT PRIMARY KEY, reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE analysis_status (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version=4;
