PRAGMA foreign_keys = ON;

-- Better Auth's D1 tables. Keep its expected names and camel-case columns.
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT,
  userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(userId);
CREATE INDEX IF NOT EXISTS idx_session_expiry ON session(expiresAt);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
  UNIQUE(providerId, accountId)
);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(userId);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '', cover_key TEXT,
  created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS club_memberships (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member')) DEFAULT 'member',
  joined_at INTEGER NOT NULL, PRIMARY KEY (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON club_memberships(user_id, club_id);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')) DEFAULT 'member',
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, accepted_at INTEGER,
  created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_lookup ON invitations(token_hash, expires_at);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', cover_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('suggested','ballot','current','completed','archived')) DEFAULT 'suggested',
  created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_club_status ON books(club_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS ballots (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('open','closed','finalized')) DEFAULT 'open',
  opens_at INTEGER NOT NULL, closes_at INTEGER, created_by TEXT NOT NULL REFERENCES user(id),
  finalized_book_id TEXT REFERENCES books(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ballots_active ON ballots(club_id, status, closes_at);
CREATE TABLE IF NOT EXISTS ballot_books (
  ballot_id TEXT NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, PRIMARY KEY (ballot_id, book_id)
);
CREATE TABLE IF NOT EXISTS ballot_rankings (
  ballot_id TEXT NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK(rank > 0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (ballot_id, user_id, book_id), UNIQUE(ballot_id, user_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_rankings_ballot ON ballot_rankings(ballot_id, book_id);

CREATE TABLE IF NOT EXISTS discussion_posts (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL, author_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_club_book ON discussion_posts(club_id, book_id, created_at DESC);
CREATE TABLE IF NOT EXISTS discussion_replies (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_post ON discussion_replies(club_id, post_id, created_at ASC);
CREATE TABLE IF NOT EXISTS reactions (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK(length(emoji) BETWEEN 1 AND 16), created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(club_id, post_id);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  book_id TEXT REFERENCES books(id) ON DELETE SET NULL, starts_at INTEGER NOT NULL,
  location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_club ON meetings(club_id, starts_at DESC);
CREATE TABLE IF NOT EXISTS meeting_rsvps (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('yes','no','maybe')), updated_at INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', read_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  operation TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','completed')),
  response_json TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);
CREATE TABLE IF NOT EXISTS media_tokens (
  token_hash TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_tokens_expiry ON media_tokens(expires_at);
CREATE TABLE IF NOT EXISTS ai_context_cache (
  cache_key TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_context_expiry ON ai_context_cache(expires_at);
