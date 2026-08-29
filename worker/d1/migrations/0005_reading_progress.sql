CREATE TABLE IF NOT EXISTS reading_progress (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('not_started','reading','finished')) DEFAULT 'not_started',
  chapter INTEGER, page INTEGER, percent REAL, format TEXT CHECK(format IN ('chapter','page','percent')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reading_progress_club_book ON reading_progress(club_id, book_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reading_checkpoints (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL, target_chapter INTEGER, target_page INTEGER,
  created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_book ON reading_checkpoints(club_id, book_id, due_at);

CREATE TABLE IF NOT EXISTS checkpoint_options (
  id TEXT PRIMARY KEY, checkpoint_id TEXT NOT NULL REFERENCES reading_checkpoints(id) ON DELETE CASCADE,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_options ON checkpoint_options(club_id, checkpoint_id, starts_at);

CREATE TABLE IF NOT EXISTS checkpoint_votes (
  option_id TEXT NOT NULL REFERENCES checkpoint_options(id) ON DELETE CASCADE,
  checkpoint_id TEXT NOT NULL REFERENCES reading_checkpoints(id) ON DELETE CASCADE,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_votes ON checkpoint_votes(club_id, checkpoint_id, option_id);
