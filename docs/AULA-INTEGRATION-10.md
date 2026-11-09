# Aula Integration 1.0

Wall/avatar parity, installed-app updates and hosted acceptance prerequisites are
documented in [AULA-WALL-PARITY.md](AULA-WALL-PARITY.md). The shared responsive product
principle is tracked in [PRODUCT-BACKLOG.md](PRODUCT-BACKLOG.md).

Implementation on `feature/aula-integration-10`, based on main
`bf5a9fc2eb05be0dbca187e6281beedb7598dea1`. Local/visual acceptance is complete.
On 9 November 2026 the owner authorized a controlled production pilot rollout;
see [AULA-PRODUCTION.md](AULA-PRODUCTION.md). Real MitID login remains user-operated.
No scheduled job is enabled.

## Product contract

Authenticated Aula supplies calendar details, ordinary messages and MeeBook work
that an ICS link cannot provide. Connection is optional, under **Familie → Aula**.
The compact **I dag** card opens the same review inbox; there is no new navigation tab.

The user confirmed the activity model on 9 November 2026: all actionable school
findings become **Aktivitet**, including homework, reminders and deadlines.
`HOMEWORK`, `REMINDER`, `DEADLINE`, `TRIP` and `CALENDAR_EVENT` describe the school
information, not a family chore. The original attachment's `CREATE_TASK` and
`CREATE_EVENT` proposals are superseded by `CREATE_ACTIVITY`.
See [AULA-ACTIVITY-CONTRACT.md](AULA-ACTIVITY-CONTRACT.md).

The reviewer chooses one or more existing household people using the normal avatar
picker. Shared findings create one activity with those exact people. No task reward,
star, approval, allowance or payout data is written. General information creates
nothing. Missing dates require clarification and cannot silently create an item.
Acceptance is explicit, transactional and idempotent. Existing activities match only
with the same date/time, normalized title and exact person set; family chores are
never reused. A trip and its packed-lunch reminder remain two distinct activities.

## Architecture and reference

`app/api/aula-*.ts` are Node 24 Vercel functions. The Vite SPA rewrite excludes `/api`
and asset/dev-server paths. Supabase verifies the app bearer token on every manual
operation; only household owner/admin/adult can administer Aula. Child and anonymous
wall sessions cannot connect, map, sync or disconnect.

The MIT reference is `Casperjuel/aula-mcp` pinned at
`5c64e98eaba98288770650f8cafe1636facf01d2`. Only the transitive pure HTTP auth
implementation is vendored, with bounded transport, silent logging and an APP-only
entry point. There is no Python runtime, MCP server, command-line token store,
Playwright login or browser automation in production. Attribution, adaptations and
file hashes are in [aula-third-party.md](aula-third-party.md) and
`app/server/aula/vendor/PROVENANCE.json`.

1. Interactive MitID runs on the user's own device/network. The hosted
   `aula-connect` entry point returns `AULA_LOGIN_BLOCKED` before provider I/O;
   STIL's cloud bot defence is not bypassed or retried. Synthetic injected login
   tests and the separately authenticated SSE transport probe remain available.
2. `aula-handoff-create` and `aula-handoff` implement the device-to-server
   session contract below. Legacy identity/login storage is retained for compatibility.
3. `aula-status`: safe connection, child mapping and finding metadata only.
4. `aula-scan`: manual adult authorization, or constant-time `AULA_SYNC_SECRET`
   authentication for a future scheduler. A database lease and generation fence
   prevent parallel scans and writes after disconnect. Deadline: 240 seconds.
5. `aula-disconnect`: deletes encrypted credentials, flows and leases, disables the
   connection. Retained mappings are inactive while disconnected; accepted calendar
   activities are retained.

The migration exposes narrow service RPCs, not credential-table access. Refresh
tokens alone are encrypted with AES-256-GCM and household-bound associated data.
Access tokens/cookies remain in invocation memory. Refresh always runs before a scan;
rotated credentials are encrypted and saved **before** reads or AI can fail.
`invalid_grant`/invalid envelopes require reauthentication; timeouts and temporary
provider failures retain the connection. Key rotation requires a planned
re-encryption/reconnect; replacing a key blindly makes saved sessions unreadable.

