# CSS Architecture

The former `src/styles/system.css` monolith has been retired. Styles are organized by ownership, with a single explicit cascade entry point at `src/styles/index.css`.

## Foundation

- `src/styles/foundation/tokens.css` — font imports, design tokens, theme/tone variables
- `src/styles/foundation/globals.css` — reset, app/page shell, accessibility, reduced-motion behavior

## Shared UI primitives

- `src/styles/components/navigation.css`
- `src/styles/components/buttons.css`
- `src/styles/components/forms.css`
- `src/styles/components/modal.css`
- `src/styles/components/books.css`
- `src/styles/components/status.css`
- `src/styles/components/calendar.css`
- `src/styles/components/shared.css` — small compatibility layer for selectors genuinely shared by multiple surfaces

## Product surfaces

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

## Acrylic shelf boundary

`src/styles/features/shelves.locked.css` contains the protected shelf integration rules that used to live inside `system.css`.

The bespoke acrylic implementation remains colocated and hash-locked:

- `src/components/AcrylicBookshelf.tsx`
- `src/components/acrylic-bookshelf.css`

Do not merge or rewrite the locked shelf files without explicit visual-regression coverage.

## Cascade policy

`src/styles/index.css` is the only global CSS entry point and is imported once by `src/main.tsx`. Shared primitives load first, then product surfaces, then the explicitly locked shelf integration layer and the small shared compatibility layer.

New styles should go into the file that owns the component or feature. Do not append new “feedback pass” sections to the bottom of a global file. If a rule genuinely spans surfaces, put it in a shared primitive file and document why.

## Preservation verification

The split was generated from the canonical deep-refactor stylesheet. A selector/context parity audit compared the monolith with the split output and found:

- 2,617 selector/context combinations before and after
- 0 declaration-sequence differences
- 0 protected acrylic/shelf differences
- 0 same-context duplicate selector groups outside the protected acrylic/shelf boundary

The CSS architecture audit now scans all owned files instead of assuming one `system.css` file.
