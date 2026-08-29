# BOOK CLUB Cloudflare migration

The new backend is in `worker/d1/`. It is a separate Worker named
`book-club-api-next`; the Supabase-backed production Worker remains unchanged
until preview acceptance. The new Worker has no production fallback.

## Implemented Cloudflare backend

- D1 schema with foreign keys, indexes, membership roles, ballots/rankings,
  discussions, meetings, invitations, notifications, idempotency, and AI cache.
- Better Auth backed by D1: email/password (12-character minimum), verification,
  password resets, HttpOnly sessions, Google OAuth, and Turnstile protection.
- Resend email delivery. The API key stays only in a Worker secret.
- Private R2 WebP headers: hard 350 KB limit, immutable versioned paths,
  per-club authorization, 15-minute authorized media URLs, and safe deletion
  of the replaced header.
- A server-enforced 500 MB total R2 cap: capacity is reserved atomically in D1
  before every write, uploads are limited to five per club per hour, and a
  15-minute cleanup job releases failed or replaced objects.
- Resource-oriented endpoints. There is no global realtime connection or polling.
- Personal libraries, Goodreads CSV imports, profile design/preferences, public
  member shelves, private notes/quotes, club ratings and archive state.
- Club workflow: suggestions, ranked ballot, checkpoints, check-ins, discussion,
  replies, reactions, meeting polls, meeting scheduling, RSVPs, and membership
  management. Every route derives the club from the protected resource and
  re-checks membership before reading or changing it.
- Google Calendar connection, encrypted tokens, a meeting sync, reading-plan
  sync, and removal. Missing Calendar, Resend, OpenAI, or catalog credentials
  leave only that integration unavailable; the club stays usable.

## Account setup before preview deployment

1. Create D1 and R2, then replace the D1 placeholder ID in `worker/d1/wrangler.toml`.
2. Create Turnstile; add its site key to the preview frontend and its secret to the Worker.
3. Verify a Resend sending domain; set `RESEND_API_KEY` and `RESEND_FROM`.
4. Add `https://YOUR_PREVIEW_WORKER/api/auth/callback/google` to the existing Google OAuth client.
5. Set `BETTER_AUTH_SECRET`, Google credentials, and preview `AUTH_BASE_URL` as Worker secrets.
6. Apply every migration in order (`0001` through `0007`) to the preview D1
   database before starting the Worker. Keep the
   R2 bucket private and leave public access/custom domains disabled.
7. Set `VITE_BACKEND=d1` and `VITE_API_BASE_URL` only in the preview frontend
   environment. Local development has no production fallback: it must name its
   Worker URL explicitly.

## Release controls

- The Vite Cloudflare build resolves `@book-club/data` to a Cloudflare-only
  adapter and resolves the Supabase client to a null compatibility module. The
  legacy implementation remains outside that build as a rollback artifact.
- Do not deploy a remote Worker or run remote migrations until the preview
  environment has its secrets and the acceptance list below is complete.
- Keep an organization budget alert at $1 as a backup. The application itself
  rejects new media before the 500 MB cap, so the alert is not the primary
  protection.

## Preview acceptance

- Email signup, verification, password reset, Google sign-in, and sign-out.
- Create/join/invite, suggest, vote, read, discuss, schedule/RSVP, and header upload.
- Two sessions verify club isolation, authorization, and concurrent vote writes.
- Idle tabs make zero database calls; return-to-tab makes one small request.
- The production build has no Supabase SDK, URL, key, or network request.
- Keep preview online for 24 hours before promotion; investigate quota use at 50% and pause public access at 80%.
- Confirm normal editing and an idle tab in two clubs make only scoped API
  requests. There must be no Supabase request in the preview browser network
  panel before any production promotion.
