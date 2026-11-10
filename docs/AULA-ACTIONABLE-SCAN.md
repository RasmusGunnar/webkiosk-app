# Aula parent assistant: actionable scan

The scan reads information for family planning, not a copy of the school timetable. It never accepts suggestions. Acceptance still creates `Aktivitet`, retaining the person's avatar/colour and discreet Aula provenance. Chore, reward, allowance, subscription and legacy ICS code is unchanged.

## Verified source map (9 November 2026)

Compared the pinned MIT reference (`5c64e98eaba98288770650f8cafe1636facf01d2`), Aula's public portal JavaScript, and authenticated response shapes using the already encrypted local PoC session. No interactive login, plaintext credential file, private message output or raw response export was used.

| Parent-facing information | Actual reads and response |
| --- | --- |
| Direct messages and conversations | `messaging.getThreads` → `threads`, `moreMessagesExist`; `messaging.getMessagesForThread` → `messages`, `moreMessagesExist`, `sendDateTime`, `text`. Sensitive threads are skipped. |
| Overview / class / institution posts | `posts.getAllPosts`, `parent=profile`, offset `index`, `limit=10`, **one union of guardian institution-profile IDs and child IDs**. The returned `posts` carry `content.html`, `publishAt`, `sharedWithGroups`. |
| Notification overview | `notifications.getNotificationsForActiveProfile`, with active children, returns notification pointers and structured alerts. Message/post pointers are not duplicated as AI sources; the underlying feeds are read. Presence notices with `noteToGuardians` are candidates. |
| Classes / recipients | `groups.getGroupsByContext` returns outer `{profileId, groups:[...]}` entries, not a flat group list. Match child `profileId`, then group IDs; provide person/class scope to analysis. |
| MeeBook | Widget `0004`; `aulaToken.getAulaToken` then `GET app.meebook.com/aulaapi/relatedweekplan/all`. Current and next ISO week. |
| Calendar context | `calendar.getEventsByProfileIdsAndResourceIds`; prior 21 days for the weekly baseline, current/upcoming 14 days for exceptions. Raw timetable remains memory-only. |

“Alle beskeder” is treated as the combined parent information stream requested in the product brief, not an invented API endpoint. The portal's overview component itself calls the posts API above, alongside notifications; direct conversation reads remain separate.

Public portal source: `https://www.aula.dk/portal/`, bundles `0.b192a1b9903324f6cc7a.js` and `10.f150539da01a4ecbcf8f.js`. The latter's `getPosts()` constructs the guardian + child union. Reference: https://github.com/Casperjuel/aula-mcp/tree/5c64e98eaba98288770650f8cafe1636facf01d2/packages/aula-client/src . Public reference bundles stay ignored under `supabase/.temp`.

## Proven defects

- The old incremental window started one day before last success; even a full scan only read 14 days. It missed older notices with future actions. Scans now read 45 days, with explicit pagination bounds and a visible failure rather than silently advancing after truncation.
- Child-only and guardian-only posts queries returned no posts. The same session with Aula's combined scope returned ten posts on the first page. Overview posts are now included, with group relevance applied.
- MeeBook received `currentWeekNumber=46`: HTTP 400. Changing **only** this parameter to `2026-W46` gave HTTP 200, three children and 42 current-week task entries. Guardian ID in `sessionuuid` worked. The current/upcoming read then returned six plans. No username or new handoff is required by this proven path. Profiles/context supply child opaque user IDs and institution codes. ISO year rollover is tested. Token-expiry responses receive one bounded retry; widget failures block scan completion.
- Ordinary calendar entries were sent directly to AI. The real response marks lessons with `type=lesson` and a nested `lesson`. The new prefilter combines those markers with repeated per-child weekday, title, time, duration and location. Cancellation, practical notes, exceptional titles and deviations from the observed baseline survive. It does not rely on a subject-name list.

## Relevance and privacy

