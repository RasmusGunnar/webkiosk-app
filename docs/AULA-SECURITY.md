# Aula 1.0 security review

This integration is opt-in and read-only toward Aula. Local implementation and mock tests are not evidence of a successful hosted MitID login. No production deployment, login, migration or secrets were performed during implementation.

## Boundaries

- A Supabase access token authenticates the **Familiekalender user**, not the Aula session. Every Node endpoint verifies that token with `auth.getUser` and checks the requested household membership. Anonymous/wall users are rejected. Owner, admin and adult roles may manage Aula; children retain normal household read access to findings only.
- Aula OAuth, UniLogin, NemLog-in, MitID and SAML run on the server. Required authentication POST/PUT requests are allowed. Authentication is not subject to a blanket HTTP verb guard.
- Product reads use a finite allowlist in `provider.ts`. Calendar's documented read method uses POST. There is no arbitrary method/URL endpoint, mark-as-read, message sending, presence mutation or calendar mutation toward Aula.
- Authentication redirects use HTTPS, a bounded redirect walker, approved provider domain roots, response-size limits and an overall abort signal. Bot defense is reported; it is not bypassed. Unknown auth domains fail closed and require a reviewed adapter update.
- MeeBook requests go only to its fixed API endpoint with an in-memory, per-scan widget token. Attachments, embedded images, edit links and arbitrary URLs from provider content are never fetched.

## Credential theft and storage

`private.aula_credentials` contains only a versioned AES-256-GCM envelope. A fresh 96-bit IV is generated for each encryption. The 128-bit authentication tag and associated data `familiekalender:aula:v1:<household UUID>` authenticate the ciphertext and household. Only the refresh token is persisted; access tokens and authentication cookies stay in memory. The encryption key is a 32-byte random key, base64 encoded, stored separately as a server environment variable. It is not a VITE variable.

Database theft without the independent key reveals ciphertext, not a reusable session. Database theft plus a stolen server key can decrypt sessions; server environment access is therefore privileged. Compromised users cannot request raw credentials through PostgREST. Private tables revoke authenticated, anonymous and service-role table access; narrowly granted service-only RPCs perform credential operations. RLS is enabled even on private tables. Browser-readable tables have no encrypted-session column.

Envelope version/key errors, wrong-household associated data and tampered tags fail closed. Version 1 does not silently attempt multiple keys. Key rotation requires a controlled server-side re-encryption or reconnect procedure before replacing the active key; do not discard the old key while sessions still need it. HMAC key rotation changes provider identities and requires an explicit dedupe/mapping migration plan.

## Replay, concurrency and IDOR

Login flows expire within five minutes and store only household/user IDs, state and identity choice. They never store username, QR payload, authorization code, SAML, cookies or tokens. Four login starts per user/household per 15 minutes are allowed. A household cannot run two login flows or start login during a live scan. Identity selection verifies household, initiating user, expiry and valid option bounds. A completed flow is deleted and cannot be replayed.

Each scan owns a database lease and credential generation. Refresh rotation is encrypted and saved before calendar/message/AI work. Disconnect deletes credentials, login flows and leases. Late work with an old lease cannot recreate deleted credentials or findings. Leases expire if a function is killed. Transient failures retain the connection; an invalid refresh grant or corrupt envelope requests reauthentication. No password is ever requested by the UI or accepted by the API.

Manual acceptance is a database transaction under the existing household calendar lock. It locks the finding, checks adult membership and household people, detects existing calendar items, and calls the existing `mutate_calendar` RPC. Repeated acceptance returns the existing result. Review requests do not accept arbitrary SQL, arbitrary household IDs without membership, or provider mutation commands. Existing ICS feed rows, overrides and activation flags are untouched.

## Browser, logs and AI

Only safe connection metadata, child mapping metadata and short proposed findings are persisted in public tables. Provider IDs are household-specific HMACs. Returned QR images and one-time login display codes are ephemeral and removed from the DOM when the dialog closes or advances. Aula sessions are never put in localStorage, IndexedDB, sessionStorage, URLs or service-worker caches. Requests and responses use `no-store`; authorization uses headers, never URL parameters.

Auth logging and wire tracing are no-op implementations. The API maps exceptions to fixed safe codes; it does not return error messages, stack traces, provider bodies, query strings, cookies or authorization headers. Do not enable request-body logging or session replay for `/api/aula-*`. Vercel's platform access logs can record route, status and timings; the route URLs contain no Aula credentials. Private provider requests carry Aula's required token query internally and are never logged by application code.

Only non-sensitive, relevant, bounded source excerpts are sent to the existing OpenAI Responses API. Each batch is at most 12 sources and each source body is at most 6,000 characters; output is strictly schema validated. `store:false` is set. This disables response storage in that API request; it is **not** a claim that the provider has zero abuse-monitoring retention. Confirm the organisation's OpenAI data agreement before enabling production. The UI explains the AI processing before connection.

Provider content is untrusted data. Recipient/child/class scoping precedes AI, proposed people must be a subset of supplied household people, and summaries are escaped in the UI. AI has no tools and cannot mutate a calendar or bypass manual review. Sensitive threads are skipped without attempting step-up authentication. Raw bodies, sender identities, attachments and auth HTML are never written to logs, database or fixtures. Unknown/uncertain dates remain review-only.

## Operational limits and outstanding acceptance

The configured login function budget is 300 seconds with a 270-second application deadline; scanning uses a 240-second deadline. Individual provider requests are limited to 25 seconds and 8 MiB decoded content. Thread and message pagination is bounded and truncation is counted. A paused/crashed browser does not create a persistent job; functions clean up on disconnect or are bounded by their deadline and database expiry.

Mock protocol, crypto and PostgreSQL tests cannot prove live provider compatibility, future API shapes, hosted IP reputation or cloud function duration. Real MitID acceptance must be performed by the user after visual review, using the isolated local environment. Never reuse or import the earlier Python PoC's saved session. No scheduled production scan is installed by this change.
