# BOOK CLUB production backend contract

`supabase/migrations/009_FINAL_RELEASE.sql` is the release contract. Older numbered migrations are historical/context only; do not compose a new production database by guessing from them. For the existing project, run 009 once and use its final `book_club_release_check()` report as the release gate.

## Private product tables

- `profiles` — account-facing profile basics + `profile_style`
- `user_preferences` — active club, notification mode, and current recommendation mood/avoidances
- `clubs`, `club_members`, `club_invites` — private club identity, membership, revocable/expiring invites
- `books`, `club_books` — catalog records + per-club lifecycle/idea attribution
- `ballots`, `nominations`, `votes`, `ballot_preferences` — private voting with broad-support preferences plus legacy single-choice compatibility
- `book_checkins` — acquisition / reading format
- `reading_progress`, `reading_checkpoints` — spoiler boundary + suggested plan
- `posts`, `replies`, `reactions` — spoiler-aware async discussion
- `private_notes`, `saved_quotes` — private reader margins
- `meeting_questions` — saved meeting agenda items
- `meetings`, `meeting_rsvps` — scheduling and RSVP
- `book_ratings`, `club_archives` — finish/rate/archive loop
- `personal_books`, `goodreads_imports` — personal library, per-book club visibility, and import history
- `book_context_items`, `context_sources` — cached source-backed Reader's Companion data
- `notifications` — action inbox
- `product_events`, `client_errors` — first-party release instrumentation
- `calendar_connections`, `calendar_event_links` — server-only encrypted Google Calendar connection state; no browser grants

## Canonical frontend RPCs

- `set_active_club(uuid)`
- `create_club(text,text,text)`
- `join_club_by_invite(text)`
- `create_or_get_club_invite(uuid)`
- `start_ballot_from_ideas(uuid)`
- `cast_ballot_vote(uuid)`
- `set_ballot_preference(uuid,text)`
- `remove_club_idea(uuid)`
- `finalize_ballot(uuid)`
- `mark_book_acquired(uuid,text,text)`
- `start_club_book(uuid,date,integer,integer)`
- `generate_reading_checkpoints(uuid,integer)`
- `update_my_progress(uuid,integer,integer,numeric,text)`
- `save_meeting_options(uuid,uuid,timestamptz[])`
- `set_meeting_option_response(uuid,boolean)`
- `save_club_meeting(uuid,uuid,uuid,timestamptz,text,text)`
- `cancel_club_meeting(uuid)`
- `set_meeting_rsvp(uuid,text)`
- `finish_club_book(uuid)`
- `save_club_book_rating(uuid,numeric,text,boolean)`
- `archive_club_book(uuid)`
- `restore_archived_book(uuid)`
- `save_my_profile_style_v3(jsonb)`
- `delete_my_account()`
- `get_locked_post_count(uuid)`
- `reveal_prediction(uuid)`
- `preview_club_invite(text)`
- `reset_club_invite(uuid)`
- `disable_club_invites(uuid)`
- `get_shared_member_profile(uuid,uuid)`
- `leave_club(uuid)`
- `remove_club_member(uuid,uuid)`
- `transfer_club_ownership(uuid,uuid)`
- `track_product_event(text,jsonb,uuid)`
- `log_client_error(text,text,jsonb)`

## Server-only Worker RPC / tables

The Cloudflare Worker authenticates the user with the Supabase public key, then uses the user's JWT for `get_club_taste_profile(uuid)`. The Supabase service-role secret is Worker-only and is used for encrypted Google Calendar connection/event-link rows. It must never be exposed in `VITE_*` variables or frontend source.

## Security boundary

All club/social tables have RLS. `anon` is explicitly revoked from private CRUD surfaces. The frontend uses only the publishable Supabase key; authenticated grants allow PostgREST to reach RLS, while RLS still decides which rows each user can access. Google tokens are encrypted before storage and the connection tables have RLS enabled with no authenticated-browser policies.

## Realtime

Production realtime publication includes posts, replies, reactions, reading progress, meeting RSVPs, meetings, meeting options, meeting availability, meeting agenda items, club books, ratings, ballots, ballot preferences and notifications.

## Release gate

After running `009_FINAL_RELEASE.sql`, **every row returned by `book_club_release_check()` must say `PASS`** before inviting real users. A FAIL is a release blocker, not something the frontend should silently fall back around.

