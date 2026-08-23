# Visual-design handoff — preserve production wiring

Claude may redesign the scrapbook/profile composition, but the production data contract must remain intact.

## Safe to redesign
- Profile markup/layout and visual-only components
- shelf/sticker/canvas presentation
- CSS, typography, spacing and decorative assets

## Do not replace with local/demo state
- `src/lib/AppContext.tsx`
- `src/lib/data.ts`
- `src/lib/supabase.ts`
- `src/lib/api.ts`
- entity routes in `src/App.tsx`
- real IDs (`clubId`, `clubBookId`, `bookId`, `personal_books.id`)

## Persistence rules
- personal shelves/ratings/Favorites come from `personal_books`
- Favorites use `personal_books.is_favorite`
- stickers live in `profiles.profile_style.stickers`
- preserve unknown `profile_style` keys when saving visual edits
- sticker Done saves locally first and then verifies `save_my_profile_style_v3`

## Product rules to preserve
- Add from Search to a club creates an idea only; it never becomes current read directly
- idea attribution uses `club_books.created_by`
- vote lifecycle goes through database RPCs; do not simulate locally
- progress controls spoiler visibility
- direct book routes stay scoped to the URL's club
- meeting/calendar actions operate on real meeting IDs
- privacy is enforced by Supabase RLS; do not add public mirrors
