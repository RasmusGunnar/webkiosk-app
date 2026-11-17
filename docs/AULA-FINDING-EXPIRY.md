# Current Aula inbox

Only `new` findings expire. A finding with a start date is current through
`coalesce(end_date,date)`, using the local date in `Europe/Copenhagen`. A missing
start date never expires under this rule, even when an end date exists.

The status gateway excludes expired NEW rows independently of scan timing. The
frontend's shared `aula-expiry.js` predicate protects Family counts, actionable
Today counts/previews and every confidence group in review. Its existing visible
page refresh tick checks the local day before attempting a network request, so an
open/offline review expires within one minute after midnight. Returning to the
page also checks immediately. Review drafts and recent accepted history remain.
An old client cannot accept an expired NEW finding through the review RPC.

`private.aula_expire_findings` changes only expired NEW rows and records their
IDs in `private.aula_expired_findings`. Existing STALE rows are not backfilled:
duplicate cleanup and historical stale states have different semantics. Neither
the marker table nor cleanup is available to anonymous/authenticated clients.

The credential-generation-fenced scan transaction runs expiry before storing
findings (preventing an unchanged source from refreshing yesterday into tomorrow)
and after storing findings (expiring newly ingested past items). The authoritative
`private.aula_store_findings` preserves actual accepted/ignored decision priority.
For marked expiry only, the same origin/action with an unchanged source OR material
revision is suppressed, including AI-only changes to date/title/key. A real change
to both revisions may produce a new UPDATED finding linked to the expired row.
Legacy rows can receive identity metadata after expiry without losing the marker.

No calendar items, accepted/ignored findings, mappings, credentials, checkpoints,
rewards, scheduler configuration, styling or design are migrated. The existing
06:00 / 15:30 Copenhagen schedule is unchanged; there is no midnight scan.
The migration does not run a bulk cleanup. A separate one-time production cleanup
uses the same helper and compares protected-data checksums in one transaction.

Validation: unit tests cover CET, CEST, both DST transitions, end dates, dateless
findings, all counts and offline/pending-request midnight refresh. PostgreSQL tests
cover status defense, cleanup isolation/idempotency, review RPC rejection,
unchanged-source suppression, legacy binding, future material updates and RLS.
The real-app browser fixture crosses midnight with status failures, preserves an
edited future draft, checks desktop/mobile counts and asserts zero calendar writes.
