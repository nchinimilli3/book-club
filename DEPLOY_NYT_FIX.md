# NYT Best Sellers production check

The NYT API key stays only on the `book-club-api` Worker as `NYT_BOOKS_API_KEY`.

Production now uses a same-origin Pages endpoint. `functions/api/[[path]].ts` forwards `/api/*` to the `book-club-api` Worker through the `BOOK_CLUB_API` Service Binding declared in the root `wrangler.toml`.

## Deploy

1. Deploy `worker/` as the Worker named `book-club-api` and confirm `NYT_BOOKS_API_KEY` exists as a Worker secret.
2. Deploy the Pages project from this updated source. The root `wrangler.toml` declares `BOOK_CLUB_API -> book-club-api`.
3. If your existing Pages project does not adopt the binding from Wrangler, add it in Cloudflare Dashboard: Pages project > Settings > Bindings > Add > Service binding. Variable name: `BOOK_CLUB_API`. Service: `book-club-api`. Then redeploy Pages.

## Verify

Open these on the deployed Pages domain:

- `/api/health` should return JSON with `services.nyt: true`.
- `/api/book-discovery` should return `nytConfigured: true`, `nytStatus: "ok"`, and a non-empty `nyt` array.

The Search page now exposes the real failure state if either check fails, rather than the old generic “Best Sellers will appear once NYT is connected” message.
