# Permanent Aula review memory

Production project: Familiekalender (`RasmusGunnar/webkiosk-app`),
https://familiekalender-alpha.vercel.app/. No other project is involved.

## Proven cause

The old finding key hashed source + people + classification + normalized AI
title. A paraphrase or classification change therefore bypassed the existing
`ON CONFLICT ... WHERE status = 'new'` protection. Decisions were preserved in
their original rows, but a differently worded duplicate could become a new row.

## Identity and revisions

- `origin_source_key` is a household-scoped HMAC of the provider source identity.
  Message chunks share their parent origin. MeeBook uses child + provider item
  ID, excluding its movable plan date; missing IDs use week/day/index fallback.
- Action identity binds origin, exact people and an existing source action
  span/object. Generic instruction synonyms, AI classification, summary and
  confidence are not identity. AI titles only select among source-backed spans.
  Concrete lists are split before identity so AI grouping does not hide sibling
  actions such as lunch, bottle and warm clothing.
- Separate HMACs represent source revision and material source context. Model
  date/wording changes alone cannot create a material update. A changed source
  date or instruction can create an `UPDATED` review card. Compare with the
  latest decision, including a later reversion to a formerly reviewed date.
- Private identity rows refer to existing findings. Their accepted/ignored
  status remains decision memory indefinitely, irrespective of UI history age.
  No raw provider text, provider IDs, tokens or cookies are persisted here.

The matching is deliberately deterministic and source-bound, not general fuzzy
semantic matching across unrelated messages. Ambiguous legacy matches remain
untouched. Legacy origin HMACs cannot be reversed: binding requires recreating
the exact old HMAC from a currently read source and saved or regenerated action.
This can also recover a manually retitled legacy finding when its original
candidate is regenerated. Historical source revisions absent from the old
schema cannot be reconstructed; the first proven binding establishes a baseline.

## Transaction and security

`scan_memory` is available only through the existing service-only gateway and a
valid household/credential-generation lease. `scan_finish` rechecks decisions
under row locks, so an ignore/accept during the scan wins. Authentication, session
rotation, mappings and the read-only provider guard are unchanged.

The private identity table has RLS, no public/anon/authenticated grants, indexed
household/action lookup and no exposed SECURITY DEFINER endpoint. The storage
helper is SECURITY INVOKER and runs inside the existing fenced transaction.
Cross-household binding fails atomically. Calendar provenance also protects a
linked accepted activity. No acceptance RPC or calendar mutation is called.

Cleanup marks only proven same-origin/action/revision pending duplicates stale.
Accepted and ignored rows remain untouched. Multiple pending duplicates of the
same proven revision are reduced to one; uncertain links remain for review.

## Verification

- Identity tests: paraphrase, classification, different people/origins, multiple
  actions, changing AI grouping, real date change, legacy HMAC and manual edits.
- Actual PostgreSQL tests: ignore/rescan/rescan, accept/paraphrase, material update,
  later reversion, sibling actions, concurrent decision, legacy cleanup, RLS.
- Local real Auth -> Node HTTP scan -> PostgREST -> PostgreSQL integration.
- Chrome review at 375/390/430/1280 px, including updated marker and inline edits.
- Existing partial-source/AI-batch, calendar, recipe/meal, allowance/native tests,
  i18n, typecheck and build.

The preceding date-fix production scan succeeded at 10:33 UTC on 11 November in
47.8 seconds. All 56 current/next-week MeeBook items resolved named-month yearless
labels inside the requested week. The reference task was stored as new with
matching date and person. The permanent-memory deployment needs its own single
user-triggered final production scan; no automatic acceptance or new MitID login.
