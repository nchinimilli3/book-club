# BOOK CLUB overhaul audit

This branch treats Supabase as the source of truth. The previous demo-state routing has been removed from the primary experience.

## Connection rules

- `/clubs/:clubId` always loads that exact club and persists it as the user's active club.
- `/clubs/:clubId/books/:clubBookId` only opens the current Supabase club-book record. There is no Rebecca fallback.
- Search saves into the current active club.
- Progress writes through `update_my_progress`.
- Copy check-in writes through `mark_book_acquired`.
- Finish date writes through `start_club_book` and generates checkpoints.
- Discussion posts write to `posts` and are filtered by spoiler chapter.
- Meeting RSVP writes to `meeting_rsvps`.
- Open ballots and the user's own votes load from Supabase.
- Profile statistics/shelves load from `personal_books`; Goodreads CSV import writes to that table.
- Reader's Companion text loads from `book_context_items` and `context_sources`.
- Reader's Companion visual research uses Wikimedia Commons dynamically.
- Posts, progress and RSVP tables subscribe through Supabase Realtime.

## Visual system changes

- Removed decorative pseudo-brand icons/confetti/doodle language from core product UI.
- Removed repeated eyebrow-label/card pattern from primary screens.
- One dominant composition per page: current book, club index, profile shelf, or reading-room world.
- Color is used as planes/material rather than random pastel containers.
- Strong serif display + restrained sans UI system.
- Consistent border/radius/touch-target system.
- Mobile and desktop compositions are intentionally different.
- Shelves are dimensional objects, not colored divider lines.
- Context becomes a book-specific archival collage rather than a dashboard grid.

## Still provider-dependent

The Reader's Companion will intentionally show an honest empty state until context rows are generated for the selected book. It does not fabricate character or historical material. AI synthesis, Google Calendar OAuth, and server-side enrichment jobs still require their production provider credentials/configuration.

## Verification

`tsc -b` passes on this source tree. Full Vite bundling could not be rerun in the build container because the uploaded `node_modules` contains platform-specific optional Rollup binaries; Cloudflare will perform a clean Linux dependency install during deployment.
