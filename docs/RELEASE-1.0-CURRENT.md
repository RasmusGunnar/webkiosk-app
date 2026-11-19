# Familiekalender 1.0 — authoritative release record

Updated 2026-11-19. **READY_EXCEPT_EXTERNAL_ACTIONS. Public launch is NOT approved.** This supersedes historical release/native documents. The code and tests are prepared; provider registration, email/legal decisions, store accounts/signing and real-device acceptance remain explicit gates.

## Source and production

- Application release commit: `134976b6e196993c100fb36ccd01ef2a2e350142`, on `main`, fast-forward from fetched `1ec761a4c8f8c9b6bf4f086e29909c7165f7d3d7`. The subsequent commit containing this final record changes documentation/store artwork only; the final operator report identifies that main/deployment SHA.
- Production: https://familiekalender-alpha.vercel.app. Vercel project `prj_DSYiWQOb2d6wJXYa9VGGeTswyVSI`, team `team_McpwEDxDp1EkPpQzcBAQsD3w`. Deployment verification is recorded below.
- Supabase `oyyqniwppytipdktzwsy`, Familiekalender, EU West. 34 migrations applied. No reset, backfill of family content, changed mappings or new MitID login.
- Worktree: `C:\Dev\Familiekalender\supabase\.temp\aula-integration-10-worktree`. The separate root checkout's recipe/Cloudflare experiments were untouched.

## Delivered changes

1. Provider-gated, terminal-free Aula browser flow: PKCE S256, hashed state, encrypted transaction/session, one-use claim, expiry/rate limits, and separate completion proof tied to the initiating adult's authenticated app session. Callback alone cannot replace an Aula connection. Native uses Capacitor Browser and the public HTTPS API origin, with exact-origin CORS and unchanged JWT/household authorization.
2. Legacy Aula envelopes continue using their existing OAuth client. Registered-client binding is retained across every refresh, including failure after rotation. Existing scan, sensitive-thread exclusion, AI quality/review and scheduler behavior are preserved.
3. Fixed proven account-deletion FK failures: connector removal clears its credentials and leases while preserving other owners' family/mappings/activities; last-owner family cascades no longer fail on Aula person references. Newly connected sessions are attributed to the actual adult. Installing these changes rewrote no family data.
4. Export format 2 adds current multi-day fields and explicitly allowlisted adult-only Aula data. No provider child IDs, private feed URLs, source bodies or session credentials are exported.
5. Privacy/terms in da-DK/en-GB cover current Aula/AI, store renewal/trial/restore and account-deletion versus store cancellation. Legal identity/contact/retention are deliberately not invented.
6. Production Auth Site URL corrected from localhost to the real HTTPS origin; production confirmation/recovery/invite callbacks added while preserving native/local callbacks. Production `VITE_PUBLIC_APP_URL` set; native push explicitly OFF.
7. Browser plugin synchronized for Android/iOS. Compatible dependency security updates remove four advisories (one high); final npm audit reports zero known vulnerabilities.
8. Test runners isolate data; fresh SQL runs in a disposable database and do not reset developer databases. Current selectors/contracts replace obsolete shared-task and fixed-six-item assumptions. SQL checkout line endings are normalized via `.gitattributes`.

## Product acceptance

| Area | Result / evidence |
|---|---|
| Calendar, timezone, recurring scopes, birthday/anniversary | PASS — import/sync API 34; multi-day browser 16; multi-person multi-day 11 checks / 46 interval assertions; live-core browser 12 |
| Tasks and people | PASS — 40 DB checks plus responsive, independent person status, adult approval/excuse, durable offline queue/replay and wall restrictions |
| Rewards/goals/redemptions | PASS — 37 DB checks; current stars and goals browser journeys; no economic changes |
| Allowance | PASS — 33 API checks; daily/weekday/selected duties, complete/excuse, frozen periods and payout invariants |
| Meals/recipes/shopping | PASS — recipes, recipe scan, meal API suites; three-day meals 13; specific-day removal 11, including library/other-days preservation, cancel, realtime and offline reload/replay |
| Wall | PASS — real local anonymous pairing, snapshot isolation, selected-person completion, rename/revoke, 8 responsive sizes; shared component styles match desktop |
| Unified responsive UI | PASS — 53 states; 40/40 normal desktop/mobile screenshots byte-identical to latest-main baseline with deterministic fixtures; calendar data unchanged |
| Adaptive capacity | PASS — 20 desktop item/height combinations, mixed groups, expanded day, mobile and 3 wall heights; no fixed six/four/two-item limits restored |
| Offline/PWA | PASS — durable current person-task queue, meal remove/reload/replay, multi-day realtime replay; real service-worker offline shell, safe update with open editor/unsynced work, failed-install fallback and no API caching |
| Build/typecheck/i18n | PASS — release build, server TypeScript, 1439 translation keys, 396 unit tests |
| Edge contracts/security | PASS — 74 tests including recipe SSRF/image safety and RevenueCat webhook/provider contracts; no new Edge deployment needed |
| SQL migration/family isolation | PASS — fresh PostgreSQL 118 checks (49 foundation, 20 calendar, 14 product, 35 release); Aula 73; browser/handoff 23; account deletion/export 8 |

