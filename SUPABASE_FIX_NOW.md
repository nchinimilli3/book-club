# Supabase fix for `public.meeting_options`

The frontend in this build expects the final release database contract. The included release migration already creates `public.meeting_options`, `public.meeting_option_responses`, their RLS policies, RPCs, grants, realtime publication entries, and refreshes the PostgREST schema cache.

## Do this in the existing Supabase project

1. Open **Supabase → SQL Editor → New query**.
2. Open `supabase/migrations/009_FINAL_RELEASE.sql` from this project.
3. Paste the **entire file** into the SQL editor and run it once.
4. At the bottom, inspect the output from `book_club_release_check()`. **Every row must say `PASS`.**
5. Refresh the website.

Do **not** run `supabase/reference/BASE_SCHEMA_REFERENCE.sql` over an existing project. Migration 009 is specifically written for the existing project after the earlier Phase 2 / 006 setup and supersedes the unreleased 007/008 repair work.

If migration 009 itself errors because a required older/core table or function is absent, stop at that error rather than creating `meeting_options` manually. That means the live database is older than the baseline expected by this release and needs a base-schema reconciliation first.
