# Rewards 2.1

Built on the uncommitted Tasks & Rewards 2.0 working tree. Git rollback baseline remains `12f28ffad074b2ed5da2306a0cd7b00b1bc4f3fa`. No commit, push, public frontend deployment, signing or store submission.

## Two reward systems

Monthly allowance and bonus stars remain separate. The shop, goal, approval, bonus pool, calendar recurrence, offline queue and realtime are retained. Weekly task counts are plain descriptive text, not a reward tier.

Legacy weekly celebration is **deprecated as of Rewards 2.1**. Person chips have no reward symbols. The popup module, confetti CSS, symbol/level generators, celebration loading and queue callbacks are removed. Reward settings no longer expose weekly celebration. Both server mutation entry points stop generating weekly claims; their empty `celebrations` response property remains only for compatibility with an older client.

The `reward_celebrations` table, its historical rows and `weekly_celebration_enabled` column remain. The column is ignored by configuration writes and excluded from active reward state; existing values are not rewritten. Historical weekly records remain available in family export. Old IndexedDB snapshots may still contain an unused legacy property until normal cache cleanup.

## Confirmed feedback

`reward-transitions.js` observes authoritative reward snapshots. Hydration establishes a silent baseline. Ledger row IDs, occurrence revisions and redemption ID/status pairs prevent duplicate feedback. Monthly comparisons use matching person/year/month; a new month is a quiet baseline. Ordinary task completion only changes the check, with no money or star effect.

`reward-motion.js` owns the animation lifecycle: a single requestAnimationFrame loop, count/progress helpers, transient deltas, task checks and milestones. DOM replacement continues the current timeline instead of enqueueing another event. Household/logout reset cancels the frame, clears effects and forgets the old scope. Motion observations are local DOM events for verification, not analytics/network events.

- Counts and progress use a 600 ms eased transition.
- Task check/pending feedback lasts 650 ms; star deltas 800 ms.
- Goal unlock/redemption approval feedback lasts at most 1 second.
- The monthly milestone lasts at most 1.5 seconds and never opens a modal.
- Reduced motion updates counters directly and suppresses row movement/glow. Text, status and final screen-reader values remain available.

Star effects use actual ledger entries, including negative reversals and redemption debits. Pending approval never awards stars. Goal selection or initial app opening does not simulate an award. Redemption confirmation names the reward and exact price; pending requests say “Sendt til godkendelse”, approved requests “Godkendt · Klar”.

## Offline and monthly milestones

The durable completion queue retains its stable request UUID. Offline checks are optimistic and explicitly show pending synchronization. Displayed allowance and stars remain at their last confirmed server values, including after offline reload. A successful replay emits the confirmed change once; duplicate ACK/realtime snapshots do not emit it again. Approval and redemption still require a connection.

`reward_monthly_milestones` records one display claim per household/person/month. On a newly observed transition to a nonempty, fully completed current month, the client calls `claim_reward_milestone`. The server verifies membership, person/config and current monthly totals under the existing household lock, then inserts with a unique primary key. Only the winning caller may show the effect. Retries, another device, undo/re-complete and reload cannot repeat an already claimed milestone. Initial/historical hydration never requests a display. A failed claim does not block the task or reward outcome.

Milestones have household RLS and client SELECT only. The public invoker wrapper calls a private definer with explicit authentication and membership checks. No service key enters the frontend. The new rows are included in export and cascade with family/profile deletion; they have no payment effect.

## Rollout and verification

Migration `20260930091444_rewards_21_simplify.sql` adds the milestone table/RPC and replaces active weekly mutation behavior without dropping schema or changing historical rows. The live preflight matched `live-after-rewards-v2.json`. Backup `1824392287`, 2026-09-30 03:36:11 UTC, was COMPLETED. All 25 original table fingerprints matched before migration, immediately afterward and after the isolated live smoke cleanup, including all 486 calendar rows. No test milestone rows remained. Advisors reported no new warnings/errors.

Passing checks: 119 unit tests, 185 PostgreSQL assertions, 13 Edge tests, 121 existing numbered Mega/Product UX browser checks plus the foundation flow, 16 Rewards 2.0 browser checks, 28 Rewards 2.1 browser checks, and 43 reward API checks on each of local and live. Legacy tests now assert absence of weekly effects while retaining their recurrence, RLS, completion, conflict and offline assertions.

Review: `supabase/.temp/rewards21/index.html`, with viewport screenshots and `animation-evidence.json` recording semantic events and intermediate counter frames. These synthetic review outputs are Git-ignored. Live schema metadata and rollout evidence are versioned in `supabase/schema/live-after-rewards-21.json` and `docs/releases/2026-09-30-rewards-21.json`.

The web build and Android/iOS Capacitor sync must accompany release. Native verification is structural; physical device runtime/signing/store acceptance is outside this task. Frontend rollback leaves additive historical data intact; do not restore/drop tables for a UI rollback. The retired weekly effects are deliberately not re-enabled by this migration.
