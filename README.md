# BOOK CLUB

A private, multi-club reading app for real friend groups. The production loop is:

`create/join → ideas → vote → acquire → read → discuss → meet → rate/archive → repeat`

The frontend is React/Vite, private product data lives in Supabase with RLS, and server-only integrations run through a Cloudflare Worker.

## Start locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use only the Supabase publishable client key in the frontend. Never commit service-role or provider secrets.

## Existing Supabase project

`supabase/migrations/009_FINAL_RELEASE.sql` is the release migration for the current project. Older migration files are retained under `supabase/legacy/` for history only.

Run 009 once and require every row from its final `book_club_release_check()` output to be `PASS` before production launch.

The canonical runtime contract is documented in `supabase/SCHEMA_CONTRACT.md`.

## Cloudflare Worker

Deploy `worker/` separately and configure `VITE_API_BASE_URL` in the frontend. The Worker owns:

- source-backed AI book decision guides
- Reader's Companion enrichment
- club taste recommendations
- Google Calendar OAuth and event synchronization
- protected use of service-role/provider credentials

Core club reading flows do not depend on AI being available.

## Quality gates

```bash
npm run test:release
npm run build
```

`test:release` checks TypeScript, runtime invariants, routes/buttons, RPC contracts, sticker assets, schema-contract coverage and Worker syntax.

A production launch still requires the live multi-account RLS/lifecycle test in `PRODUCTION_RELEASE_CHECKLIST.md`.
