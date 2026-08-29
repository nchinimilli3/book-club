PRAGMA foreign_keys = ON;

-- Only one open ballot may exist for a club. This closes the race where two
-- admins click “start vote” at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_ballot_per_club ON ballots(club_id) WHERE status = 'open';
