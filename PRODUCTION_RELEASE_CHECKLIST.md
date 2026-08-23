# BOOK CLUB production release checklist

Use this once. A failed item is a blocker rather than a reason to add another frontend fallback.

## A. Database

1. Open Supabase → SQL Editor.
2. Run `supabase/migrations/009_FINAL_RELEASE.sql` once.
3. Inspect the final `book_club_release_check()` table.
4. Require **PASS on every row**.
5. Confirm Authentication → URL Configuration contains localhost and the production Pages domain.
6. Confirm RLS remains enabled on private product tables.

## B. Cloudflare Pages

Set:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`

Build: `npm run build`  
Output: `dist`

## C. Worker

Set public vars:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `APP_ORIGIN`
- `GOOGLE_REDIRECT_URI`
- `OPENAI_MODEL`

Set secrets:
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CALENDAR_STATE_SECRET` (random high-entropy string)
- `TOKEN_ENCRYPTION_KEY` (random high-entropy string)

Google OAuth redirect URI must exactly equal:
`https://<worker-origin>/api/calendar/callback`

## D. Auth/email

- Verify signup confirmation on production domain.
- Verify password recovery returns to the production app and lets the user set a new password.
- Before inviting a broad group, configure production SMTP rather than relying on development email limits.

## E. Live 3-account privacy test

Use three test accounts: Alice, Bob, Carol.

- Alice creates Club A and invites Bob.
- Bob joins Club A.
- Bob creates Club B and invites Carol.
- Carol joins Club B.
- Alice must not see Club B in club list, guessed route, REST data, RPC results or realtime events.
- Carol must not see Club A.

## F. Complete lifecycle test

Using Alice + Bob in Club A:

1. Search and quick-add two different book ideas.
2. Verify search query/results do not disappear after quick add.
3. Open idea cover and verify correct decision page.
4. Verify Suggested by attribution.
5. Start hidden vote; each account votes; change one vote.
6. Close/finalize vote; verify one winner enters acquisition rather than Reading immediately.
7. Both members check in with formats.
8. Set finish date and generate reading checkpoints.
9. Update progress from both accounts.
10. Post a thought ahead of the other reader; confirm it is hidden/locked for the reader behind.
11. Catch up; confirm the thought unlocks.
12. Reply/react; verify realtime update without refresh.
13. Save a post to meeting agenda.
14. Schedule meeting; RSVP from second account.
15. Connect Google Calendar; sync meeting; edit meeting and verify event updates; cancel and verify event removal.
16. Finish the book; rate/review from both accounts.
17. Archive; verify archive + annual volume.
18. Begin a second idea/vote cycle.

## G. Personal/profile test

- Save Want to Read, Currently Reading, Read and Favorite books from Search.
- Verify Favorite appears immediately and survives refresh/login.
- Rate a finished personal book and verify average rating.
- Import Goodreads CSV; re-import the same CSV and verify no destructive duplicate behavior.
- Add/move/resize/rotate a sticker; Done; refresh; verify exact position/scale/rotation persists.
- Open sticker editor on iPhone Safari with keyboard visible; confirm canvas remains visible.

## H. Failure-state test

Temporarily disable/point away from the Worker and verify:
- core club/search/read flows still work
- AI context/recommendations fail gracefully
- no fake context is invented
- no infinite loaders

Test missing cover, long book title, empty club, no meeting, no archive, slow network and provider timeout states.

## I. Automated local release gate

```bash
npm install
npm run test:release
npm run build
```

Only deploy when the build succeeds and the live SQL + multi-account tests pass.
