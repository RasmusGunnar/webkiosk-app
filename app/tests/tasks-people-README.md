# Tasks and people UX verification

Worktree: `supabase/.temp/native-main-sync`, branch `feature/tasks-people-ux`.
No commit, push, hosted migration or deployment is part of this batch.

## Model and compatibility

All tasks now use `task_reward_occurrences`, keyed uniquely by household,
origin, occurrence date and `person_id`. Calendar items remain task templates.
The existing `open`, `completed`, `pending`, `approved` and `excused` states are
reused. Calendar, Today, task cards, details, offline overlays and wall completion
read/write that same state. Per-person actions do not create calendar overrides.

Migration `20261107120323_tasks_people_status.sql` backfills ordinary legacy
shared DONE into completed occurrences for every currently assigned person,
including archived people. The old data did not record which person actually
completed the task; preserving the previous visible result for all existing
assignees is deliberate. Only the original date or concrete override is copied,
never subsequent weekly occurrences or people added later. Existing occurrence
rows win. The legacy boolean is retained for compatibility but is no longer read
as a person's status. Attempts to set a shared DONE from old clients are rejected.
Ship the migration with the new UI after review; it has NOT been applied remotely.

Authorization remains `private.is_reward_adult`, based on authenticated household
membership. An adult member completing for an adult person can finish directly;
a child person still requires approval, including when selected on a shared adult
session. There is no new inferred account-to-person link. Names/ages never grant
permission. Children/devices cannot approve, excuse, unexcuse or reopen approved
work. An adult can reopen completed/approved work or remove an excuse in an open
period. Locked contracts, denominator calculations, frozen amounts, snapshots,
star reversal and payouts retain the existing implementation.

The central `person-avatars.js` helper is shared by selectors, person filters,
calendar/Today compact cards, task rows/details and existing person summaries.
Photos use the existing resolved avatar URL; failures reveal initials. Restricted
paired wall snapshots continue to expose only their existing person projection,
so private stored photos are not newly exposed to devices. They show initials.

## Run from app/

```sh
npm ci
npm test
npm run test:tasks-people:db
npm run test:tasks-people:browser
npm run test:stars:db
npm run test:stars:browser
npm run check:i18n
npm run build
npm run verify:native
```

`tasks-people-db.mjs` applies the real migrations to PostgreSQL/WASM (PGlite).
It bootstraps minimal Auth/Storage schemas and omits the cron scheduling migration.
Tests exercise actual RPC functions, authenticated database roles, RLS, forged
status attempts, cross-household isolation, wall capability/revocation guards,
legacy backfill, independent completion/reopen, allowance denominators, locked
contracts, star reversals and revision invalidation.

`tasks-people-browser.mjs` starts Vite on loopback port 5196, launches local Chrome
and runs the real app against a loopback-only fixture HTTP/Auth bridge to that
database. External requests are blocked. It exercises real IndexedDB offline
queue/replay, reload, picker keyboard/touch/focus, photo fallback, approval/excuse,
calendar details, reduced motion and 375/390/430/768/1440px plus kiosk layouts.
It saves the gallery and JSON results under
`supabase/.temp/tasks-people-ux/` relative to this worktree.

## Stars 1.0

Migration `20261107124614_stars_motivation.sql` is separate from the unchanged
person-status migration. It reuses `reward_star_ledger`, `reward_catalog`,
`reward_goals`, `reward_redemptions` and `reward_requests`. Balances remain the
sum of the existing ledger; allowance amounts and period snapshots are unchanged.
No rewards are seeded automatically.

The one added identity column is `household_members.person_id`. Adult members
link child accounts to child people through the existing validated reward RPC;
the client has no direct write grant. Names and ages never imply ownership.
Existing child accounts start unlinked and see an explanation. Under Family,
an owner/admin can invite a Child account; in Rewards > Child logins an adult
then links the accepted account. Children may choose goals/request redemption
only for that linked person. Adults may act on a child's behalf. Wall UI remains
read-only for rewards. Membership changes invalidate the existing reward revision.

Pending requests do not debit stars. Approval uses the existing household
transaction lock, balance recheck, redemption row lock and unique ledger key.
Retries reuse a pending redemption and approvals debit at most once. Immutable
title/icon/price snapshots survive catalog edits and deactivation. Approval clears
only the matching goal. Used rewards may be deactivated; deletion is limited to
rewards with neither goals nor redemption history. Inactive goals stay visible
with an explanation and a change-goal action.

`stars-db.mjs` adds actual SQL/RLS checks including ownership, a second household,
pending bonus awards, goal changes, snapshots, double submissions, rejection and
insufficient approval balance. PGlite executes on one connection, so simultaneous
submissions are **not** proof of real multi-connection contention behavior.
`stars-browser.mjs` tests the real UI through the same isolated fixture bridge
and appends the Stars section to the gallery. Run the core browser suite first,
then the stars suite; both use port 5196. Browser results include screenshots for
all four editors, child/adult states, 375px, desktop and read-only wall.

## Coverage boundary / remaining gate

Docker Desktop cannot currently start on this machine (confirmed by the user).
The tests above do **not** claim to verify Supabase Auth, PostgREST HTTP behavior
or cross-device Supabase Realtime websocket delivery. The database revision
trigger and frontend realtime unit regressions are covered separately. Before
merging/deploying, run the local Supabase API suites (including the updated
`rewards-v2-api.mjs` and `allowance-agreements-api.mjs`) and a two-client realtime
browser scenario against a real local stack. Include child account linking and
ownership, catalog CRUD, goal changes, request/approve/reject RPCs and competing
approvals over separate real database connections. The maintained API suite has
been updated for child identity links and concurrent redemption approvals but has
not been run in this environment. Native structure and RevenueCat
mock/contract checks do not substitute for physical store/device testing.
