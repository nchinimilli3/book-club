# AGENTS.md

## Design direction
- Visual goal: make it look like a **colorful scrapbook**, with every element sitting on top of paper.
  - Not beige paper on beige paper. Use real color: tinted cardstock, sticky notes in several colors, patterned paper.
  - Paper should behave like paper. A torn piece shows a ragged edge with a light fringe where the fibers ripped. Taped pieces have visible tape. Things cast a soft shadow.
- Leave the **shelves** alone unless asked (`AcrylicBookshelf`, `.editorial-club-shelves`, `.home-acrylic`, `shelves.locked.css`). The UI audit hashes them and fails if they change.
- Home colors come from the current book's cover. `HomePage.tsx` sets `--home-accent`, `--home-accent-2`, `--home-accent-soft`, `--home-deep`, `--home-bg`, `--home-wash` and `--home-ink`. Build on these so each book gives the page its own palette.

## CSS layout
- Home styling is spread across `club-home.css`, `meetings.css` and `reading-room.css`, and many selectors are repeated with later rules overriding earlier ones.
- Add new Home visual work to `src/styles/features/home-realism.css` (imported last in `src/styles/index.css`) and prefix selectors with `.club-home.editorial-home` so they win over the older rules.
- Some pseudo-elements are already taken: `.editorial-current::after` is a cover decoration, and `.editorial-current::before` is the full-width background band.
- Torn edges: use `clip-path: polygon(...)`. Note that `clip-path` also cuts off that element's own shadow, so draw the paper on a `::before`/`::after` layer and fake the shadow with an offset copy of the shape.

## Build and checks
- If `npm run build` fails with `MODULE_NOT_FOUND` from rollup: `npm i --no-save @rollup/rollup-linux-x64-gnu`. Revert `node_modules/.package-lock.json` afterwards.
- `npm run audit:css` and `npm run test:ui` already fail on the main branch (duplicate selectors, and a changed hash for `AcrylicBookshelf.tsx`). Compare against the branch before your change rather than treating these as your regressions.
- Some files in `dist/` and `tsconfig.app.tsbuildinfo` are tracked even though `dist` is gitignored, so every build makes them show as changed. Commit them with `git add -u dist`, or untrack them.
- The full Home Screen only renders with the backend running. For a visual check without it, build, then load `dist/assets/index-*.css` into a static HTML page with sample Home markup and screenshot it with `/opt/pw-browsers` Chromium.
