# Correct Aula suggestions before acceptance

New actionable findings have inline date, optional time and title controls alongside the existing person picker. Missing dates are editable immediately; existing dates and titles have discreet edit buttons. Local drafts survive accepting another finding or a failed request, and are cleared on household changes. Controls are disabled while acceptance is pending.

`aula_review` accepts `p_date`, `p_time`, `p_title` and existing `p_person_ids`. `p_override_time=true` explicitly clears a time when `p_time=null`; an older caller omitting the new arguments retains its original AI time. There is one public RPC signature with defaults, avoiding PostgREST overload ambiguity.

The private correction wrapper checks adult household membership, obtains the same household advisory lock and finding row lock as the existing acceptance path, validates the date/time/title, and applies final values before calling the existing activity-only acceptance function. Invalid people roll back the whole transaction. Repeated/concurrent acceptance returns the existing item. No table/column changes, session writes or scans are introduced. Accepted finding fields retain the final values; the calendar item remains authoritative afterwards. Existing event duration is preserved when moving a timed start.

Validation:

- Full app unit suite, typecheck, build and da-DK/en-GB i18n guard.
- `node tests/aula-activity-db.mjs`: actual PostgreSQL/WASM migration, validation, cross-household rejection, idempotency, old-call compatibility, no reward/star/allowance mutations.
- `node tests/aula-review-api.mjs`: isolated local Supabase Auth/PostgREST, real RPC named arguments, concurrent acceptance, anonymous/cross-household denial; synthetic records removed afterwards.
- `node tests/aula-review-browser.mjs`: actual Chrome UI at 375/390/430/1280 px, draft updates, RPC payloads, null time, multiple people, reachable controls and overflow checks. Synthetic visual review: `supabase/.temp/aula-review-overrides/review.html` (ignored).

Deploy the compatible function migration before publishing the new frontend. No real finding is accepted for deployment verification. Compare safe production hashes/counts before and after to confirm the existing 17 findings, child mappings and encrypted session remain unchanged.
