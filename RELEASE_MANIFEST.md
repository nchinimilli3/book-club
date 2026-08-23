# BOOK CLUB — 18-point production implementation manifest

This maps the senior-PM production plan to the release source.

1. **Canonical product model** — one club/book lifecycle and one documented Supabase schema contract.
2. **Complete social loop** — private create/join, ideas, hidden voting, acquisition, reading, spoiler-safe discussion, meetings, rating/archive and repeat.
3. **Single database release gate** — `009_FINAL_RELEASE.sql` plus `book_club_release_check()` PASS/FAIL output.
4. **Interaction/routing audit** — automated scan for dead buttons, dead links, unknown routes, demo state and missing RPC implementations.
5. **Design-system consolidation** — shared typography, controls, spacing, radii, focus, club tones, page-specific compositions and mobile rules.
6. **Reduced Home density** — state-dependent primary actions instead of explanatory dashboard filler.
7. **Book discovery** — live catalog search, decision guide, quick ideas, personal shelves and server-side club taste recommendations.
8. **Reading Room** — progress spoiler boundary, locked counts, posts/replies/reactions, predictions, notes/quotes, agenda saves and source-backed context.
9. **Meetings** — persisted scheduling, RSVP/readiness, agenda, Google Calendar fallback link and OAuth event sync implementation.
10. **Profile retention** — search-saved library, Goodreads import/re-import, favorites, ratings, reading-year data and persistent visual customization.
11. **Action inbox** — notifications page, unread badge, realtime refresh and deep links.
12. **Graceful failure** — provider timeouts/errors do not fabricate data or block core reading flows.
13. **Privacy hardening** — RLS contract, anonymous private-data revoke, expiring/revocable invites and three-account launch test.
14. **Production infrastructure** — Worker-only secrets, encrypted Calendar token storage, telemetry, client-error logging, rate limiting and export/delete flows.
15. **Mobile/performance rules** — phone-first layout, touch sizing, reduced motion, software-keyboard-aware sticker dock and service-worker shell caching.
16. **Product instrumentation** — first-party funnel events for club creation through archive plus client-error capture.
17. **Dogfood release test** — explicit two/three-account end-to-end matrix in `PRODUCTION_RELEASE_CHECKLIST.md`.
18. **Delight layer** — source-backed Reader Context, recommendations, annual Volume, profile personalization and Calendar integration without making core flows depend on them.

## External activation vs implementation

Google OAuth, OpenAI synthesis and production email delivery require provider credentials/configuration. Their absence is not hidden behind fake success states. Core BOOK CLUB functionality remains usable without AI or Calendar provider access.
