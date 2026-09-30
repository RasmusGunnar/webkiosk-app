-- Cover tenant/person foreign keys and occurrence audit lookups.
begin;
create index if not exists reward_config_tenant_person on public.reward_person_config(household_id,person_id);
create index if not exists reward_occurrence_tenant_person on public.task_reward_occurrences(household_id,person_id);
create index if not exists reward_events_tenant_person on public.reward_occurrence_events(household_id,person_id);
create index if not exists reward_events_occurrence on public.reward_occurrence_events(occurrence_id);
create index if not exists reward_goal_tenant_person on public.reward_goals(household_id,person_id);
commit;