# BOOK CLUB — production release audit

## Product contract

All primary UI state resolves through real entities:

`auth user → active club → club book / ballot / meeting → user progress and actions`

The runtime contains no demo-club, Rebecca or Sunday Readers fallback. Direct club/book routes first select the route's actual club before rendering its data.

## Complete product surfaces in this release

### Account + private clubs
- signup/sign-in/session/logout/password recovery
- profile basics/settings/export/delete-account flow
- private club create/join/switch
- revocable/expiring invites
- ownership-aware account deletion
- persisted active club

### Choosing
- live catalog search
- quick Add idea without losing search state
- book decision guide
- Suggested by attribution
- club taste recommendations endpoint
- owner/admin hidden ballot creation
- one changeable member vote
- explicit tie/no-vote handling
- unique winner promotion to acquisition

### Reading
- acquisition format check-in
- finish date + generated checkpoints
- progress persistence and spoiler boundary
- locked-post count
- posts, replies and reactions
- sealed predictions
- private notes and quotes
- save/remove meeting agenda item
- source-backed Reader Context with clean no-data states

### Meetings
- schedule/update/cancel meeting
- RSVP + readiness
- agenda from saved discussion items
- one-time calendar link fallback
- Google Calendar OAuth connect/status/disconnect
- Google event create/update/remove sync through Worker

### Profile + archive
- personal library via Search
- Goodreads CSV import/re-import
- Favorites independent of rating
- ratings and shelf editing
- acrylic shelf presentation
- reading-year summary
- persistent profile styling/stickers
- finished-book archive and annual volume summary

### Production behavior
- realtime subscriptions for social/meeting/reading surfaces
- notifications inbox + unread count/deep links
- first-party product funnel telemetry
- client error logging
- graceful AI/provider failure paths
- release database validator
- static route/button/RPC/sticker-asset audit

## Security

Club/social tables use RLS. `anon` private CRUD grants are explicitly revoked. The browser uses only the publishable Supabase key. Google tokens and the Supabase service role are Worker-only; Google token payloads are encrypted before storage.

The required live privacy test uses three accounts: A+B share Club 1, B+C share Club 2, and A must be unable to read Club 2 through UI, direct route, REST/RPC or realtime.

## Provider activation

The implementation is present, but production credentials are external deployment requirements:

- Google OAuth credentials + exact callback URL activate two-way Calendar event sync.
- OpenAI Worker secret activates AI decision/context/recommendation synthesis.
- Custom SMTP is recommended before broad invitation-email usage.

The app must remain usable when these providers are unavailable.

## Automated validation

`npm run test:release` currently validates TypeScript, product smoke checks, source-level button/route/RPC/asset invariants, schema-contract coverage and Worker JavaScript syntax.

The final production sign-off is the SQL `PASS` report plus the live multi-account lifecycle test; neither is faked by local/demo state.

## CSS architecture split — 2026-08-26

The canonical deep-refactor stylesheet was split from one global file into an explicit ownership tree under `src/styles/`.

Validation performed for this split:

- 2,617 selector/context combinations match the pre-split canonical stylesheet
- 0 declaration-sequence differences
- 0 protected acrylic/shelf differences
- all 25 CSS files (including the root index) parse successfully with PostCSS
- production smoke checks pass
- schema/RPC contract audit passes (27 tables, 33 RPCs)
- Worker syntax check passes
- production UI primitive/acrylic hash lock passes

A fresh full TypeScript/Vite run was not repeated in the container because dependency installation could not complete in the network-isolated environment. This pass changes CSS ownership, the root CSS import path, documentation, and adds PostCSS as an explicit dev dependency; it does not change application TypeScript behavior.
