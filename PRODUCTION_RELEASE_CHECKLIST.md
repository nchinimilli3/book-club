# BOOK CLUB production release checklist

A failed item is a blocker. Do not add a frontend fallback to hide a backend/privacy failure.

## 1. Database + privacy

- Run `supabase/migrations/009_FINAL_RELEASE.sql` once against the existing Supabase project.
- Require every `book_club_release_check()` row to be `PASS`.
- Confirm production + localhost auth redirect URLs.
- Confirm RLS is enabled on all private club/social tables.
- Run a 3-account isolation test: Alice + Bob in Club A, Bob + Carol in Club B. Alice must never see Club B; Carol must never see Club A through UI, guessed routes, REST, RPC, or realtime.
- Verify club invite reset/disable invalidates the old link.
- Verify a member can leave, an owner must transfer ownership first, and removing a member preserves historical posts/ratings.

## 2. Core friend-group loop

- Join from an invite and confirm the preview shows the real club, members, and books being considered before joining.
- Suggest 2+ books. Search query, results, scroll position, and browser Back state must survive opening a book and returning.
- Verify every visible book cover opens the book; member avatars/names open member profiles.
- Remove a suggestion and use Undo.
- Vote with **Want to read / Would read / Not this time**. Preferences remain private while voting is open.
- Finalize and verify broad-support selection moves the winner into acquisition.
- Check in with different formats, then verify the **Everyone has their book** state when complete.
- Update reading progress by chapter, page, and percentage from different accounts.
- Mark one account DNF and verify it remains eligible for meeting participation without being counted as finished.
- Post a spoiler-ahead thought; verify it stays hidden for the reader behind and unlocks after progress catches up.
- Create a prediction; verify it is visually sealed until revealed in Meeting Mode.
- Reply/react and verify realtime behavior.
- Set a finish date and verify checkpoints.
- Schedule a meeting, RSVP, open Meeting Mode, reveal predictions, review agenda, and rate the book.
- Archive the book, use Undo immediately, then archive again and verify it appears on the club shelf / annual history.
- Start the next cycle.

## 3. Personal reading + recommendations

- Save Want to Read / Reading / Read / Favorite from a book page and verify club suggestion remains a separate action.
- Toggle a personal book private; verify another member cannot see it on the shared profile.
- Rate a finished personal book.
- Set current recommendation avoidances/moods; verify recommendations respect negative taste and explain **why this fits** in human terms rather than percentages.
- Search a title with multiple editions and verify canonical results are not duplicated or ranked behind odd editions.
- Test a missing cover and verify the typographic cover fallback.

## 4. Trust + interruption handling

- Every mutation must visibly change state or show a concise confirmation.
- Draft a long discussion post, navigate away/back, and verify the draft remains.
- Force a post failure; verify the draft remains with a retryable error.
- Force profile sticker save failure; verify the local layout remains and retry is possible.
- Delete a sticker and use Undo before saving.
- Simulate a failed/slow network and verify last-saved club content can still render; no infinite loaders.
- Return after 48+ hours and verify the Home catch-up state prioritizes meaningful changes instead of activity noise.

## 5. Mobile + accessibility QA

Test 375px, 390px, and 430px widths, plus landscape, with:

- iOS/Safari toolbar expanded
- keyboard open in composer + sticker search
- long book title
- long club name
- 5+ members
- 20 nominations
- missing cover
- modal open
- browser zoom / larger text

Verify 44px-ish touch targets on consequential controls, visible keyboard focus, semantic buttons, alt text, contrast, no information by color alone, and reduced-motion behavior.

## 6. Worker + integrations

Frontend vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`

Worker vars/secrets are documented in `worker/.dev.vars.example` and `worker/wrangler.toml`. The service-role key and provider secrets must never be exposed to the frontend.

Verify:

- Reader context omits unsupported/low-confidence material rather than inventing it.
- Author imagery is relevant; low-confidence imagery is omitted.
- AI unavailable → core reading flows still work and context/recommendations fail gracefully.
- Google Calendar connect, sync, update, and remove event all work when configured.

## 7. Automated local gate

```bash
npm ci
npm run test:release
npm run build
```

Only deploy after both commands pass and the live privacy/lifecycle checks above are complete.
