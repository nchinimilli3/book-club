-- SQLite cannot alter a CHECK constraint in place. Rebuild this small
-- per-reader table while preserving every saved position and timestamp.
CREATE TABLE reading_progress_next (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('not_started','reading','finished','sitting_out')) DEFAULT 'not_started',
  chapter INTEGER,
  page INTEGER,
  percent REAL,
  format TEXT CHECK(format IN ('chapter','page','percent')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, user_id)
);

INSERT INTO reading_progress_next (club_id, book_id, user_id, status, chapter, page, percent, format, updated_at)
SELECT club_id, book_id, user_id, status, chapter, page, percent, format, updated_at
FROM reading_progress;

DROP TABLE reading_progress;
ALTER TABLE reading_progress_next RENAME TO reading_progress;
CREATE INDEX idx_reading_progress_club_book ON reading_progress(club_id, book_id, updated_at DESC);
