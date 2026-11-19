# Release 1.0 — privileged database review

Reviewed 2026-11-19 against production `oyyqniwppytipdktzwsy`, baseline `1ec761a4`. Scope: all 68 SECURITY DEFINER functions in public/private schemas, grants, search paths, callers and household predicates. No blanket conversion to INVOKER and no advisory suppression.

All 68 use an empty search_path. None grants EXECUTE to anon. Private schema is not exposed through PostgREST. Authenticated helper access exists for RLS predicates and invoker wrappers; it is not an unrestricted public RPC surface.

| Function | EXECUTE | Reviewed boundary |
|---|---|---|
| `private.accept_household_invitation(p_token text)` | authenticated | Admin/owner invitation; verified recipient email, single-use hashed token |
| `private.account_deletion_objects(p_user_id uuid)` | service_role | Service-only; authenticated server supplies user, deletion plan/storage scope |
| `private.account_deletion_plan()` | authenticated | Authenticated own account or household membership |
| `private.allowance_action(hid uuid, action text, payload jsonb)` | owner/internal | Internal-only; invoked under an authorized wrapper, household-scoped state |
| `private.apply_calendar_feed_import_base(p_feed_id uuid, p_actor_id uuid, p_token uuid, p_rows jsonb, p_range_start date, p_range_end date, p_cleanup boolean)` | owner/internal | Internal-only; invoked under an authorized wrapper, household-scoped state |
| `private.apply_import_override(p_id uuid, p_from_source boolean)` | owner/internal | Internal-only; invoked under an authorized wrapper, household-scoped state |
| `private.apply_subscription_verification(p_user_id uuid, p_claim_id uuid, p_verified jsonb, p_started_at timestamp with time zone, p_event_id text, p_type text)` | service_role | Service-only; verified provider state, user/claim binding, idempotent events |
| `private.aula_adult(hid uuid, uid uuid)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.aula_diagnostic_release(hid uuid, lease_id uuid)` | service_role | Service-only wrapper; adult/lease/claim/generation gates; fixed scheduler endpoint |
| `private.aula_handoff_server(action text, hid uuid, uid uuid, p jsonb)` | service_role | Service-only wrapper; adult/lease/claim/generation gates; fixed scheduler endpoint |
| `private.aula_map(hid uuid, mappings jsonb)` | authenticated | Adult membership, household-scoped finding/mapping, explicit review |
| `private.aula_review(hid uuid, fid uuid, action text, selected_people uuid[])` | authenticated | Adult membership, household-scoped finding/mapping, explicit review |
| `private.aula_review_corrected(hid uuid, fid uuid, action text, selected_people uuid[], date_value text, time_value text, title_value text, override_time boolean)` | authenticated | Adult membership, household-scoped finding/mapping, explicit review |
| `private.aula_revoke_handoffs()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.aula_server(action text, hid uuid, uid uuid, p jsonb)` | service_role | Service-only wrapper; adult/lease/claim/generation gates; fixed scheduler endpoint |
| `private.begin_account_deletion(p_user_id uuid, p_delete_households uuid[])` | service_role | Service-only; authenticated server supplies user, deletion plan/storage scope |
| `private.block_deleting_account()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.bootstrap_aula_scheduler()` | owner/internal | Owner-only cron/setup; fixed allowlisted endpoint, credentials read from private configuration |
| `private.bump_calendar_revision()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.bump_recipe_revision()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.bump_reward_revision()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.claim_reward_milestone(p_household_id uuid, p_person_id uuid, p_month_start date)` | authenticated | Household gate; person assignment, adult approval, idempotent receipt and frozen periods |
| `private.complete_task_as_device(p_request_id uuid, p_item_id uuid, p_due_date date, p_person_id uuid, p_done boolean, p_action text)` | authenticated, service_role | Own paired anonymous identity or household admin; bounded capabilities and explicit projection |
| `private.create_household(p_name text)` | authenticated | Authenticated user; anonymous identity denied by guard_wall_identity |
| `private.create_subscription_claim(p_household_id uuid)` | authenticated, service_role | Household membership/admin and purchaser claim binding |
| `private.create_wall_pairing(p_household_id uuid)` | authenticated, service_role | Own paired anonymous identity or household admin; bounded capabilities and explicit projection |
| `private.dispatch_aula_scans(at_time timestamp with time zone)` | owner/internal | Owner-only cron/setup; fixed allowlisted endpoint, credentials read from private configuration |
| `private.dispatch_calendar_sync()` | owner/internal | Owner-only cron/setup; fixed allowlisted endpoint, credentials read from private configuration |
| `private.ensure_allowance_periods(hid uuid)` | owner/internal | Internal-only; invoked under an authorized wrapper, household-scoped state |
| `private.export_family_data(p_household_id uuid)` | authenticated | Membership; household predicates on every dataset; secrets excluded |
| `private.finalize_reward_months(hid uuid)` | owner/internal | Internal-only; invoked under an authorized wrapper, household-scoped state |
| `private.get_reward_state(p_household_id uuid)` | authenticated | Household gate; person assignment, adult approval, idempotent receipt and frozen periods |
| `private.guard_person_reward_config()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.guard_task_rewards()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.guard_wall_identity()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.household_entitled(hid uuid)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.invite_household_member(p_household_id uuid, p_email text, p_role text)` | authenticated | Admin/owner invitation; verified recipient email, single-use hashed token |
| `private.is_household_admin(hid uuid)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.is_household_member(hid uuid)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.is_reward_adult(hid uuid)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.list_household_members(p_household_id uuid)` | authenticated | Authenticated own account or household membership |
| `private.manage_wall_device(p_device_id uuid, p_action text, p_name text)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.normalize_import_identity()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.recipe_deletion_objects(p_user_id uuid)` | service_role | Service-only; authenticated server supplies user, deletion plan/storage scope |
| `private.reconcile_reward_tasks()` | owner/internal | Trigger-only; enclosing table RLS, scoped row IDs, revisions/cleanup |
| `private.redeem_wall_pairing(p_code text, p_platform text)` | authenticated, service_role | Own paired anonymous identity or household admin; bounded capabilities and explicit projection |
| `private.register_device(p_installation_id uuid, p_household_id uuid, p_platform text, p_app_version text, p_push_token text)` | authenticated | Authenticated membership; installation bound to own account |
| `private.revoke_household_invitation(p_invitation_id uuid)` | authenticated | Admin/owner invitation; verified recipient email, single-use hashed token |
| `private.reward_action(p_request_id uuid, p_household_id uuid, p_action text, p_payload jsonb)` | authenticated | Household gate; person assignment, adult approval, idempotent receipt and frozen periods |
| `private.reward_reverse(s task_reward_occurrences, why text)` | owner/internal | Internal-only; invoked under an authorized wrapper, household-scoped state |
| `private.set_display_locale(p_device_id uuid, p_locale text)` | authenticated, service_role | Own paired anonymous identity or household admin; bounded capabilities and explicit projection |
| `private.subscription_access(p_household_id uuid)` | authenticated, service_role | Household membership/admin and purchaser claim binding |
| `private.sync_calendar_mutation(p_mutation_id uuid, p_household_id uuid, p_expected jsonb, p_upserts jsonb, p_delete_ids uuid[])` | authenticated | Membership, scoped rows/identities, validated payload, concurrency/rate guard |
| `private.wall_can_access(hid uuid)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.wall_can_complete(hid uuid, action text)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.wall_can_view_avatar(object_name text)` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.wall_device()` | authenticated, service_role | RLS/caller predicate; boolean or own active anonymous device; private schema |
| `private.wall_snapshot()` | authenticated, service_role | Own paired anonymous identity or household admin; bounded capabilities and explicit projection |
| `public.apply_calendar_feed_import(p_feed_id uuid, p_actor_id uuid, p_token uuid, p_rows jsonb, p_range_start date, p_range_end date, p_cleanup boolean)` | service_role | Service-only; feed scope, actor membership where applicable, lease/generation; no browser execute |
| `public.aula_scheduler(p_action text, p_household_id uuid, p_user_id uuid, p_payload jsonb)` | service_role | Service-only wrapper; adult/lease/claim/generation gates; fixed scheduler endpoint |
| `public.begin_calendar_feed_import(p_feed_id uuid, p_actor_id uuid)` | service_role | Service-only; feed scope, actor membership where applicable, lease/generation; no browser execute |
| `public.claim_recipe_scan(p_household_id uuid)` | authenticated, service_role | Membership, scoped rows/identities, validated payload, concurrency/rate guard |
| `public.due_calendar_feeds(p_limit integer)` | service_role | Service-only; feed scope, actor membership where applicable, lease/generation; no browser execute |
| `public.edit_imported_calendar_scope(p_id uuid, p_expected timestamp with time zone, p_patch jsonb, p_scope text, p_hide boolean)` | authenticated, service_role | Membership, scoped rows/identities, validated payload, concurrency/rate guard |
| `public.fail_calendar_feed_import(p_feed_id uuid, p_token uuid, p_message text)` | service_role | Service-only; feed scope, actor membership where applicable, lease/generation; no browser execute |
| `public.list_hidden_calendar_imports(p_household_id uuid)` | authenticated, service_role | Membership, scoped rows/identities, validated payload, concurrency/rate guard |
| `public.reconcile_calendar_imports(p_feed_id uuid)` | service_role | Service-only; feed scope, actor membership where applicable, lease/generation; no browser execute |
| `public.restore_calendar_import(p_household_id uuid, p_feed_id uuid, p_uid text, p_occurrence text)` | authenticated, service_role | Membership, scoped rows/identities, validated payload, concurrency/rate guard |

## Post-migration verification

Production now has 70 SECURITY DEFINER functions; anonymous executable count is zero. The two added functions are the service-only browser transaction and non-callable connector deletion trigger, reviewed below. Four WARN and 21 INFO findings remain, including the new intentionally default-deny flow table. npm audit after compatible lockfile updates: zero known vulnerabilities.

## Advisor decisions

- Four authenticated definer warnings remain intentionally: claim_recipe_scan, edit_imported_calendar_scope, list_hidden_calendar_imports, restore_calendar_import. Each has explicit authenticated household checks, empty search_path and bounded scope; their privileges are necessary for their existing RPC contracts. [Supabase advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Twenty baseline default-deny tables have RLS without client policies. Credentials, handoff hashes, scheduler state, purchase claims/events and import/deletion internals are accessed only by vetted functions or service role. Adding permissive policies to silence the notices would weaken isolation. [Supabase advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- New browser flow table follows the same default-deny model; its service-only function requires initiating adult, household, state hash, expiry, one-use claim and app completion proof. Callback alone never changes a connection. Provider registration gate remains OFF.
- New account-deletion trigger is not callable by public/anon/authenticated/service_role. It executes on deletion of the actual session owner, removes credentials/leases and preserves shared family data. Person reference constraints defer until household cascades finish.
- Export version 2 retains the membership guard and adds an adult-only Aula section with an explicit field allowlist; no session, raw source, private feed URL or provider child identifier.

## Verification evidence

Disposable PostgreSQL: foundation 49, calendar 20, product 14, release 35 checks. Current person-task, stars and allowance suites supersede historical shared-done tests. Cross-family/wall/child role checks and current receipt/lease/claim tests run against fresh local Auth/PostgREST and PostgreSQL. See RELEASE-1.0-CURRENT.md for final counts and deployment state.

This is an application security review, not an independent penetration test. Store provider credentials and physical native acceptance remain separate gates. Subscription enforcement remains OFF.
