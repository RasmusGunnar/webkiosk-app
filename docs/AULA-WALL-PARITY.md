# Aula activities, wall avatars and installed app updates

## Scope

Same `feature/aula-integration-10` worktree. No old migration was edited; no hosted
database, production environment, deployment, commit, push or real MitID login was
performed. Native shell, RevenueCat enforcement and allowance/payout logic are unchanged.

## Findings and correction

The accepted Aula contract is consistently `CREATE_ACTIVITY` → `Aktivitet`.
Homework/reminders/deadlines remain internal classifications. Acceptance retains
exact selected people and standard calendar provenance, with no task/reward fields.

The anonymous wall snapshot omitted `avatar_url`. New uploads actually use the
private `avatar_path` and signed display URL, so adding only `avatar_url` would not
fix uploaded photos. The snapshot also omitted safe Aula provenance, and its
unordered person aggregation could change stack order/overflow versus web/mobile.

The CLI-created additive migration
`20261109134623_wall_avatar_projection.sql` modifies the installed snapshot function
in place, preserving its existing guards, grants, i18n projection and capabilities.
It adds only `avatar_url` and `avatar_path` to people, and orders them by the same
`sort_order,name` used by the normal client, with ID as a deterministic tie-breaker.
No extra sorting field needs to be exposed. Item data may additionally contain only
boolean `aulaAssisted=true` and a known string `aulaSourceKind`. Finding IDs, provider
keys, credentials, feed URLs and raw provider payloads remain excluded.

Private uploaded photos need a separate SELECT-only Storage policy. Its helper
requires a currently paired, non-revoked, entitled-if-enforced wall and an exact
object path currently referenced by a person in that household. It does not extend
the member helper used for writes. Orphan objects, other households, unpaired
identities and writes/deletes remain denied. The bucket remains private.

`WallDeviceService` uses the existing `resolveAvatarUrls()` with 300-second signed
URLs, cached in memory for 240 seconds. Household/path changes invalidate the cache;
stop/revocation clears it, and generation checks discard late resolutions. Existing
signed URLs can remain usable until their five-minute expiry; revocation prevents
new signing immediately. Photos already delivered to a device cannot be recalled.

All render paths keep using `personAvatar()`/`personStack()` and the existing error
fallback. Upcoming cards now use that stack and a compact source label too. The wall
has no Aula connect, QR, review, mapping or scan UI. It shows accepted activities
through the ordinary calendar snapshot.

## PWA root cause and small update fix

The active Vite app registers `/sw.js`; its versioned offline shell is separate from
the old repository-root `service-worker.js` killer. The legacy killer is not bundled
in `app/dist` and was not changed. The manifest's `/` start URL/scope are consistent
with this app. Vite JS/CSS filenames are content hashed.

The active worker intentionally served a coherent cached HTML/assets set. But the
live page had neither a periodic registration update check nor a controller-change
handoff. A display that never navigated could keep executing old JavaScript even
after newer files were available. Cache headers alone cannot replace a running page.

`installShellUpdates()` now registers with `updateViaCache:none`, checks on a
15-minute interval and after visibility/pageshow/online resumption, and displays a
translated update action after a new controller takes over. A wall reloads only
after two minutes without interaction, while online/visible, with no dialog, active
editor, in-flight sync, pending calendar queue, shopping operation, pending avatar
upload or Aula scan. Web/mobile users choose the update action. Native bundled
assets do not register a browser service worker.

The worker still installs a complete new shell before activation. Precache requests
revalidate assets; the previous cache remains available for old hashed JS/CSS while
an existing page finishes work. API/auth data never enter these caches. A failed
install retains the prior complete offline shell. `/`, `index.html`, the manifest
and the worker have explicit revalidation/no-cache headers; hashed assets retain
their normal deployment caching. No cache killer or forced interactive reload was added.

**First rollout:** code already executing from an older deployment cannot acquire
this watchdog without loading the new shell. Let the updated service worker install,
then reload/reopen once to enter the new app. A reload before activation may still
show the prior shell. Subsequent long-lived wall sessions use the idle update flow.
Actual production/browser installation was not modified or verified by this local work.

References: [MDN registration.update](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)
and [MDN pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event).

## Local evidence

- Real isolated Supabase Auth pairing, PostgREST snapshot, Storage signing and RLS:
  exact field projection, accepted activities, photo access, denied orphan/unpaired
  reads, no writes/admin tables, and immediate revocation of new requests.
- Full app browser: one synthetic family and Wednesday 11 November fixtures on
  mobile, desktop and a real anonymous paired wall; equal IDs, colour, photos,
  initials, failed-photo fallback, stack ordering/overflow and Aula labels.
- Real Chromium workers simulate releases A/B/C plus failed D: periodic discovery,
  editor and unsynced guards, idle wall update, explicit desktop update, old asset
  availability, offline continuity and no API caching.
- PostgreSQL/WASM applies the new migration alongside the full local migration
  chain. The old task test loader used a pre-merge timestamp; it now discovers the
  actual task migration and normalizes CRLF before testing backfill and later migrations.

Review: `supabase/.temp/aula-integration-10/review.html`, extended with nine matching
wall/mobile/web images. Photos are synthetic fixture illustrations, not real people.
The responsive architecture principle is in [PRODUCT-BACKLOG.md](PRODUCT-BACKLOG.md).

## Hosted MitID acceptance — prepared, not started

The existing local launcher remains available after visual review. A **hosted**
acceptance is currently blocked: there is no verified preview with the Node/Edge
functions, migrated isolated hosted test schema, server secrets and 300-second
function/SSE capability. No deployment, hosted migration or production-secret work
was authorized for this batch, so those prerequisites were not provisioned.

After separate authorization, use an isolated preview/test Supabase project, apply
the reviewed migrations, set server-only test keys, verify unauthorized/child/wall
denial and streaming/duration there, then let the user perform QR login after visual
review. Test identity choice, encrypted save, refresh after a fresh invocation and
disconnect. Do not reuse production Aula data or the Python PoC session. Do not
claim hosted readiness from the local mock tests.