Historical `task-offline-browser.mjs` assumes the retired shared `done` flag. Its current replacement is the person-task offline browser suite plus real PWA/meal/multi-day replay tests; no product behavior was reverted to satisfy that obsolete fixture.

## Fresh-family acceptance

PASS locally with real Supabase Auth/PostgREST/Edge and actual Mailpit confirmation/recovery links: new signup, verified login, new household, first person/activity/task, email-bound invitation across recipient signup, anonymous wall pairing, JSON export, password recovery/change, confirmed last-owner deletion and subsequent login denial. Nine fresh-family checks, 11 additional release-flow browser checks and five native PKCE/recovery checks passed. Fixtures are fictional; this is not evidence of external SMTP delivery or physical native behavior.

First-time Aula: **NEEDS_USER_ACTION** (provider registration, then real device acceptance). Subscription: **NEEDS_USER_ACTION** (real stores). No real Aula login or automatic acceptance was performed. Existing production accounts were not used as deletion fixtures.

## Aula gate

- Existing production connection: connected; three mapped children; last successful automatic scan observed `2026-11-19T05:00:30.482379Z`; error code null. Scheduler `aula-auto-scan` remains active. No new live scan was forced during this release.
- Existing session and mapping/content fingerprints were identical before/after migrations. The connection was not disconnected and encrypted session not replaced.
- End-user terminal requirement: **NO** in the prepared new flow. New connections remain unavailable while the provider gate is OFF; a BAT/operator handoff is not presented as public onboarding.
- Real blocker: Aula's existing private mobile client has an Aula-owned callback. It cannot safely be reused with Familiekalender's callback. Ordinary MitID login must use an approved external browser flow. Availability of a provider-approved client is not proven by local tests and is not a setting the developer can invent.
- Required approved registration: `AULA_OAUTH_CLIENT_ID`, exact `AULA_OAUTH_REDIRECT_URI=https://familiekalender-alpha.vercel.app/api/aula-browser`, then `AULA_BROWSER_LOGIN_ENABLED=true` only after review. No private mobile client substitution, CAPTCHA bypass or embedded MitID password form.
- Local browser proof: 28 synthetic screenshots plus HTTP/DB one-use/auth/expiry/client-rotation checks. These do not claim real MitID acceptance. AUTO ACCEPT: **0**.

## Native

| Gate | Android | iOS |
|---|---|---|
| Identity/version | `dk.rasmusgunnar.familiekalender`, 1.0.0 (1) | Same |
| Structure / sync | PASS | PASS |
| Release web assets / secret checks | PASS | PASS |
| Native compile | BLOCKED: Android SDK missing | NEEDS_USER_ACTION: Mac/Xcode unavailable |
| Physical device | NEEDS_USER_ACTION | NEEDS_USER_ACTION |
| Signed store artifact | BLOCKED pending SDK, signing identity/keystore | NEEDS_USER_ACTION pending Xcode/team/provisioning |

14 structural checks cover bundled assets, HTTPS/no cleartext, schemes, privacy manifest, permissions, icons/splash, wake/link callbacks, RevenueCat and Browser bindings. SDK minimums: Android 24, target/compile 36, iOS 15.

JDK 21.0.13+9 was downloaded from official Adoptium, SHA-256 verified and tested in an ignored task-local tooling directory. Actual Gradle 8.14.3 debug build reached project configuration, then failed with **SDK location not found**. No SDK licence was accepted and no APK/AAB is claimed. No signing keys, paid accounts or store submissions were created.

After the owner installs/licenses Android SDK Platform 36/build tools/platform tools: set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to that SDK, then run `npm --prefix app run android:debug`. Signed release additionally requires `FK_KEYSTORE_PATH`, `FK_KEYSTORE_PASSWORD`, `FK_KEY_ALIAS`, `FK_KEY_PASSWORD` in a secure build environment; never Git. Back up the upload key securely and use Play App Signing. On Mac run `npm ci`, release build with public env, `npx cap sync ios`, open the existing Xcode project, select the owner's team and validate/archive.

## Subscription

