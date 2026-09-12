CREATE TABLE observed_sessions (
    id INTEGER PRIMARY KEY,
    game_root TEXT NOT NULL,
    instance_name TEXT NOT NULL,
    pids TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running','closed','interrupted')),
    CHECK((status='closed' AND ended_at IS NOT NULL) OR
          (status<>'closed' AND ended_at IS NULL))
);
CREATE INDEX sessions_running ON observed_sessions(status, game_root);
PRAGMA user_version=6;
