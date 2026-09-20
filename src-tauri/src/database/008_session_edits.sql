-- Manual end times for observed sessions.
--
-- A session closed by the observer records ended_at when the process
-- disappears. When the observer itself stops first, the end is genuinely
-- unknown and `interrupt_observed_sessions` deliberately leaves ended_at NULL
-- rather than inventing a timestamp. The user is the only remaining source for
-- that value, so these columns record what they supplied.
--
-- `ended_source` is NULL for an observed end and 'manual' for one the user
-- typed. NULL rather than 'observed' so existing rows need no backfill: adding
-- a column with ADD COLUMN leaves them NULL, which already means "observed".
--
-- A new status value was rejected instead of used: 006_sessions.sql constrains
-- status IN ('running','closed','interrupted'), and SQLite cannot alter a CHECK
-- without rebuilding the table. Rebuilding the user's archive to gain a label
-- the source column already carries is not worth the risk.
--
-- `edited_at` is an audit trail only. It is never read by the attribution
-- calculation, so a clock change cannot affect any reported duration.
ALTER TABLE observed_sessions ADD COLUMN ended_source TEXT;
ALTER TABLE observed_sessions ADD COLUMN edited_at TEXT;
PRAGMA user_version=8;
