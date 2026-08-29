-- Additive D1 schema for the remaining Supabase product domains.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  profile_style_json TEXT NOT NULL DEFAULT '{}',
  notification_mode TEXT NOT NULL DEFAULT 'essential',
  reading_avoidances_json TEXT NOT NULL DEFAULT '[]',
  reading_moods_json TEXT NOT NULL DEFAULT '[]',
  timezone TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_library (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  isbn TEXT,
  pages INTEGER,
  published_year INTEGER,
  description TEXT,
  shelf TEXT NOT NULL CHECK(shelf IN ('want_to_read','currently_reading','read')) DEFAULT 'want_to_read',
  rating INTEGER CHECK(rating BETWEEN 1 AND 5),
  date_finished TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'search',
  title_key TEXT NOT NULL,
  author_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, title_key, author_key)
);
CREATE INDEX IF NOT EXISTS idx_personal_library_user ON personal_library(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reader_margins (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('note','quote')),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
  note TEXT,
  chapter INTEGER,
  page INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reader_margins_user_book ON reader_margins(user_id, book_id, created_at DESC);

CREATE TABLE IF NOT EXISTS book_ratings (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  review TEXT,
  recommend INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(book_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_book_ratings_club_book ON book_ratings(club_id, book_id);

CREATE TABLE IF NOT EXISTS meeting_questions (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES discussion_posts(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meeting_questions_book ON meeting_questions(club_id, book_id, resolved_at, created_at);

CREATE TABLE IF NOT EXISTS calendar_connections (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('google')),
  provider_account_id TEXT NOT NULL,
  email TEXT,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  access_expires_at INTEGER,
  scopes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('meeting','reading_plan')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, kind, meeting_id),
  UNIQUE(user_id, kind, book_id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id, club_id);

CREATE INDEX IF NOT EXISTS idx_books_archive ON books(club_id, status, updated_at DESC);
