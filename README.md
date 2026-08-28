# BOOK CLUB

A private reading space for friend groups: choose a book, vote without social pressure, read at different speeds without spoilers, meet, remember what everyone thought, and pick the next one.

## Product loop

`join/create → suggest → vote → get the book → read → discuss → meet → rate → shelf → repeat`

The frontend is React + TypeScript + Vite. Private product data lives in Supabase with RLS. Server-only AI and Google Calendar integrations run through the Cloudflare Worker in `worker/`.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Frontend environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` (local Vite development only; production uses the Pages `/api/*` proxy)

Do not put service-role, OpenAI, Google OAuth, or other provider secrets in `VITE_*` variables.

For local Worker development, copy `worker/.dev.vars.example` to `worker/.dev.vars` and fill the required values there.

## Database

For the existing BOOK CLUB Supabase project, run:

`supabase/migrations/009_FINAL_RELEASE.sql`

Then run the migration's final `book_club_release_check()` output and require every row to be `PASS`.

`supabase/reference/BASE_SCHEMA_REFERENCE.sql` is retained only as a reference for the already-applied base schema. Do not re-run it against an existing production database.

The canonical runtime contract is `supabase/SCHEMA_CONTRACT.md`.

## Release gates

```bash
npm run test:release
npm run build
```

`test:release` checks TypeScript, routes/actions, RPC wiring, sticker references, schema-contract coverage, and Worker syntax. Before launch, also complete the live multi-account privacy/lifecycle checks in `PRODUCTION_RELEASE_CHECKLIST.md`.

## Book discovery
Search has a browse state before typing with live NYT Best Sellers. Set the NYT key only on `book-club-api` (`wrangler secret put NYT_BOOKS_API_KEY` inside `worker/`); never expose it in Vite. In production, the Pages Function at `/api/*` reaches that Worker through the `BOOK_CLUB_API` service binding, so a `VITE_API_BASE_URL` is not required on the deployed site. Search distinguishes a missing key, an unreachable API Worker, and an NYT provider error.

## Quick Add passage scanning

On mobile, **Quick add** opens the rear camera so a reader can photograph a passage and save the transcription directly to the active book discussion. The browser downsizes the photo before upload; the Cloudflare Worker sends it to the configured OpenAI vision model at high detail, returns exact text plus any visible chapter/page metadata, and the original photo is not stored in Supabase.

This uses the existing server-side `OPENAI_API_KEY`. `OPENAI_VISION_MODEL` is optional and falls back to `OPENAI_MODEL` (then `gpt-5.6`). Keep both values on the Worker, never in `VITE_*` variables.
