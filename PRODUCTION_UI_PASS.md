# Production UI Component Pass

This build introduces shared production primitives without changing the locked acrylic shelf implementation.

- `BookRail`: one responsive, accessible rail for discovery/catalog books.
- `BookAddMenu`: one destination picker for club/personal shelves.
- `CatalogBook` adapters: normalizes NYT, Apple, and search book data before rendering.
- `PageState`: consistent empty/error/loading states.
- `FeedbackMessage`: consistent status/error announcements.
- `AppErrorBoundary`: catches render failures and offers recovery.
- Global `:focus-visible`, reduced-motion, and touch behavior are standardized.
- `audit-ui-primitives.mjs` prevents Search from forking the rail again and verifies the acrylic shelf hashes on every release audit.

The acrylic shelf component and stylesheet remain byte-for-byte identical to the approved locked version.