AI uses BRING / DO / PREPARE / DEADLINE / RESPOND / PAY / ATTEND / CHANGE / IMPORTANT_INFO. GENERAL_INFO, low confidence and NO_ACTION do not become review rows. Brief exact evidence is checked in memory against the original source and paragraph/class scope, then removed before the database call. It is never logged or saved. Relative dates use the source timestamp in Copenhagen; an unknown timestamp cannot be silently replaced by the scan date. Old actions with dates in the past are excluded, while future actions in older messages remain eligible.

Long source text is split into bounded 6,000-character inputs, preserving later paragraphs instead of silently dropping them. Sources over 120,000 characters or a scan exceeding its candidate/page budget fail explicitly. Three AI batches at most run concurrently, with the existing 240-second scan deadline. All sources and transient evidence are discarded after processing. Only compact findings, metadata and aggregate counts are persisted.

Same-event dedupe across message/calendar batches is limited to ATTEND, same selected people, date, compatible time and strongly matching title words. A BRING reminder is distinct from its trip. Existing activity matching and explicit human acceptance remain intact.

## Authenticated read-only verification before deployment

- 3 children; all three classes resolved.
- 45 non-sensitive messages read in 15 threads; 41 relevant message sources; 2 sensitive threads skipped.
- 30 posts read; 20 relevant overview/post sources (one source set, not two copies).
- 192 notifications inspected; zero standalone actionable alert bodies in this read.
- MeeBook: 6 current/upcoming plans, 53 distinct candidate entries.
- Calendar: 387 baseline entries; 288 upcoming entries, all 288 routine-filtered, zero exception candidates.
- 114 AI candidates before model analysis. This is **collection verification**, not a claim about final production finding quality.
- Detected catalog widgets: MeeBook weekplan `0004`, another MeeBook widget `0003`, Tabulex widgets `0047` / `0049`. No EasyIQ, MinUddannelse or Systematic integration was detected. The extra widgets were inventoried only; no unverified content capability is claimed or blindly implemented.

## Production cleanup and acceptance

### Production analysis validation (10 November 2026)

The diagnostic production scan at 10:17 UTC read MeeBook successfully (HTTP 200 for both weeks, six plans / 55 sources), then failed in `aula-analyze` with `AULA_ANALYSIS_INVALID_EVIDENCE`. The previous contract asked the model to reproduce a literal source substring; the output did not satisfy the evidence validator. No raw evidence or source content was logged to diagnose this.

The model now selects a bounded, source-specific `evidence_index` from supplied original text spans. The server resolves the index to the original span in memory and applies the existing exact-source and person/class checks. Invalid indices and cross-source people remain rejected; evidence is still removed before persistence. This also handles semicolon-separated class instructions. The earlier transport failure did not recur in this diagnostic scan; its precise network cause has not been established and is not claimed fixed by this change.

The next production scan at 10:29 UTC identified the intermittent transport failure: `meebook.token.ok` followed by `meebook.fetch.failed / AULA_NETWORK_CONNECT_TIMEOUT` after about ten seconds, before any HTTP response from MeeBook. A single retry now covers only this idempotent MeeBook GET connection failure, sharing the original scan deadline and one retry budget across token-expiry attempts. TLS errors, cancellation, HTTP errors and token refresh are not retried by this change. The evidence proves the connection timeout, not its underlying network cause.

The old scan cohort has exact `created_at=2026-11-09T16:30:35.231472Z`. Before cleanup there were 240 `new`, 36 `ignored`, and **one accepted** finding. Only still-new rows in this exact cohort may become stale. Do not change the accepted row, calendar item, ignored rows, session, person assignments, feeds or rewards. Cleanup is a narrowly scoped data correction, not a schema migration.

After deployment run one production scan through the user's existing authenticated app. Verify stage counters, completion, new-only findings, zero ordinary lesson findings and preserved accepted/calendar/mapping state. Then stop: the user reviews `Familie → Aula → Fund fra Aula`. Technical tests cannot substitute for that relevance review.
