# BOOK CLUB

A responsive, private, multi-club reading product designed as a colorful editorial publication rather than a dashboard.

## What is implemented

- Responsive mobile + web visual system: warm paper, editorial serif hierarchy, semantic accent palette, 8pt spacing system, reduced-motion support, 44px+ hit areas, minimal cards/chrome.
- Home/current-reading state, member strip, meeting/activity states.
- Profile bookshelf inspired by physical/acrylic shelves; signature book identity.
- Live Open Library search with Google Books fallback for cover discovery.
- Private “Your Clubs” information architecture (no public club directory).
- Reading Room with Discussion / Context / Notes / Characters.
- Spoiler-aware discussion presentation and quick thought composer.
- Reader’s Companion with 30 sec / 2 min / Deep dive source-backed UI.
- Supabase production schema for accounts, clubs, memberships, shelves, books, progress, posts/replies/reactions, nominations/votes, meetings/RSVPs, and research/context.
- Row Level Security policies that keep private club data restricted to members.
- Cloudflare Worker enrichment endpoint with Open Library + Wikipedia and optional TMDB + YouTube secrets.
- PWA manifest / Add to Home Screen foundation.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

The visual demo works without Supabase credentials. Add a Supabase project to turn on the production data layer as you wire each UI action to the provided schema.

## Supabase

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial.sql` in the SQL editor (or through Supabase CLI).
3. Put project URL and anon key in `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Keep RLS enabled. The anon key is safe in the frontend only because the database policies enforce access.
5. Configure Auth redirect URLs for local dev and the final Cloudflare domain.

## Cloudflare

Frontend can be deployed from GitHub with:

- build command: `npm run build`
- output directory: `dist`

Worker API:

```bash
npx wrangler deploy
npx wrangler secret put TMDB_BEARER_TOKEN
npx wrangler secret put YOUTUBE_API_KEY
```

Then set `VITE_API_BASE_URL` to the worker URL.

## API strategy

- Open Library: primary book search/covers.
- Google Books: fallback book resolution.
- Wikipedia/Wikidata family: research/context/entity discovery.
- TMDB: optional adaptation enrichment (Worker secret).
- YouTube: optional interviews/talks (Worker secret).
- Context results should be normalized/cached in Supabase; third-party APIs are enrichment, never prerequisites for core club behavior.

## Production QA gate

Before sharing with friends, test with at least four real accounts:

1. Sign up / profile creation.
2. Create club, invite by link/code, join, leave/rejoin.
3. Verify a non-member cannot read club rows by URL/API manipulation.
4. Add/search books and preserve canonical ISBN/work metadata.
5. Nominate, vote, select current book.
6. Update progress; verify spoiler-gated posts.
7. Post/reply/react concurrently from two browsers.
8. Schedule/RSVP meeting and open FaceTime URL.
9. Complete/rate/archive book and start next cycle.
10. Switch between multiple clubs containing the same book.
11. Test 320px mobile, current iPhone Safari, iPad, laptop, large desktop, keyboard navigation, reduced motion, slow/offline states.
12. Exercise Worker `/api/health` and `/api/enrich` with API credentials present and absent.

Do not call the product “production ready” until this live-environment QA passes.

## V2 feedback pass

This build incorporates the localhost review from Aug 23:
- Home has a stronger editorial color system and less flat/blank composition.
- Upcoming meeting and recent activity now use intentional olive/butter/pink accents.
- Profile shelves were redesigned as thinner centered acrylic ledges with centered books.
- Add Books, Edit signature book, Invite, notifications, club rows, Start Club, and Join Invite now have visible working interactions in the local prototype.
- Search results can be tapped to add books to My Books and show an added state.
- Thought composer/dialog is centered instead of pinned to the bottom of the viewport.
- Club status typography was enlarged for readability.
- Club rows open a private club detail view.

The interactions above are prototype/local state until Supabase is connected; the production persistence model remains defined by the included migration and RLS schema.
