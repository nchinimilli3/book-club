# Legacy / already-applied migrations

These files are retained only for audit/history. **Do not run them as part of this production release.**

For the current BOOK CLUB Supabase project, the only release migration to run is:

`../migrations/009_FINAL_RELEASE.sql`

Then require every row from `book_club_release_check()` to say `PASS`.
