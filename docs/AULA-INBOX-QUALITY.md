# Aula inbox quality

The scanner processes source-backed action fragments in this order: person
scope, date, actionability, exact duplicates, HIGH-confidence context groups,
then conservative lifecycle. It does not aim for a fixed card count.

Structured recipients bound possible people. Class/year clauses and named
commitments narrow the particular action. Unknown recipients produce an
unassigned review item; another family's named commitment is excluded. An
empty person assignment still requires user correction before acceptance.

Dates use a structured deadline/event, explicit source date, source timestamp
in Copenhagen for relative dates, or the MeeBook plan day. A plan day is not a
publication timestamp. A unique, distinctive matching calendar topic with the
same people and compatible timing can supply an event date. Generic topics,
ambiguous dates or shared person/date alone never establish an event link.

Routine teaching, retrospective updates and non-planning information are not
review items. The provider's MeeBook task marker alone is not proof of homework.
The AI receives these rules, and deterministic validation applies afterwards.

Complementary actions can share a card when they have the same supported
sentence/action context or a proven event. Different action families such as
bringing sportswear and submitting maths remain separate. Decimal quantities
are not split. Material specifics remain in the title/summary. If a complete
list would exceed existing field limits, the actions remain separate.

## Decisions and reconciliation

Existing origin/action/source/material identities and immutable reviewed rows
remain authoritative. Private `aula_review_components` stores only HMACs and
finding references, with RLS and no client permissions. It connects a reviewed
combined item to future grouped or separate components. A new real component
may yield UPDATED, while unchanged accepted/ignored/automatically expired
components are suppressed. For a proven event, a newly added action retains
the prior reviewed material context. No automatic calendar acceptance occurs.

Legacy binding requires the same source origin/revision, source timestamp when
known, people and source-backed action coverage. It does not fuzzy-match titles
across unrelated sources. Ambiguous legacy decisions are not guessed.

Quality-versioned checkpoints cause one reanalysis of existing sources. Only
origins whose complete source chunks were successfully analyzed authorize
reconciliation. Finish checks the original NEW row's timestamp and identity;
reviewed/concurrently changed rows survive. Old NEW rows become stale, never
deleted. Failed or unread sources do not authorize cleanup. Component decisions
are rechecked under locks in the existing credential-generation-fenced finish
transaction. The scheduler and token rotation path are unchanged.

## Dateless lifecycle

No global TTL. Dated items retain Copenhagen `coalesce(end_date,date)` expiry.
Dateless RESPOND/PAY stays persistent. Only BRING/PREPARE with explicit immediate
wording (snarest/hurtigst muligt/denne uge) and a real publication timestamp gets
an inclusive 14-day source-anchored expiry. Rescans never renew it. Everything
else remains unresolved for review. The SQL predicate, old-client acceptance
guard and browser midnight/offline predicate agree.

## Safe measurements

Counts contain no names, provider IDs, raw messages or credentials:
`raw_sources`, `action_fragments`, `wrong_person_filtered`, `uncertain_person`,
`dates_resolved`, `noise_filtered`, `important_info_noise`,
`exact_duplicates_suppressed`, `event_clusters`,
`complementary_fragments_merged`, `cross_source_clusters`,
`already_covered_suppressed`, `component_covered_suppressed`, `quality_retired`,
`dateless_immediate`, `dateless_persistent`. AI may already omit noise; the
deterministic noise count only measures returned fragments it rejects.

Person correctness in real sources still requires human review; a zero count
of rule violations is not proof of zero semantic mistakes. The controlled
production scan report records actual totals and protected-table checksums.

Tests cover scope, dates, quantities, noise, exact/non-merges, component memory,
material updates, concurrent review, expiry, RLS, reconciliation, real local
Auth/API, scheduler, and existing desktop/mobile review UI.
