# BOOK CLUB Cloudflare production release checklist

## Egress guardrail

- Keep the Cloudflare maintenance switch enabled until preview acceptance is complete; do not expose the public route while a release check is failing.
- Review Cloudflare Workers, D1, and R2 usage before promotion. Keep the application-level R2 cap at 500 MB and investigate traffic well before any provider allowance is exhausted.
- Do not use Supabase as a runtime fallback in Cloudflare mode. The D1 build uses `VITE_BACKEND=d1`; production API calls stay same-origin through the Pages `/api/*` proxy.
- Confirm refresh-on-return behavior: no idle-tab polling, one scoped reconciliation on tab focus, and no full workspace reload for a small mutation.

A failed item is a blocker. Do not add a frontend fallback to hide a backend/privacy failure.

## 1. Preview environment, database + privacy

- Apply D1 migrations `0001` through `0007` to the preview database and confirm foreign keys, indexes, and empty-state queries.
- Confirm preview and localhost auth redirect URLs, including the Google OAuth callback.
- Confirm authorization is enforced by the Worker for every private club/social read and mutation.
- Keep the existing Supabase production route unchanged until all preview checks pass.
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

- `VITE_BACKEND=d1`
- `VITE_API_BASE_URL`

Worker vars/secrets are documented in `worker/d1/wrangler.toml` and `worker/d1/.dev.vars.example`. The service-role key and provider secrets must never be exposed to the frontend. Configure preview first; do not invent production resource IDs or deploy without explicit account authorization.

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

Also run the Worker type check and Wrangler dry-run under Node 22. Only deploy preview after these commands and the live privacy/lifecycle checks above are complete. Promote production only after preview has remained healthy under normal use and rollback is ready.
