-- Add bounded user-visible Aula data and current calendar semantics to export.
-- Existing membership gate is retained; Aula content additionally requires adult.
-- No provider IDs, credentials, source payloads or private feed URLs are exported.
begin;
create or replace function private.export_family_data(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('format_version',2,'exported_at',now(),
 'household',(select jsonb_build_object('id',id,'name',name,'created_at',created_at) from public.households where id=p_household_id),
 'people',coalesce((select jsonb_agg(to_jsonb(p)-'avatar_url') from public.household_people p where household_id=p_household_id),'[]'),
 'calendar_and_tasks',coalesce((select jsonb_agg(to_jsonb(i)-'data'||jsonb_build_object('data',
  (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(i.data) where key=any(array['title','date','time','person','people','personIds','type','note','done','location','durationMin','repeatWeekly','repeatYearly','repeatUntil','birthYear','seriesId','overrideOf','overrideBaseId','exceptions','weekdays','originalDate','previousSeriesId','emoji','taskEmoji','rewardMode','starValue','requiresApproval','bonusPool','rewardOriginId','rewardRules','allDay','endDate','endTime','recipe_id','servings_override','meal_id','ingredient_id','ingredient_raw_text','recipe_action_id','recipe']))))
  from public.calendar_items i where household_id=p_household_id),'[]'),
 'reward_state',coalesce((select jsonb_agg(to_jsonb(r)) from public.reward_celebrations r where household_id=p_household_id),'[]'),
 'monthly_milestones',coalesce((select jsonb_agg(to_jsonb(m)) from public.reward_monthly_milestones m where household_id=p_household_id),'[]'),
 'rewards_v2',private.reward_state(p_household_id)||jsonb_build_object(
 'ledger',coalesce((select jsonb_agg(to_jsonb(l)) from public.reward_star_ledger l where household_id=p_household_id),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.reward_occurrence_events e where household_id=p_household_id),'[]')),
 'feed_metadata',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',source,'name',name,'assigned_person_id',assigned_person_id,'assigned_person_name',assigned_person_name,'is_active',is_active,'last_sync_at',last_sync_at,'last_sync_status',last_sync_status)) from public.calendar_feeds where household_id=p_household_id),'[]'),
 'recipes',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('ingredients',(select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]') from public.recipe_ingredients i where i.recipe_id=r.id),'instructions',(select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]') from public.recipe_instructions i where i.recipe_id=r.id),'ratings',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.recipe_ratings v where v.recipe_id=r.id))) from public.recipes r where household_id=p_household_id),'[]'),
 'aula',case when private.aula_adult(p_household_id) then jsonb_build_object(
  'connection',(select jsonb_build_object('status',c.status,'last_scan_at',c.last_scan_at,'last_success_at',c.last_success_at) from public.aula_connections c where c.household_id=p_household_id),
  'children',coalesce((select jsonb_agg(jsonb_build_object('person_id',m.person_id,'display_name',m.display_name,'school',m.school,'class_name',m.class_name,'group_names',m.group_names)) from public.aula_child_mappings m where m.household_id=p_household_id),'[]'),
  'findings',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'person_ids',a.person_ids,'person_id',a.person_id,'type',a.type,'title',a.title,'date',a.date,'time',a.time,'end_date',a.end_date,'end_time',a.end_time,'location',a.location,'summary',a.summary,'reason',a.reason,'confidence',a.confidence,'status',a.status,'proposed_action',a.proposed_action,'created_calendar_item_id',a.created_calendar_item_id,'matched_calendar_item_id',a.matched_calendar_item_id,'created_at',a.created_at,'updated_at',a.updated_at)) from public.aula_findings a where a.household_id=p_household_id),'[]')
 ) else null end,
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.list_household_members(p_household_id) m),'[]'));
end $$;

notify pgrst,'reload schema';
commit;