- Database/claim/household isolation: PASS. RevenueCat local mock/contract: PASS (51 API checks, nine full browser journeys, Edge contract tests).
- Entitlement `family_access`, offering `default`; prices/trial eligibility come from the store. Requested **29 DKK/month, 249 DKK/year, 14-day store trial are NOT configured** in real stores.
- RevenueCat public SDK keys/store links, server API key and webhook secret: absent. `subscription-verify` / `revenuecat-webhook`: **NOT DEPLOYED**. Existing production Edge functions unchanged: import-calendar-feed v18, sync-calendar-feeds v5, recipe-preview v5, delete-account v6, aula-analyze v8.
- Real iOS/Android purchase, restore, renewal, grace and webhook: NEEDS_USER_ACTION. Mock success does not satisfy these gates. No locally fabricated trial access.
- **ENFORCEMENT OFF**, verified in production. Must remain OFF until both real stores and existing-family behavior are accepted.

## Auth, public pages and legal

- Canonical technical origin: https://familiekalender-alpha.vercel.app. No alternate verified project domain found; none purchased. Branded domain is recommended before marketing, not required for technical staging.
- Production Auth Site URL/redirects: PASS; password confirmation enabled, minimum eight characters. Native callback remains `familiekalender://auth/callback`.
- External SMTP: **NEEDS_USER_ACTION**. No Familiekalender sender/domain/credentials available. An unrelated connected Resend domain was intentionally not reused. Default Supabase mail is not accepted as public signup infrastructure.
- Public routes `/privacy`, `/terms`, `/support`, `/delete-account` exist; technical deletion and login-gated confirmation PASS. Content covers the current implementation; privacy/terms/support still **NEEDS_USER_DECISION** for controller, working support contact, legal basis and contracted retention.
- Auth templates in `docs/auth-email-templates.html` remain prepared da/en copy; sender/SMTP delivery must be configured and tested before public launch. Household invitations currently offer recipient-bound links; no unsolicited email was sent.

Actual retention: family content until requested deletion; archive is not deletion; no inactive-family expiry. Aula refresh session until disconnect/account-family cleanup; pending browser transaction logically expires within 10 minutes and is lazily physically deleted. Review/decision memory persists with the family to suppress duplicates. Native export cache is cleaned at logout/deletion and next start/export after 24h. Device registration delivery eligibility expires after 24h; offline copies disappear on reconnect/logout, not through a guaranteed remote wipe. Subscription event metadata remains with existing backend/account lifecycle; store/provider statutory and backup/log periods require owner agreement. No invented provider periods.

## Security and performance

[Detailed definer/grant review](RELEASE-1.0-SECURITY.md): 70 production SECURITY DEFINER functions, none executable by anon. Explicit household/adult/claim/lease gates and empty search paths preserved. Security Advisor: four reviewed intentional authenticated-RPC WARNs; 21 intentional default-deny/no-policy INFOs. No permissive policy added to silence an advisor. Cross-household/wall/child mutation tests PASS. npm audit: zero known vulnerabilities. This is not an independent penetration test.

Staged files and all three web/native asset trees scanned: no server JWT, secret API key, private key or local review backend/mock payload. Production origin and public Supabase config confirmed. No credentials committed.

Controlled delayed-network measurements (synthetic fixtures, not production-user telemetry): task feedback **11.4–38.3 ms**, route **4–61.1 ms**, warm navigation **0 additional avatar image requests / 0 signing requests**, CLS **0** at 375/390/430/1440/1920. Cold avatar scenario intentionally injects 800/600/1200 ms delays; measured cold appearance 3.10–3.34 s is not a production SLA. Adaptive capacity CLS remains below 0.01 with stable layout and unchanged calendar rows.

## Production changes and preservation

Applied:
- `20261119091156_aula_browser_onboarding.sql`
- `20261119091948_release_account_cleanup.sql`
- `20261119095101_release_export_coverage.sql`

Only Auth public origin/redirects and Vercel public app URL/push-off config changed. No custom domain, unrelated project, SMTP sender, RevenueCat enforcement or real store configuration was changed. No Edge Functions redeployed because no Edge code changed.

Before/after: calendar **637**, people **5**, recipes **12**, mapped children **3**, encrypted session rows **1**; each whole-row fingerprint identical. The two replaced Aula SQL functions differ only in attribution of a newly established connection to its actual adult. No calendar/Aula/recipes/rewards backfill or data conversion.

Application deployment `dpl_5x3HabMgQqe2djNSGyfF6uTMrC69` is READY at application SHA `134976b6e196993c100fb36ccd01ef2a2e350142` and owns the production alias. Fourteen production HTTP/browser checks passed: public pages, deletion login gate, no-cache SW, exact native CORS, unauthorized status/scan rejection and disabled provider onboarding. No authenticated family data or provider calls used. The final documentation/store-artwork push is checked separately against its own exact SHA.

