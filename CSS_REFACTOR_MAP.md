# CSS Preservation Refactor Map

This app's current visual design is treated as approved. The first CSS refactor goal is preservation: identify the live cascade winners, consolidate one component at a time, and verify screenshots before deleting superseded historical rules.

## Protected Boundary

Do not edit these files or selectors during the CSS cleanup unless the acrylic shelf work is explicitly unlocked:

- `src/components/AcrylicBookshelf.tsx`
- `src/components/acrylic-bookshelf.css`
- `.acrylic-*`
- `.acrylic*`
- `.home-acrylic*`
- `.profile-acrylic-*`
- `.shelf-object`
- `.shelf-track`
- `.shelf-books-new`
- `.shelf-book-*`

The current lock is enforced by `scripts/audit-ui-primitives.mjs` against `ACRYLIC_LOCK.sha256`.

## Refactor Order

1. Global tokens/header
2. Club homepage
3. Progress race/sailing
4. Meetings
5. Search
6. Reading Room
7. Profile, excluding every acrylic selector
8. Sticker editor
9. Onboarding
10. Notifications

Sticker editor and Reading Room are the highest-risk non-shelf areas because both have many late override passes. Consolidate them only after baseline screenshots exist for desktop, tablet, and mobile.

## Component Workflow

For each component:

1. Run `npm run audit:css` and note every occurrence for the component selectors.
2. Capture current desktop, tablet, and mobile screenshots.
3. Determine the computed winner for the component's base and responsive states.
4. Create one canonical base block and the minimum responsive blocks.
5. Verify screenshots against the baseline.
6. Remove only the superseded rules for that component.

Avoid broad cleanup while a component is being consolidated. Do not remove `!important`, change breakpoints, rename classes, or split `system.css` as part of the same step unless it is necessary for that component and has visual parity coverage.

## Current Cascade Risk

`system.css` contains a `feedback-final.css` section that says it intentionally loads last, but substantial CSS appears after it. Treat comments such as "final" and "source of truth" as historical notes until the actual cascade has been checked.

Use `scripts/audit-css-architecture.mjs` as the repeatable starting point for this check.
