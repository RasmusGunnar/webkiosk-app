# Automatic Aula scans

Backend responsibility: the web/native app does not need to be open. No push notifications or automatic activity acceptance.

## Schedule and delivery

The existing Supabase pg_cron/pg_net installation dispatches every minute. SQL converts the instant with `Europe/Copenhagen`, including DST, and selects the 06:00 or 15:30 local slot. A one-hour catch-up window allows temporary delays. Household + local date + morning/afternoon is the durable primary key. Only connected households are selected, then rechecked at claim time.

Each tick sends at most ten independent asynchronous POSTs to the existing `/api/aula-scan`. It uses `x-aula-sync-secret`, the existing `AULA_SYNC_SECRET`, and `full:false`. All existing token rotation, providers, routine filtering, structured MeeBook, AI, decision memory and finding transactions are reused. No Vercel plan change or separate scanner is involved.

The scheduler claim and the existing manual claim share the household advisory lock and scan lease. Busy automatic slots are skipped. A started slot is never replayed. Only a delivery that has not claimed its slot can retry, after five minutes, at most three times. A failed household does not stop others. Missing credentials or invalid sessions require reauthentication and are excluded from later slots. Transient/optional failures retain the existing partial-success rules.

## Incremental processing boundary

Successful analysis stores only household-scoped HMACs of source identity and content/context. Unchanged sources require no AI call, including previously ignored/accepted sources. Content/date/mapping changes and unseen older sources are analyzed. Failed analysis batches are not checkpointed. Checkpoints and findings commit in the same transaction. First use warms this cache; normal/manual scans use it thereafter. Explicit discovery retains the existing full option.

Provider discovery still reconciles the existing bounded 45-day message/post window, two MeeBook weeks and calendar baseline. Aula does not provide a proven edit-complete cursor in the current integration. Therefore `last_success_at` enables incremental analysis, but is deliberately **not** a blind provider timestamp cutoff: earlier messages may contain future actions or edits. This is incremental processing, not an incremental HTTP delta feed. Routine lessons still never reach AI. Raw source content is never cached. A future provider-delta optimization must first prove that edits, partial reads and old future actions cannot be lost.

## Safe setup and activation

The migration creates the cron job inactive and its configuration disabled. It changes no existing session, mappings, findings, activities, feed, rewards or subscription enforcement.

After the matching Vercel code is READY, a database administrator calls `private.bootstrap_aula_scheduler()`. It issues a random, one-use 10-minute capability (only its hash is stored) to `/api/aula-scheduler-setup`. The endpoint copies its existing server secret into Supabase Vault through the service-only RPC. The capability and secret are never returned to the operator, browser, URL or logs. Invalid, expired or reused capabilities cannot configure the scheduler. Existing calendar-sync secrets/jobs are untouched.

Verify `configured_at`, then explicitly set `private.aula_schedule_config.enabled=true` and activate the `aula-auto-scan` cron job. The setup endpoint does not activate anything. Rollback is disabling that job/config; never disconnect Aula or delete credentials/history. Keep the additive migration if rolling back the UI.

Operational checks: configuration heartbeat, cron run status, scheduled state/counts/duration and existing safe scanner stage logs. Do not print request headers, Vault values, encrypted sessions or raw provider data. `net._http_response` may be inspected for status only. SQL rows retain private household keys; emitted scanner logs use existing hashed identifiers.

## UI and scale

Family → Aula shows active status and last success. Manual action is “Scan nu”. Foreground adults refresh status every minute and on returning to the tab, without triggering a scan, redrawing unchanged data or replacing open review edits. Children/wall contexts do not poll Aula administration. Today retains the compact actionable-only card and hidden zero state.

The current fanout ceiling is ten deliveries per minute, at most 600 new households per slot window before retries. Before growth approaches that bound, add a durable queue/backpressure and retention for old slot records; do not increase a single sequential HTTP request or scanner timeout. Production scan budget remains 240 seconds (platform limit 300), with existing bounded collection and at most three parallel AI batches.

## Tests

`node tests/aula-scheduler-db.mjs` uses only `supabase_db_familiekalender-aula-10`, real PostgreSQL/pg_cron/Vault, a transaction-local HTTP test double and rollback. Install pg_cron/pg_net on that local stack first. The WASM suites omit this extension-dependent migration; scheduler SQL is tested separately. Unit tests cover shared pipeline/security/checkpoints/partial retries; existing decision-memory database cases cover ignored/accepted paraphrases and material updates. Aula Today browser tests include automatic refresh, settings and the hidden zero state.
