PRAGMA foreign_keys = ON;

-- Profile images share the same application-level R2 safety ceiling as club
-- headers, but keep their own object lifecycle and access rules.
ALTER TABLE media_storage_usage RENAME TO media_storage_usage_legacy;
CREATE TABLE media_storage_usage (
  bucket TEXT PRIMARY KEY CHECK(bucket IN ('club_headers', 'profile_media')),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
  updated_at INTEGER NOT NULL
);
INSERT INTO media_storage_usage (bucket, used_bytes, updated_at)
  SELECT bucket, used_bytes, updated_at FROM media_storage_usage_legacy;
INSERT OR IGNORE INTO media_storage_usage (bucket, used_bytes, updated_at)
  VALUES ('profile_media', 0, 0);
DROP TABLE media_storage_usage_legacy;

CREATE TABLE IF NOT EXISTS profile_media_objects (
  object_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('avatar', 'wallpaper')),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 266240),
  state TEXT NOT NULL CHECK(state IN ('pending', 'active', 'deleting')),
  reserved_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_media_objects_cleanup
  ON profile_media_objects(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_profile_media_objects_user
  ON profile_media_objects(user_id, kind, state);

CREATE TABLE IF NOT EXISTS profile_media (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('avatar', 'wallpaper')),
  object_key TEXT NOT NULL REFERENCES profile_media_objects(object_key),
  byte_size INTEGER NOT NULL CHECK(byte_size > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
