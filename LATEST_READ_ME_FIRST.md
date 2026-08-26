# BOOK CLUB — PRODUCTION RELEASE

This folder is the cumulative source of truth for the production release. Do not combine it with older incremental ZIPs.

## 1. Database release gate

For the existing Supabase project, run **only**:

`supabase/migrations/009_FINAL_RELEASE.sql`

Migration 009 supersedes the unreleased 007/008 repair work and is idempotent against the current live project. It finishes by running `book_club_release_check()`.

**Do not deploy until every row in that report says `PASS`.**

Do not run `supabase/legacy/001_initial_outdated_do_not_run.sql`.

## 2. Frontend

Cloudflare Pages frontend variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (publishable client key only)

Production API routing is same-origin. `functions/api/[[path]].ts` forwards `/api/*` to the separately deployed `book-club-api` Worker through the `BOOK_CLUB_API` service binding declared in the root `wrangler.toml`. **Do not put the NYT key in a `VITE_*` variable.**

For local Vite development only, set `VITE_API_BASE_URL` to the local or deployed API Worker origin.

Build command: `npm run build`  
Output directory: `dist`

## 3. Worker / integrations

Deploy `worker/` separately. Server secrets never belong in `VITE_*` variables.

Public Worker vars:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `APP_ORIGIN`
- `GOOGLE_REDIRECT_URI`
- `OPENAI_MODEL`

Worker secrets:
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CALENDAR_STATE_SECRET`
- `TOKEN_ENCRYPTION_KEY`

Optional provider secrets:
- `TMDB_BEARER_TOKEN`
- `YOUTUBE_API_KEY`
- `NYT_BOOKS_API_KEY` (required for the NYT Best Sellers rail)

The release contains working Google Calendar OAuth/sync code, server-side AI enrichment/recommendation code, and NYT Books discovery. Those integrations become active only after their provider credentials are configured. After adding or changing a Worker secret, redeploy `worker/`. After adding or changing the Pages service binding, redeploy the Pages project.

## 4. Release tests

Run:

```bash
npm install
npm run test:release
npm run build
```

Then follow `PRODUCTION_RELEASE_CHECKLIST.md`, including the two/three-account private-club lifecycle test. Static release checks passing is not a substitute for the live RLS test.

## Release guarantees in this source

- canonical Supabase entity routing; no Rebecca/demo fallback
- private club membership + expiring/revocable invite flow
- idea pile → hidden ballot → winner → acquiring → reading → rating/archive lifecycle
- book search, personal library, Favorites, ratings and Goodreads CSV import
- acquisition check-ins, reading plan, progress/spoiler boundary
- posts, replies, reactions, private notes/quotes and meeting agenda saves
- meeting scheduling, RSVP, cancellation and Google Calendar sync plumbing
- action notifications + deep links
- source-backed book decision guide / Reader Context Worker paths
- taste-based club recommendations Worker path
- archive + annual volume
- profile style/sticker persistence with local recovery
- first-party product events + client error logging
- release SQL validator, static route/button/RPC/asset audit, schema-contract audit
