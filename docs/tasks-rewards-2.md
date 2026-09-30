# Opgaver & Belønninger 2.0

> Historical implementation record. Weekly symbols and celebrations were deprecated by [Rewards 2.1](rewards-2.1.md); only allowance and bonus stars remain active.

Rollback baseline: `12f28ffad074b2ed5da2306a0cd7b00b1bc4f3fa`. Branch `main` matched `origin/main`, with a clean working tree at the start. Product UX 2.3 was visually approved. This implementation remains local for review; no commit, push, frontend deployment or signing.

## Product and storage

The calendar remains the task source. Existing tasks retain their normal completion semantics and weekly symbols. New task settings are `rewardMode` (`none`, `allowance`, `stars`), integer `starValue`, `requiresApproval`, and optional `bonusPool`. Server-owned `rewardOriginId`, `originalDate` and `rewardRules` preserve identity and date-specific rules across overrides, moves and future series splits. Clients cannot supply their own reward history.

The master participation flag remains `household_people.reward_enabled`. `reward_person_config` adds allowance, integer øre, bonus stars, weekly celebration and default approval preferences. Existing people/tasks receive no automatic stars, allowance configuration or historical snapshots.

## Allowance rules

- Each actual occurrence counts once per assigned person. `Alle` uses each participating profile independently.
- The current month's future occurrences belong to its plan. Weekly starts/ends, exceptions, overrides, deletions and moved dates follow calendar materialization.
- Only completed/approved occurrences count in the numerator. Pending/rejected tasks do not. Excused/cancelled tasks leave the denominator; adult excuse reasons are audited.
- Money is stored in integer øre and rounded to the nearest øre. Zero eligible tasks yields zero earned allowance, not an automatic full payment.
- The current monthly amount is latched in `reward_allowance_periods`. Later amount changes affect the next month. Initial participation starts today; subsequent enable/disable/archive changes affect dates from tomorrow, retaining earlier eligibility.
- Lazy finalization runs under the same household transaction lock before calendar/profile/reward writes and on `get_reward_state`. It finalizes all elapsed months since configuration began using Copenhagen civil dates. Snapshots are unique and their totals never change later. Payout only records who marked the amount paid and when; no bank/payment provider is involved.
- A later undo can change an old task's completion but does not rewrite a finalized allowance month.

## Stars, approvals and shop

`reward_star_ledger` is append-only to application clients. Balance is the sum of all entries; the state endpoint returns a recent history window while export includes the full ledger. Completion freezes the task rule for that person/occurrence. Changes to a started occurrence's rule begin after its active date; existing ledger entries and snapshots are preserved.

Approval-required tasks first become pending. Only authenticated owner/admin/adult members may approve/reject, excuse/unexcuse, configure rewards, manage the catalog or mark payouts. Child profiles themselves are not authentication roles. A child login cannot edit/delete a configured reward task, forge inherited rules, or undo an adult excuse. Normal legacy calendar editing is retained.

Each completion cycle has a unique ledger key; retries use a persisted request receipt. Undo/reject appends a reversal. A deliberate reversal after spending can make the ledger balance negative; that is an auditable correction, not a concurrent overspend. No further redemption can be approved until the balance covers its cost.

Catalog price/title are snapshotted on redemption. Pending requests reserve and debit nothing. Adult approval checks the current balance and appends one debit under a household lock; concurrent requests cannot overdraw. A pending request may be cancelled; an approved one may be marked fulfilled. Catalog deactivation removes its goals, but existing redemption requests remain available for adult handling at their original price.

One selected goal per profile reserves no balance. Bonus pool claims are atomic and unique per occurrence. Weekly feedback retains coins/gold/diamonds/crown and one celebration at each 7/9/12 crossing. Managed tasks use the same approved/completed state for week and month.

## App flows

The existing five destinations and single global creation button remain. Tasks shows compact person summaries or a selected child's month/week/stars/goal dashboard, plus Today/Week/Month/Rewards. The shop includes goals, parent requests, bonus opportunities and folded history. Family profiles open reward settings and Min dag.

Min dag contains today's activities, tasks, monthly state and stars without administration. Kiosk summaries open Min dag; small wall screens use compact status tiles. Parent management is available on normal web/mobile. The quick task editor puts title/person/date first, offers Today/Tomorrow/Date and None/Weekly/Weekdays, and folds reward/advanced options. The weekdays shortcut creates five weekly bases using the existing calendar planner.

## Offline and realtime

The existing IndexedDB user/household scope stores reward views. Completion and undo use the durable queue and stable receipt UUID; pending/complete state is optimistic, while stars are only authoritative after server acknowledgment. Calendar create/edit still uses the existing conflict-aware queue. Rejections roll back optimistic completion and remain visible for resolution.

Claim, approval, configuration and redemption require a connection. Redemption says: “Du skal være online for at indløse en belønning.” The existing `calendar_revisions` subscription also invalidates reward state, so approvals, catalog changes, balances and payouts reach other devices. Household/session changes discard stale requests. Open history and editor drafts survive refreshes.

## Security and privacy

New tables enable household RLS and expose SELECT only to authenticated members. Validated RPCs own mutations; sensitive actions check the real membership role. Household locks, tenant foreign keys, occurrence uniqueness and immutable request receipts protect concurrency. No browser service key is added. New data is included in family export and household/account deletion semantics; author references anonymize when an account disappears. Archived profiles retain history. Privacy page and store data inventory describe the added data.

## Verification and rollout

Local suites: Node unit tests, PostgreSQL rollback fixtures, API concurrency/RLS tests, Edge Function checks, and every existing Mega/Product UX browser suite. `app/tests/rewards-v2-browser.mjs` exercises mobile, two-device realtime, offline reload/replay, parent management, child view and kiosk. Gallery: `supabase/.temp/rewards2/index.html` (ignored review output).

Final checks passed: 101 Node tests, 170 PostgreSQL assertions, 13 Edge tests, 121 numbered existing browser checks plus the foundation browser flow, 16 new reward browser checks, and 39 reward API checks on both local and live. The web build, Capacitor Android/iOS sync, 11 native structure checks and release secret scan passed. Physical native device runtime was not tested. Detailed rollout evidence is in [the release record](releases/2026-09-29-rewards-v2.json).

Live execution is restricted to project `oyyqniwppytipdktzwsy`. The preflight schema matches `supabase/schema/live-after-release.json`; backup 1814861545 from 2026-09-29 03:34:48 UTC is COMPLETED. Current schema dump and preflight hashes are stored under ignored `supabase/.temp/`. The final release record documents migration, before/after fingerprints, smoke cleanup and test counts.

Rollback is a previous frontend build from the baseline, leaving additive reward data intact. Do not drop ledger/snapshot tables or restore a whole database as a routine UI rollback, because that would discard later family activity. A later deployment must ship the matching app build; this task does not deploy the public frontend.