# Aula pilot: structured week plans and partial scans

## Proven production failure, 11 November 2026

At 08:38 and 09:12 UTC, Edge logs reported `AULA_ANALYSIS_INVALID_TIME`.
Both Vercel requests returned HTTP 502 / `AULA_ANALYSIS_UNAVAILABLE` after
profiles, groups, messages, overview, notifications, MeeBook and calendar had
completed. The model schema accepted any string for time/end_time while the
server required HH:MM or null. One failed batch cancelled every other batch.
No provider message bodies or invalid time values were logged or retrieved.

Time/end_time now have the same 24-hour pattern in the model schema and server
validation. Missing time is explicitly null; date has a format constraint and
round-trip validation. Allowlisted Edge error codes reach the scanner unchanged.
The strict source, person, evidence, date and action validators remain enforced.

## Production MeeBook structure

Authenticated read-only diagnostic, 11 November: three children, three plans
per week. Previous week: 50 items (43 comment, 7 task). Current week: 43 items
(37 comment, 6 task). Next week: 13 items (8 comment, 5 task).
All observed items had `type`, `pill`, `content`, `id` and a parent day date.
No `title`, `editUrl`, separate deadline or `assignment` type was observed.
The earlier normalizer retained content but discarded type and subject.

| Observed type | Treatment |
| --- | --- |
| task | Structured action candidate, mapped child and subject supplied to AI first. If AI omits it, retain a bounded source-backed MEDIUM suggestion for review, except explicit cancellation/no homework or incompatible class scope. |
| comment | Planning/lesson information; emit only a concrete practical action. |
| unknown | Conservative AI interpretation. No automatic fallback or acceptance. |

The MIT reference is `Casperjuel/aula-mcp`, pinned in `aula-third-party.md`,
`packages/aula-client/src/integrations/meebook.ts`. Its mention of assignment
does not establish that this account supplies such a type.

`weekPlan[].date` is the container's plan day, not a dedicated due-date field.
Pass it as `date_context=week_plan_day`. Explicit dates in content can refine it;
uncertain dates remain null and can be corrected in review. Do not manufacture
a midnight appointment from a day timestamp. Structured person ownership uses
the existing child-to-household mapping, never a model-invented person.

A full pilot scan also reads the previous week for structural verification of
the user-supplied example. Those historical rows are discarded before AI and
storage. Diagnostics contain only counts, known field presence and bounded type
enums; never content, names, IDs, URLs, tokens or cookies.

The class parser previously treated the lowercase preposition in `side 30 i
format` as class `30i`. Class labels now accept `3.C`, `3C`, `3 C`, with tests
for page numbers, other classes and per-sentence scope.

## Failure isolation and budget

Each optional source/week has an abortable budget, within a shared 100-second
collection budget. MeeBook tasks precede messages and overview in the AI budget;
routine calendar lessons are filtered before AI. Messages retain a 45-day
lookback and use source timestamps for relative dates.

AI has at most three batches in flight, max 12 sources and 95 KB UTF-8 per batch.
Known validation/transport failures retain other valid batches; authentication,
unknown programming failures and parent cancellation stop the scan. All failed
batches are an error, never a successful empty scan. AI work stops by request
second 215, leaving space for scan_finish within the existing 240-second app
deadline and 300-second platform limit. Neither deadline was increased.

Numeric source statuses in scan_counts: 0 SKIPPED, 1 PASS, 2 PARTIAL, 3 FAIL.
The API exposes named statuses and `PARTIAL_SUCCESS` when needed. The persisted
`partial` count displays a persistent review/overview notice. last_success_at
means valid results were saved, potentially partially; it is not a completeness
cursor. Every scan rereads the bounded lookback, so a failed source is not lost
behind an advanced cursor. Per-stage durations and failed batch counts are safe.

Token/session/decryption, authorization and DB integrity failures remain fatal.
Refresh rotation is persisted before source reads. No acceptance RPC is called;
new suggestions remain new. Accepted activities, rewards, ICS and person mapping
IDs are not modified by this change. Unknown/unimplemented widgets are counted,
not silently claimed as read.

## Verification

- Unit/integration suite: time contract, strict people/evidence, read-only guard,
  optional-source failures, critical auth failures, batch isolation, all-failed
  rejection, byte budgets, cancellation, structured retention and class scope.
- PostgreSQL/PGlite: real migrations, household isolation, service-only diagnostic
  lease release, activity acceptance, review edits and no reward effects.
- Headless Chrome: partial notice and existing inline review at 375, 390, 430 and
  1280 pixels. Synthetic screenshots remain in ignored supabase/.temp.
- i18n parity, TypeScript, production build and diff checks.
- Production verification uses one final user-triggered full scan with the
  existing session. No automatic acceptance or new MitID login.

The diagnostic lease release migration exposes only a SECURITY INVOKER wrapper
to service_role. Both anon and authenticated EXECUTE remain revoked. It releases
only the matching, unexpired household lease and credential generation, without
altering connection success/error metadata or findings.
