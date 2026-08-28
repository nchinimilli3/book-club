# Preservation Refactor Notes

## Baseline

The visual source of truth for this pass is GitHub commit `2a8bd4cd95a84b856f6fdc76ace39396b90fa51a` (2026-08-26). The refactor preserves the behavior represented by that commit while removing historical cascade debt beneath it.

## Locked acrylic shelf

The acrylic shelf is regression-locked and was not refactored.

Do not edit without explicitly unlocking:

- `src/components/AcrylicBookshelf.tsx`
- `src/components/acrylic-bookshelf.css`
- protected shelf/acrylic integration selectors (now in `src/styles/features/shelves.locked.css`)
- `.shelf-object`, `.shelf-track`, `.shelf-books-new`, `.shelf-book-*`

Verification after the refactor:

- `AcrylicBookshelf.tsx` SHA-256: `e420be84ebbeff69ad6528c55f48138b502f4cad67d52446e77776fb76ac5bb7`
- `acrylic-bookshelf.css` SHA-256: `bc8316a779c30aeb4ed7e2861da165be416f4c3cb536679a040206949cac5728`
- all protected shelf/acrylic rule snapshots moved into `shelves.locked.css` with declaration parity against the baseline.

## Reading Room architecture

`src/pages/ReadingRoom.tsx` is now the page orchestrator instead of owning every helper and modal implementation.

Extracted boundaries:

- `src/features/reading-room/readingRoomUtils.ts`
- `src/features/reading-room/useReadingRoomData.ts`
- `src/features/reading-room/ReadingRoomShell.tsx`
- `src/features/reading-room/ReadingRoomModals.tsx`
- `src/features/reading-room/types.ts`

The refactor also removes the unused `nextMeetingOption` variable that failed the strict TypeScript build.

## CSS consolidation

Baseline `system.css`:

- 4,249 lines
- 438,596 bytes
- 6,317 `!important` tokens
- 943 selector strings repeated somewhere in the stylesheet

After consolidation:

- 3,849 lines
- ~287 KB
- 273 `!important` tokens
- repeated same-selector/same-context rules were canonicalized outside the protected shelf boundary

What was removed/consolidated:

- declarations provably shadowed by a later identical selector/property/context
- rules whose classes are no longer referenced by current React source
- empty rules left by pruning
- historical repeated feature selectors consolidated into a single rule per cascade context
- unnecessary `!important` declarations removed using a specificity/source-order preservation model

The raw audit still reports selectors reused across the whole stylesheet because a selector correctly appearing once at base and once inside a mobile media query is not architectural duplication.

## Verification

The following pass after the refactor:

- strict TypeScript build
- production smoke checks
- static release audit
- schema/RPC contract audit
- Worker syntax check
- production UI primitive audit
- acrylic lock audit

## Source-package hygiene

Clean handoff ZIPs omit `.git`, `dist`, `node_modules`, TypeScript build info, caches, logs, and `.DS_Store`. `public/` remains because it contains live product assets.


## CSS ownership split

The canonical stylesheet is now split into foundation, shared component, and product-feature owners under `src/styles/`. `src/styles/index.css` is the single cascade entry point. See `CSS_ARCHITECTURE.md`. The old `src/styles/system.css` file no longer exists.
