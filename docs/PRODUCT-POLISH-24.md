# Product Polish 2.4 — local review

No production migration, function deployment, Vercel deployment, commit or push belongs to this change. The gallery uses isolated local fixtures under supabase/.temp/polish24/review.html.

## Imported calendar identity and cleanup

The previous external key included title/location hash, actual start and end. Editing a source event changed its key, so preserveExisting imports could leave duplicates; cleanup imports could replace the row and its UUID.

The new key is a collision-safe JSON tuple of source, feed UUID, exact external UID and original RECURRENCE-ID (full ISO instant), or the literal single for a non-recurring event. Series identity also includes the feed. Actual rescheduling, text, duration and person assignments are not identity fields. Events with different UIDs or feeds are intentionally distinct even when their titles/times match.

The additive migration installs overrides/tombstones, a private duplicate archive, and a checked RPC. Installing it runs no data cleanup. A subsequent import reconciles only rows in its feed whose explicit UID and recurrenceId field prove the same external occurrence. Canonical selection preserves one detached edit if present; otherwise oldest created_at, then UUID. Additional exact matches are archived in full before deletion, in the same transaction. More than one detached local edit aborts the batch for manual reconciliation. Rows without explicit external identity and manually created rows are never reconciled. Cleanup also leaves unknown legacy identities untouched. No title/date-based cleanup exists.

Before any future production rollout: back up affected rows, inspect identity groups using the query below, and review ambiguous legacy rows separately. Roll out the migration before the updated import Edge Function. Use preserveExisting for the first controlled import and compare counts/archival entries. This is a future procedure, not an instruction to run it now.

Read-only candidate report (never expose feed_url):

~~~sql
select household_id, source,
 coalesce(calendar_id,data->>'calendarId',data->>'feedId') as feed,
 data->>'uid' as uid,
 coalesce(nullif(data->>'recurrenceId',''),'single') as occurrence,
 count(*) as count, array_agg(id order by created_at,id) as ids
from public.calendar_items
where source in ('google','aula','ics')
 and nullif(data->>'uid','') is not null and data ? 'recurrenceId'
 and coalesce(calendar_id,data->>'calendarId',data->>'feedId') is not null
group by 1,2,3,4,5 having count(*)>1;
~~~

Recovery: calendar_import_archives.original_row retains the entire removed row with its canonical_id. A future reviewed recovery can inspect that snapshot and restore the necessary information. The archive is service-only with RLS; no browser can modify rules or archives directly. An import/edit serializes on the same feed lock; editor updated_at conflicts reject stale writes. Household access is checked before RPC edits, imports remain owner/admin + service-only.

Local patches include only changed title/location/note/type/person IDs. Effective rows retain the latest importSource snapshot and importLocalOverrides. Source date/time continues to update. Hide rules persist independently of calendar rows, including when a source disappears and later returns. Series rules use feed + UID; occurrence rules add original recurrence identity. The UI filters explicit tombstones only, never apparent duplicates. These new edits require a connection; normal calendar offline flows are retained. Unidentified legacy imports remain read-only rather than receiving invented external identity.

## Recipe import

The single authenticated recipe-preview Edge Function parses JSON-LD Recipe (including graphs and HowTo sections), then OG/title metadata. It does not execute page scripts, invent missing ingredients, bypass paywalls, or send source writes. Metadata-only and failed imports remain manually editable.

Only HTTP/HTTPS on standard ports is accepted, with no URL credentials. All DNS answers must be public unicast addresses. Each redirect is revalidated; the connection is pinned to the checked IP and TLS is verified against the original hostname via Deno.startTls. This avoids both DNS rebinding and the local Edge runtime's unsupported Node lookup/SNI options. Timeout is 10 seconds for the page, 3 redirects, 2 MiB body and 32 KiB headers. Unexpected compression, partial/chunk errors and inaccessible pages fail safely. Optional image DNS validation is bounded separately. Raw errors/URLs are not returned or logged. Client calls time out after 15 seconds.

Recipe data lives in the existing calendar_items.data.recipe JSON: source URL/site/image, ingredient array and instruction array. No meal schema change is required. Existing note-based ingredient lists remain compatible. Imported ingredient arrays reuse the existing shopping normalizer and duplicate prevention. Saved recipes have a readable ingredients/instructions/source view; kiosk is read-only.

## Local verification

Run from the repository root with the local Supabase stack (API 127.0.0.1:59321):

~~~powershell
npm --prefix app test
node app/tests/polish-imports.mjs
# In supabase/functions: npx --yes deno@2.9.6 task check; npx --yes deno@2.9.6 task test
# Keep these local processes running for browser tests:
npx --yes supabase@2.118.0 functions serve recipe-preview
npm --prefix app run dev:local
node app/tests/polish-browser.mjs
npm --prefix app run build
npm --prefix app run cap:sync
node scripts/check-release-secrets.mjs
~~~

polish-imports.mjs applies the new migration only to the fixed local Docker container, creates disposable households and removes its fixtures. Browser tests also reject non-local app/backend traffic. They make one authenticated local Edge request for the public example.com metadata fallback; recipe editor success/failure uses deterministic public sample fixtures. No live family data is used. Screenshots cover desktop, mobile 375/390/430 and kiosk 1024/1280/1920.
