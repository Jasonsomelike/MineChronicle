ALTER TABLE instances ADD COLUMN path TEXT;
ALTER TABLE instances ADD COLUMN payload TEXT;
CREATE UNIQUE INDEX unique_instance_path ON instances(path);
PRAGMA user_version=2;