## Evidence and cleanup

Ignored detailed logs: `supabase/.temp/release-1.0/`. Current visual galleries: `supabase/.temp/unified-responsive-ui/review.html`, `supabase/.temp/live-core-bugfix/review.html`, `supabase/.temp/aula-integration-10/review.html`. Native browser screenshots are labelled mock/local; they are not store screenshots or proof of a native runtime.

The disposable release stack is `familiekalender-release-10`, API 45321; synthetic fixtures and its volumes have been removed with targeted `stop --no-backup`. All 39 other running containers were verified preserved. Other Docker stacks and root worktree were not deleted. An early historical SQL runner touched local development definitions; those definitions were restored against their own applied migration history and every existing public-table data fingerprint stayed identical. The runner is now disposable and cannot reset the developer database.

Store metadata da/en is prepared and character limits validated. Public URLs, icons and verified 1024x500 da/en feature graphics in `docs/store-assets/` exist; native iPhone/iPad/Android screenshots, restricted review-account credentials and submitted privacy/data-safety declarations remain store preparation gates. No real family credentials may be used for review.

## One consolidated external action list

| Group | Exact remaining action / where / owner input | Blocks |
|---|---|---|
| APPLE | Owner logs into Apple Developer/App Store Connect, accepts agreements/tax/bank terms, registers bundle ID and subscription group/products; supplies signing team/provisioning, sandbox testers and store connection to RevenueCat. On Mac build/archive, capture iPhone/iPad screenshots and aggregate privacy report; provide isolated fictional review account in restricted portal fields. | iOS submission and paid release |
| GOOGLE | Owner installs/licenses Android SDK, provides secure signing/upload key, Play Console app/service access, billing products/base plans/offers, license testers and internal track. Complete required account-specific testing, Data safety and native screenshots; review account only in restricted fields. | Android build/submission and paid release |
| REVENUECAT | Configure both store connections, entitlement `family_access`, offering `default`, monthly/yearly packages and store-native 14-day eligible offers. Supply SDK public keys separately from `REVENUECAT_SECRET_API_KEY` and dedicated `REVENUECAT_WEBHOOK_SECRET`. Deploy the two prepared Edge endpoints only when those exist. Prove purchase/restore/renewal/cancel/grace/duplicate webhook in both sandboxes, then approve any enforcement separately. | Subscription sales/enforcement |
| EMAIL / DOMAIN | Choose authorized sender domain and support mailbox; connect SMTP in Supabase Auth, from-name Familiekalender, SPF/DKIM/DMARC and click tracking OFF. Provide credentials through provider/secret store, not chat. Test confirmation/recovery/email change to external mailboxes. Branded web domain is optional technical follow-up; purchases require approval. | External beta/public signup; branded domain itself recommended |
| LEGAL / CONTACT | Supply controller/legal rights holder, contact, legal basis and actual supplier/backup/log/Aula/subscription retention agreements. Finalize public privacy/terms/support and store declarations against enabled processors. | External beta/public launch |
| PHYSICAL DEVICE / AULA PROVIDER | Obtain explicit Aula/provider-approved OAuth client and callback registration; availability is not proven and may require provider agreement. Then configure the three named server variables and test real MitID app-switch, cancellation, restart/refresh/mapping on Android/iOS and browser. On both native devices verify auth/deep links/invites, export/share/delete, camera, offline/reconnect, wall/wake, purchase/restore and accessibility. Supply devices/provider approval; no repeat pilot login requested now. | Public Aula onboarding and native acceptance |

Sources: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [MitID app switch](https://www.mitid.dk/en-gb/help/help-universe/mitid-app/app-switch-error/), [RevenueCat products](https://www.revenuecat.com/docs/projects/configuring-products), [sandbox](https://www.revenuecat.com/docs/test-and-launch/sandbox), [restore](https://www.revenuecat.com/docs/getting-started/restoring-purchases), [Android SDK](https://developer.android.com/tools/sdkmanager), [Apple review](https://developer.apple.com/app-store/review/guidelines/), [Google deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

## Go-live recommendation

- External beta families now: **NO** — external SMTP and public legal/contact gates are unresolved; new Aula users additionally need provider onboarding.
- Public web launch now: **NO**.
- Google Play submission now: **NO** — SDK/build/signing, Console and physical/store acceptance missing.
- App Store submission now: **NO** — Xcode/signing, Connect and physical/store acceptance missing.
- Subscription enforcement now: **NO** — neither real store sandbox is accepted.

Existing production pilot remains usable. No further feature batch is needed to discover the listed external prerequisites; complete those concrete gates before claiming public 1.0 readiness.
