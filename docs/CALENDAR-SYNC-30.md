# Calendar Import & Sync 3.0

Local implementation only. No hosted migration, function deployment or cron activation has been performed in this task.

## Identity and legacy repair

One identity: household + feed + VEVENT UID + RECURRENCE-ID, or `single` for non-recurring events. Expanded recurrence uses its original recurrence slot, including moved occurrences. The parser is shared by manual and scheduled imports. The existing `calendar_items_external_unique` index is reused; a trigger derives canonical `source`, `calendar_id` and `external_id` and mirrors the JSON fields. Title, location and new start/end time never define identity.

The realistic local copy contained 252 legacy imported rows with source/feed identity only in JSON. The previous editor required a top-level calendar_id; the old duplicate repair required a top-level source. This bypassed both editing and deduplication for these rows. There were 54 proven duplicate rows (40 Google, 14 Aula), not all same-title events.

`supabase/operations/reconcile-calendar-imports.sql` is a separate maintenance operation, not run by schema installation. Review the immutable groups first. It archives duplicates in the existing calendar_import_archives table before removal, preserves canonical UUID, done, stable people, field overrides and hidden exclusions. Conflicting assignments/overrides or multiple task relations stop the transaction. Detached duplicates require manual reconciliation. An ordinary import refuses unresolved duplicate groups rather than discarding data. Calendar rows with no proven external identity are not merged.

A complete, validated feed can mark missing source occurrences as `importSourceRemoved`. They disappear from the UI but stay in the database with their UUID and local data. A later source reappearance reuses the row. Failed HTTP, malformed components, truncated calendars or rejected batches never perform cleanup.

## Overrides and restore

Existing calendar_import_overrides remains authoritative. Source values are kept separately in importSource; only changed form fields enter the patch. Person assignment uses household_person UUIDs. Sync refreshes non-overridden source fields without resetting local assignments.

Removal means local exclusion, never source write-back. Single occurrence uses the original recurrence identity; series uses feed + UID and '*'. Feed settings list hidden exclusions through membership-checked RPCs, including exclusions outside the current import window. Restoring a series does not silently undo separate per-occurrence exclusions. Source-removed events cannot be restored while absent from the source.

## Scheduler

Cron (every five minutes) → private.dispatch_calendar_sync → sync-calendar-feeds → shared calendar-import core → atomic database importer.

The endpoint validates a dedicated server secret using fixed-length SHA-256 digest comparison before creating the privileged client. An anon/publishable key alone cannot invoke it. Request body IDs are ignored. The service-only due-feed query selects up to 10 active due feeds, oldest attempt first. Two workers limit concurrency. Each feed uses the same two-minute database lease as manual imports. Token checks fence expired claims and configuration changes. One failed feed does not stop the batch.

Reuse last_sync_at as the successful timestamp, last_sync_status/last_sync_message as bounded status, import_token/import_started_at as lease. Add last_attempt_at and last_result. Inactive feeds are skipped and preserve calendar data. App startup reads Supabase; it does not fetch source feeds. Existing calendar_revisions Realtime subscription carries data and status updates without a second polling loop. Identical imports do not update unchanged calendar rows or reapply unchanged overrides; this avoids revision storms and keeps Realtime responsive.

## Local setup and checks

Only the fixed local stack at 127.0.0.1:59321 is accepted by the integration helpers. Local SQL was iterated directly; no reset or hosted migration was run.

- New schema files: 20261006104521_calendar_import_sync.sql and 20261006104523_calendar_import_cron.sql.
- Run the reviewed local reconciliation operation separately.
- `node scripts/configure-local-calendar-sync.mjs` generates a local secret in ignored output and stores the matching local Vault configuration without printing it.
- `npx supabase@2.118.0 functions serve --env-file supabase/.temp/calendar-sync30/functions.env`
- `node app/tests/calendar-import-sync.mjs` — local API/RLS/identity/lease regression; disposable fixtures cleaned up.
- `node app/tests/calendar-sync-browser.mjs` — realistic local copy, real source fetch, three viewports/Realtime, hidden/restore/status, screenshots. Temporary overrides restored afterwards.
- `npm test` in app; Deno check/test in supabase/functions; Polish browser regression; build, Capacitor sync and native structure checks.

Local review: `supabase/.temp/calendar-sync30/review.html`. Backup, secret, screenshots and reports are Git-ignored. Local Cron/Vault dispatch was verified through pg_net to the actual scheduled Edge endpoint: HTTP 200, four active feeds processed, zero failures.

## Required production configuration LATER

Do not execute as part of this task:

1. Review/apply the two additive migrations and separately review/run archived legacy repair.
2. Deploy changed import-calendar-feed and new sync-calendar-feeds with their shared modules. No other functions need deployment.
3. Generate a dedicated high-entropy CALENDAR_SYNC_SECRET in Edge secrets; store the same value in Vault as calendar_sync_secret. Never put it in frontend env or Git.
4. Set Vault calendar_sync_url to the project's HTTPS /functions/v1/sync-calendar-feeds endpoint.
5. Confirm pg_cron/pg_net and the calendar-feed-sync job (`*/5 * * * *`). The migrated job is inert until both Vault values exist.

Cron/Vault follows [Supabase scheduling documentation](https://supabase.com/docs/guides/functions/schedule-functions). No Google OAuth or source write-back is introduced.