## Device session handoff (production pilot)

Production target: **native iOS/Android device = interactive MitID/Aula login;
backend = encrypted refresh session and scanning**. The Windows helper is pilot
bootstrap, not the final native UX. Neither path bypasses STIL bot protection.

1. An authenticated owner/admin/adult calls `POST /api/aula-handoff-create` with
   `{household_id}` and the existing app Bearer session. The service-only RPC
   `create_aula_handoff` persists a SHA-256 hash of a fresh 256-bit random code.
   The response contains `handoff_secret` once and `expires_at` (10 minutes).
   The UI keeps the code only in memory/DOM until close, expiry or completion;
   copy is explicit. It never receives an Aula refresh token.
2. On Windows, run `app/scripts/connect-aula-production.bat` (Node 24 and the
   existing app dependencies). Paste the code and enter the MitID user ID in the
   hidden terminal prompts. The helper opens an ephemeral loopback QR page. Only
   APP authentication is offered; there is no password prompt. Identity selection,
   when needed, stays in the terminal. No automatic retries or cloud login.
3. The device sends `POST https://familiekalender-alpha.vercel.app/api/aula-handoff`
   with `{handoff_secret, refresh_token, identity_label?}`. This generic JSON
   contract is shared with future native clients. There is no household override,
   redirect following, browser Origin/CORS access, or token in a URL.
4. PostgreSQL atomically consumes the code before provider verification. The
   server must refresh the supplied token and read `profiles.getProfilesByLogin`.
   Only then does it save the **rotated** token using the existing AES-256-GCM
   envelope with household associated data. Response: `{connected:true}` only.
   Invalid tokens never establish a connection or replace existing credentials.
5. Return to the app and choose **Kontrollér forbindelse**, then explicitly
   discover children/map/scan. Findings remain review-only. No automatic calendar
   creation and no new scheduler are introduced.

The local helper writes no token, username, cookies or login response to files,
stdout, logs, CLI arguments or clipboard. It clears references and stops the QR
server in `finally`; JavaScript memory is garbage collected, not a guaranteed
physical zeroisation facility. Cookies/access tokens live only in process memory.
The fixed HTTPS destination rejects redirects. QR HTTP binds only `127.0.0.1`,
uses a random path and no-store/CSP/Host/Origin/Fetch-Metadata restrictions.

Every attempt consumes its code, including failed verification or a lost response.
Generate a new code for retry. Shared DB limits: 4 creates per household/creator
per 15 minutes; 30 redemption attempts per minute for this small pilot. There is
no IP logging. Errors are bounded codes such as `AULA_HANDOFF_INVALID`,
`AULA_RATE_LIMIT`, `AULA_REAUTH_REQUIRED`, `AULA_BUSY`, `AULA_TIMEOUT`; raw provider
errors are never returned or logged. Request bodies are capped at 16 KiB.
Pending and in-flight codes are revoked by a new code or disconnect. Completion
rechecks adult membership, household, claim nonce, 90-second verification lease,
expiry and scan/login locks. Browser/anonymous/wall/child cannot bypass the
service-only database gateway. Only hashes and metadata enter the handoff table.

Validation: `npm run test:aula`, `npm run test:aula:handoff:db`,
`npm run test:aula:handoff:api` (isolated local Supabase and Vercel dev),
`npm run test:aula:browser`, existing DB/activity tests, typecheck, i18n and build.
Concurrent redemption is tested through independent real PostgREST transactions.
Provider refresh/profile verification and scanner profiles/calendar/messages/
MeeBook are tested using synthetic transport responses. A real device handoff and
subsequent live scan require the user's MitID approval after deployment; automated
tests must never claim that user step has already passed.

## Read model and AI (unchanged)

