# Store data inventory · 1.0 RC
Verified implementation: 2026-09-29. This is the questionnaire input, not a submitted declaration. Complete the final forms against the shipped build and actual supplier contracts.

| Actual data | Collected off device? / linked | Purpose | Processor / sharing | Retention |
|---|---|---|---|---|
| Account email, Auth UUID, encrypted password verifier, sessions | Yes / account | Login, recovery, invitations, access control | Supabase Auth; selected SMTP supplier for emails (not configured yet) | Until account deletion; provider backups/security logs follow contracted retention |
| Family memberships, roles and invitation email/hash/status | Yes / account + family | Sharing and permission management | Supabase Database; visible to authorized family members | Until membership/account/family deletion; invitations created by or addressed to a deleted account are removed |
| Person names, aliases, child/adult role, color, optional birth year, avatar path | Yes / family; child profiles need no Auth login | Calendar identity, filtering, birthdays and chores | Supabase Database | Until profile/family deletion. Archive is NOT deletion. Survives deletion of one login while other owners retain family |
| Calendar dates/times, titles, notes, locations as typed, recurrence, external event IDs, source | Yes / family + author reference | Shared scheduling and imported calendars | Supabase Database/Edge; calendar provider supplies user's feed | Until item/family deletion; author reference anonymized on account deletion |
| Tasks, done state, historical weekly reward records | Yes / family/profile | Chores; legacy weekly history retained for export | Supabase Database | Until data/family deletion; no advertising or behavioral scoring |
| Meal titles/dates/times, ingredient lines, shopping names/quantities/categories and bought state | Yes / family + author reference | Shared meal planning and grocery list | Supabase Database, visible to authorized family members | Until item/family deletion; included in family JSON export and offline cache; no purchase/payment tracking |
| Avatar photographs | Yes / family; may depict children | User-selected profile image | Private Supabase Storage; legacy image URLs can contact their original host | Replaced images removed via Storage API; all household images removed on family deletion; shared images retained on member deletion |
| Private ICS/Aula/Google feed URLs | Yes / family/admin | Fetch calendar data chosen by administrator | Supabase Edge fetches the selected calendar provider | Until feed/family deletion. Never in export/cache/logs created by new release code |
| Random installation ID, platform, version, selected family, last seen | Native only / account | Register device and scope future notifications | Supabase Database | Until logout/account/family deletion; offline logout may leave an expired row until later cleanup |
| APNs/FCM token | Only after configured provider and contextual permission / account | Notification delivery foundation; NO reminder engine | Supabase plus Apple APNs or Google FCM when enabled | Removed on online logout/deletion, refreshed on registration; delivery eligibility expires after 24h without renewal |
| IP, request metadata and operational logs | Infrastructure may process / may link to account or request | Security, rate limits, operation | Supabase, future Vercel, email/push providers | Supplier/account configuration; precise production periods must be documented before launch |
| IndexedDB, session storage, localStorage and native export cache | On device, no extra analytics upload | Offline editing, session persistence, local kiosk preferences | OS/browser storage; JSON export shared only at user's action | Family cache removed on logout; preferences remain. User-saved exports and other devices' offline copies cannot be remotely guaranteed erased |

## Apple App Privacy
Expected categories: Contact Info → Email Address; Identifiers → User ID and Device ID; User Content → Photos or Videos (photos only), Other User Content (calendar, tasks, meal plans, grocery lists, typed notes); Other Data where birth year/family relationships do not fit a more specific category. App interactions such as done state serve app functionality, not analytics; map them to the applicable questionnaire category if requested. Operational diagnostics depend on actual processor logging.

Declare account/family-associated data as linked to identity where applicable; do not claim anonymous collection merely because a child profile has no login. Purpose: App Functionality, with Security/Fraud Prevention where the form supports it. Tracking: **No**; no advertising identifiers, cross-app tracking, attribution, or ad SDK is implemented.

The native privacy manifest declares the Filesystem required-reason API (File Timestamp, C617.1) and no tracking. Inspect Xcode's aggregated privacy report for the final SDK bundle; the manifest does not replace App Store Connect's privacy answers.

## Google Play Data safety
Expected types: Personal info → Name, Email address, User IDs, Other personal info (family role/birth year); Photos and videos → Photos; Calendar → Calendar events; App activity → Other user-generated content / app interactions as applicable to tasks; Device or other IDs → installation ID and enabled push token. A typed location in a calendar note is user content, not device GPS collection. No location permission is requested.

Collected: **Yes** for server-persisted fields. Required for core account/family functions; avatars, birth year, feed connection and push permission are optional. Purpose: app functionality/account management/security. Encrypted in transit: HTTPS/WSS; production native cleartext disabled. Deletion: in-app Konto → Slet min konto and public `/delete-account` route after login. Private feed URLs are excluded from JSON export.

Service-provider processing is not automatically Google's “shared” category: evaluate its [service-provider exception](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) against actual contracts. Family sharing is user-directed product functionality. Do not mark “no sharing” merely because suppliers are called processors; validate the form and chosen configurations.

## Release gates
- Public controller identity, support contact, SMTP vendor and concrete backup/log retention are not yet supplied.
- Verify final Firebase/APNs configuration if push is enabled; base build keeps `VITE_NATIVE_PUSH_ENABLED=false` and FCM auto-init off.
- Use actual native devices and inspect permission prompts/network traffic before submission.
- No ads, contacts, microphone, GPS, payments, health data, crash analytics or behavioral analytics are intentionally collected by this app.

Sources: [Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/), [Google Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en), [Capacitor Filesystem privacy](https://capacitorjs.com/docs/apis/filesystem).

Tasks & Rewards 2.0 adds per-profile monthly allowance calculations and payment markers (no payment processing), immutable month summaries, append-only star ledger, reward catalog, goals, redemption requests, completion approval and excuse reasons. These are household-shared user content linked to family profiles, cached offline and included in export/deletion. Only authenticated adults/admins/owners can change sensitive reward configuration and approvals. An archived profile retains its history. No additional SDK or third-party processor was added.

Rewards 2.1 retires active weekly celebrations. A household/profile/month milestone record suppresses repeated 100% feedback across devices; it is household-readable, included in export, and deleted with its family/profile. Animation observations stay in memory and are not sent to analytics.
