# Product Batch 4.0 — local review

Branch: feature/product-batch-4. No hosted changes, deployments, commits or pushes.

## Photo scanning

The existing recipe-preview function uses the OpenAI Responses API with image input and strict structured output. OPENAI_RECIPE_VISION_MODEL is server-only; default gpt-4.1-mini. The earlier RECIPE_VISION_MODEL setting remains a fallback.

OPENAI_API_KEY is missing locally. LIVE VISION BLOCKED: OPENAI_API_KEY MISSING. Provider contract/browser fixtures are explicitly labelled and are not a successful live provider test. No key belongs in a VITE_ variable or Git. A physical camera still requires a device test.

- Browser capture/file input, 1–4 pages, EXIF-aware decode, 2000 px longest side, JPEG quality .87. Raw input ≤25 MB; decoded pixels ≤50 million; each processed file ≤5 MB; total ≤12 MB.
- Private recipe-images temporary paths: household/scan UUID/scan-user UUID-file UUID.jpg. The function verifies Auth, household membership, path ownership, signatures, dimensions and limits before provider access.
- 6 attempts/user/household/minute, 12/household/minute; transactional rate claims. Provider timeout 45 s. Controlled Danish messages.
- Both function finally and client finally remove only that attempt's temporary objects. The client retries cleanup once. If connectivity prevents cleanup, the error is explicit; no false success is reported.
- Only an explicitly chosen cover is saved permanently through the existing recipe save/storage flow. Other scan originals are not attached to the recipe.
- Structured ingredient details survive unchanged text in the editor; editing a line removes its stale parsed metadata. The existing save_recipe RPC supports strings and structured ingredients.
- URL-import SSRF rules are unchanged. No new bucket or Edge Function.

Official API references:
https://developers.openai.com/api/docs/guides/images-vision
https://developers.openai.com/api/docs/guides/structured-outputs

## Fixed allowance agreements

Two additive tables are necessary: agreement versions and period contracts. Existing monthly history tables have month-only keys/checks, so they remain intact rather than being repurposed for weeks.

Expected obligations reuse task_reward_occurrences, the existing reward_action RPC, approvals, excused status, audit events and offline queue. No replacement task table or star ledger. The existing reward_task_instances projection also resolves frozen obligations. The task/day views project each weekly window once, keeping the original action identity. Calendar/import rendering and source data remain unchanged.

- Monthly/weekly civil date periods; daily, weekdays, selected ISO weekdays, once per week.
- Server transactions and the existing household advisory lock ensure one immutable amount/rules/obligations snapshot. App load/task operations ensure periods; no new cron.
- Changes apply next period; first setup defaults next period, with explicit full-amount start-today.
- Future duties enter the denominator immediately. Integer rounding: (amount × completed × 2 + eligible) / (eligible × 2), integer division.
- Pending/rejected do not earn; completed/approved do. Excused is excluded. Undo can reduce an open period.
- Closed totals are immutable to normal task changes, including late approval. All-excused totals remain undecided until an adult explicitly records an amount; no automatic zero/full payout.
- Manual payout status only. No transfer of money. Existing historical payouts and star ledger remain.
- Legacy current expectations are frozen once. Only explicit single-person, unmodified weekly templates are suggested in a review-required draft. Stable legacy task IDs prevent duplicate task projections after adoption; titles are never used to match identities.
- Archived people/paused agreements stop future generation. Money displayed is server-confirmed; task checkboxes can be queued offline. New open obligations do not emit misleading undo animations.
- The UI retains separate kroner/stars, reduced motion and once-per-period 100% feedback.

## Local migrations and review

- 20261007083203_recipe_scan_guardrails.sql
- 20261007083208_allowance_agreements.sql

Applied only to the local development database. Production has not been touched.

Visual gallery: ../supabase/.temp/product-batch40/review.html (ignored, synthetic local fixtures only).

Targeted acceptance commands from repository root:

- npm --prefix app test
- node app/tests/recipe-scan40-api.mjs
- node app/tests/allowance-agreements-api.mjs
- node app/tests/recipes-api.mjs
- node app/tests/rewards-v2-api.mjs
- node app/scripts/preview-local.mjs --build-only
- node app/tests/product-batch40-browser.mjs
- node app/tests/recipes-browser.mjs
- node app/tests/rewards-21-browser.mjs
- node app/tests/task-offline-browser.mjs
- node app/tests/polish-browser.mjs
- npx --yes deno@2.9.6 test --config supabase/functions/deno.json --allow-env --allow-read supabase/functions/tests/recipes30.test.ts supabase/functions/tests/recipe-scan40.test.ts
- npx --yes deno@2.9.6 check --config supabase/functions/deno.json supabase/functions/recipe-preview/index.ts
- node scripts/check-release-secrets.mjs

The browser checks use the existing local preview server on port 5179; database helpers refuse hosted targets. Synthetic fixtures are cleaned afterwards.