The provider adapter exposes a finite Aula read allowlist. The calendar read uses
POST; this is not a blanket method guard. Presence, send/write, calendar mutations,
mark-as-read and unknown methods have no route. Authentication is separate from
product-operation authorization.

Profiles and groups discover children, school and class. Persisted provider keys
are per-household HMACs; the raw IDs and widget token exist only during the scan.
Users explicitly map children to existing household people. Calendar reads cover
two days back and fourteen ahead. Messages use a fourteen-day full window or the
last successful scan with a one-day overlap, with bounded thread/message pages.
Nullable senders do not fail extraction. Sensitive flags/403 threads are skipped;
no step-up authentication or attachments are requested. Posts/notifications are
read where available (notifications contribute counts); MeeBook reads the current
and following ISO week with one widget-token retry. Optional unavailable sources
and truncation are counted.

Recipient/child/group metadata is applied before AI. Text class fallback distinguishes
3.A/3.B from 3.C, while an entire year group can include all its children.
Unmapped sources are not analyzed. Calendar instants are converted to Copenhagen
wall time, including DST; date-only and floating values remain local.

`supabase/functions/aula-analyze` uses the existing OpenAI Responses API and
`OPENAI_API_KEY`, with strict JSON schema and `store:false`. A dedicated server
secret protects it, independently of Supabase gateway JWT verification. Each batch
contains at most 12 normalized sources, each at most 6,000 characters. Source
timestamps and Europe/Copenhagen anchor relative dates. Invented people/source
keys, malformed results and invalid dates fail validation. The pure contract in
`app/server/aula/analysis.ts` is shared by Node and Deno; the local Edge bundler has
been tested with that cross-directory import. Production deployment must package
from the repository root, keeping both directories present.

Only short summaries/reasons and proposed planning fields are persisted. Raw Aula
messages, auth responses, cookies, QR payloads and access tokens are never stored
or logged. Auth flows expire after five minutes; stale metadata is cleaned on
subsequent operations. New unreviewed findings dated over seven days ago become stale;
accepted/ignored findings are retained for history and dedupe. There is no scheduled
retention job in this batch. Disconnect retains historical findings and accepted
activities. See [AULA-SECURITY.md](AULA-SECURITY.md) for the threat model and limits.

## Existing feeds and native features

All existing Aula ICS URLs, activation flags, imported items and overrides are
preserved. The existing editor/removal flow labels them as older Aula calendar links.
New Aula connections go through the authenticated entry. Nothing automatically
deactivates a feed or deletes imported data.

Capacitor, RevenueCat enforcement, store configuration, wall pairing and existing
task/reward economics are unchanged. This batch verifies the web app and native
structure/contracts, not physical iOS/Android login. A packaged Capacitor app will
need an explicitly configured, origin-restricted hosted API access path before Aula
can be accepted there; the current Node API is same-origin web-first.

## Environment and deployment prerequisites

The server variables below are configured directly in platform secret stores.
No production values or environment files belong in Git.

| Runtime | Variable | Purpose |
| --- | --- | --- |
| Vercel Node | `SUPABASE_URL` | Existing project's URL |
| Vercel Node | `SUPABASE_SERVICE_ROLE_KEY` | Server-only RPC/Auth access |
| Vercel Node | `AULA_SESSION_ENCRYPTION_KEY` | Random 32-byte key, base64 |
| Vercel Node | `AULA_HMAC_KEY` | Separate random 32-byte key, base64 |
| Vercel Node | `AULA_SYNC_SECRET` | High-entropy future scheduler authentication |
| Node and Edge | `AULA_ANALYZE_SECRET` | Shared high-entropy analyzer authentication |
| Supabase Edge | `OPENAI_API_KEY` | Reuse existing OpenAI key |
| Supabase Edge | `AULA_ANALYSIS_MODEL` | Optional; default `gpt-4.1-mini` |

