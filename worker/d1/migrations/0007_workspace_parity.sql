-- Extend the compact launch schema with fields consumed by the existing club
-- workspace UI. These are additive so preview data remains valid.
ALTER TABLE books ADD COLUMN description TEXT;
ALTER TABLE books ADD COLUMN pages INTEGER;
ALTER TABLE books ADD COLUMN published_year INTEGER;
ALTER TABLE books ADD COLUMN isbn TEXT;
ALTER TABLE books ADD COLUMN subjects_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE books ADD COLUMN start_date TEXT;
ALTER TABLE books ADD COLUMN target_finish_date TEXT;
ALTER TABLE books ADD COLUMN total_chapters INTEGER;
ALTER TABLE books ADD COLUMN total_pages INTEGER;

ALTER TABLE discussion_posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'thought';
ALTER TABLE discussion_posts ADD COLUMN chapter INTEGER;
ALTER TABLE discussion_posts ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discussion_posts ADD COLUMN revealed_at INTEGER;

ALTER TABLE meetings ADD COLUMN checkpoint_id TEXT REFERENCES reading_checkpoints(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN meeting_type TEXT NOT NULL DEFAULT 'facetime';
ALTER TABLE meetings ADD COLUMN meeting_url TEXT;
ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled';

CREATE TABLE IF NOT EXISTS checkpoint_checkins (
  checkpoint_id TEXT NOT NULL REFERENCES reading_checkpoints(id) ON DELETE CASCADE,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('reached','catching_up','not_yet')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(checkpoint_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_checkins_club ON checkpoint_checkins(club_id, checkpoint_id);
