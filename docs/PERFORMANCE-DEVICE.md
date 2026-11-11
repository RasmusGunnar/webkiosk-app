# Device performance and screen awake

The authenticated local snapshot renders before remote refresh. Calendar and people
reads unlock the cold shell independently of the slower rewards read. Server RPCs
remain authoritative for permission checks, stars, approval and allowance economics.

Private avatars use the existing IndexedDB `records` store, scoped by authenticated
user and household. Identity is person ID plus the immutable Storage object path.
Only decoded, resized image blobs are persisted; signed URLs and credentials are not.
A session memory cache retains decoded images and registered object URLs. Ordinary
renders and navigation reuse these URLs and keyed DOM nodes. New paths replace the
old picture only after decoding; deletion, household change, logout and wall revocation
clear the relevant entries and revoke object URLs. Browser storage remains subject to
the device's site-data controls. The Storage bucket and original objects stay private.

Future uploads are resized to a maximum side of 256 pixels, WebP quality 0.82.
Existing originals are never rewritten; their local cached thumbnail is optimized.

Complete/undo commit to the existing IndexedDB offline queue before returning to UI.
Replay runs in the background with the same idempotency IDs, lock and conflict model.
Paired walls reuse that engine with a restricted `complete_task_as_device` transport
and `wall_snapshot` reconciliation; they never call adult task APIs. Permanent errors
remove the optimistic overlay and remain visible in the existing sync/retry panel.
Pending operations continue to prevent service-worker reloads.

`fk:*` Performance measures contain durations and numeric counts only. There is no
analytics upload, household/person identifier, URL, payload or credential in a measure.
Startup measures start at application module evaluation; browser tests additionally
record navigation-relative first visible times. Synthetic latency results are not
production network benchmarks.

## Keep screen awake capability

The setting is `device.wake` in the existing per-origin local device preferences,
independent of household or account. An unset value means ON on wall/kiosk and OFF
on a personal device. An explicit choice takes precedence and survives reload and
household changes. The previous per-household `wake` field is no longer consulted.

Web/PWA uses Screen Wake Lock. Hidden pages release their lock; visible pages
reacquire it. System release schedules a bounded 1–30 second backoff. A policy denial
waits for a new visibility transition or pointer/touch/key gesture. Repeated requests
are deduplicated. Unsupported or rejected requests never block startup or show a popup.

Future native work: retain the same device-local setting and UX while using the
native/Capacitor screen-awake capability. This batch adds no native implementation.
Automated tests prove the API/lifecycle contract only. A physical wall/PWA sleep test
must be performed by the user after deployment.

Performance evidence and synthetic screenshots: `supabase/.temp/performance-ux/`.
These ignored artifacts must not be committed with application code.
