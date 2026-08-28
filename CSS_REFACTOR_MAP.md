# CSS Ownership / Preservation Map

The old monolithic `src/styles/system.css` has been retired. The current design is still treated as approved and preservation-first.

## Global entry point

`src/main.tsx` imports only:

- `src/styles/index.css`

`index.css` declares the cascade order explicitly. Do not add a second global stylesheet import in `main.tsx`.

## Ownership

Foundation:
- `src/styles/foundation/tokens.css`
- `src/styles/foundation/globals.css`

Shared UI:
- `src/styles/components/navigation.css`
- `src/styles/components/buttons.css`
- `src/styles/components/forms.css`
- `src/styles/components/modal.css`
- `src/styles/components/books.css`
- `src/styles/components/status.css`
- `src/styles/components/calendar.css`
- `src/styles/components/shared.css`

Features:
- `src/styles/features/auth.css`
- `src/styles/features/clubs.css`
- `src/styles/features/archive.css`
- `src/styles/features/member-profile.css`
- `src/styles/features/club-home.css`
- `src/styles/features/search.css`
- `src/styles/features/meetings.css`
- `src/styles/features/reading-room.css`
- `src/styles/features/profile.css`
- `src/styles/features/stickers.css`
- `src/styles/features/onboarding.css`
- `src/styles/features/notifications.css`
- `src/styles/features/settings.css`

## Protected shelf boundary

Do not edit without explicitly unlocking:

- `src/components/AcrylicBookshelf.tsx`
- `src/components/acrylic-bookshelf.css`
- `src/styles/features/shelves.locked.css`

The component files remain enforced by `ACRYLIC_LOCK.sha256` and `scripts/audit-ui-primitives.mjs`.

## Rules for future work

1. Put new CSS in the owner file for that component/feature.
2. Do not create dated “feedback pass”, “final pass”, or “final final” blocks.
3. Do not add a new global override file to make a feature win the cascade.
4. Prefer component/feature ownership over `!important`.
5. If a selector genuinely spans multiple surfaces, use a shared component stylesheet and document the reason.
6. Run `npm run audit:css` after CSS changes.
7. Preserve the shelf lock unless the shelf itself is the explicit task.

## Split verification

The split was checked against the canonical deep-refactor monolith:

- 2,617 selector/context combinations before and after
- 0 declaration-sequence differences
- 0 protected shelf/acrylic differences
- 0 same-context duplicate groups outside the protected shelf boundary
