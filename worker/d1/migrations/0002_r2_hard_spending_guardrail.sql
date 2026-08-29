PRAGMA foreign_keys = ON;

-- One authoritative, D1-managed counter for bytes reserved or stored in R2.
-- It is intentionally independent from browser-provided values.
CREATE TABLE IF NOT EXISTS media_storage_usage (
  bucket TEXT PRIMARY KEY CHECK(bucket = 'club_headers'),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO media_storage_usage (bucket, used_bytes, updated_at)
VALUES ('club_headers', 0, 0);

-- Pending records reserve capacity before the R2 write. Active records are the
-- currently referenced headers. Deleting records are retried by the cron until
-- their R2 object has been removed and their bytes released.
CREATE TABLE IF NOT EXISTS media_objects (
  object_key TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 358400),
  state TEXT NOT NULL CHECK(state IN ('pending', 'active', 'deleting')),
  rate_window_started_at INTEGER NOT NULL,
  rate_slot_held INTEGER NOT NULL DEFAULT 1 CHECK(rate_slot_held IN (0, 1)),
  reserved_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_objects_cleanup ON media_objects(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_media_objects_club ON media_objects(club_id, state);

-- Limits header changes to five successful/reserved uploads across a club per
-- rolling clock hour. Failed writes release their reservation and rate slot.
CREATE TABLE IF NOT EXISTS media_upload_rate_limits (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  window_started_at INTEGER NOT NULL,
  upload_count INTEGER NOT NULL DEFAULT 0 CHECK(upload_count >= 0 AND upload_count <= 5),
  PRIMARY KEY (club_id, window_started_at)
);
CREATE INDEX IF NOT EXISTS idx_media_rate_cleanup ON media_upload_rate_limits(window_started_at);
