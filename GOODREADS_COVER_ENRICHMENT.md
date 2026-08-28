# Goodreads cover enrichment

Implemented against the existing Book Club architecture.

- Goodreads CSV metadata remains the source of reading history.
- Cover resolution is centralized in the Cloudflare Worker.
- Resolution order: Goodreads cover API by ISBN, Goodreads cover API by title/author, Apple Books, Open Library, existing fallback.
- Provider failures never fail the import.
- Resolved covers are persisted to the existing `books.cover_url` field; ordinary rendering does not call the provider.
- Existing high-quality covers are preserved.
- A protected, bounded maintenance route is available at `POST /api/maintenance/backfill-goodreads-covers`.

## Production setup

Set a Worker secret before using the maintenance backfill:

```sh
wrangler secret put MAINTENANCE_SECRET
```

Then redeploy the Worker. The backfill route requires an `x-maintenance-key` header matching that secret. Use batches of at most 50 and continue with the returned `nextCursor` until it is `null`.

No database migration is required for this feature.