Server keys must never use the `VITE_` prefix. No secrets belong in source control.
Vercel configuration enables Fluid Compute and requests 300 seconds for login/scan.
[Vercel's duration documentation](https://vercel.com/docs/functions/configuring-functions/duration)
lists a 300-second maximum for Fluid Hobby and higher limits for Pro/Enterprise.
The initial connector could not access the project. Production preflight subsequently
verified the existing RGJCONSULT project through the authenticated CLI, with Fluid
Compute enabled. Hosted duration must pass the release probe. No upgrade is required.
Local Vercel dev proves routing and SSE contracts, not hosted duration, proxy buffering
or cloud IP acceptance by MitID/Aula. Branch deployment is disabled in this configuration.

The owner explicitly chose production as the pilot, without staging. Review/apply
only missing migrations, configure secrets, deploy the Edge function and frontend,
then verify API routes and SSE before handing control to the user. The operator-only
SSE transport probe uses the same headers as login, accepts no login data, calls no
provider/database and streams for 275 seconds. It requires `AULA_SYNC_SECRET` as a
Bearer token and `x-aula-probe: sse-v1` with an empty JSON body. Ordinary connection
requests retain the app bearer token and adult household authorization checks.

## Local review and later real login

The isolated test project is `familiekalender-aula-10`, API `127.0.0.1:49321`, DB
`49322`. Other Docker projects are untouched. Its config/migration copies are under
`supabase/.temp/aula-integration-10/local-stack`; local migrations have been applied.
The application runs on **http://127.0.0.1:5198** via actual Vercel dev, without linking
a Vercel project or downloading hosted environment variables. Node CLI 61 is pinned
for this Windows environment; its supported per-process native-installer opt-out
avoids changing Windows symlink/developer-mode settings.

From `app`:

```powershell
npm run dev:aula
npm run test:aula:api
npm run test:aula:browser
```

The local launcher gets only the isolated CLI status and creates synthetic household
fixtures. Local random server keys and the fixture password are DPAPI CurrentUser
protected, with a user-only ACL, in ignored review storage. They are not production
values. Do not print the DPAPI helper's output; only its Node wrapper captures it.
Do not reset/delete the local stack or DPAPI file after a real session has been saved.
The API test refuses to replace an existing connected local Aula session.

`review.html` contains 28 screenshots from the full app, with synthetic Aula/SSE
fixtures. The API/RLS tests use real local Auth and PostgreSQL. The previous Python
PoC, its session and real provider data are not read or reused.

**After visual review only**, run:

```powershell
npm run aula:acceptance
```

This opens a temporary Chrome session authenticated only to the synthetic local
Familiekalender household. It does not start Aula login, scanning or interaction.
The user then chooses Connect, enters the username, scans the QR in MitID, approves
in the app and chooses identity if requested. No password field exists. Check safe
success metadata, discover/map children, close/restart the app and confirm a new
scan refreshes without QR. Finally disconnect and check accepted local activities
remain. Share status/error codes only; never screenshots of QR/OTP or credentials.

Real QR/network compatibility, provider response shapes and cloud IP reputation
remain **unverified until this user-operated acceptance**. No real login has been
attempted in this integration. Initial unmapped discovery does not require AI;
analysis of real mapped sources additionally needs a separately configured local
Edge `AULA_ANALYZE_SECRET` and authorized development OpenAI key. The current Edge
probe uses no AI credentials. Do not copy production secrets to enable this step.

## Validation scope

Unit/contract tests cover crypto, auth POST/PUT, SSE, cancellation/timeout, rotation,
read allowlist, timezone, class filtering, sensitive threads, nullable senders,
MeeBook, AI schema, activities and dedupe. PostgreSQL tests apply actual migrations
and exercise roles, household boundaries, leases, repeated acceptance, exact people,
disconnect races and unchanged legacy/reward data. Local HTTP tests cover every Node
route, real Supabase bearer validation, child/wall denial and separate identity choice.
Browser tests cover mobile 375/390/430, tablet, desktop, focus/scroll and all review
states. Mock AI success proves the boundary/schema, not real-model extraction quality.
