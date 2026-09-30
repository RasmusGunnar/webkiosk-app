-- Rewards 2.1: weekly celebration deprecated; preserve all historical rows and columns.
begin;
comment on table public.reward_celebrations is 'Deprecated legacy as of Rewards 2.1. Retained for historical export; no active writes or UI.';
comment on column public.reward_person_config.weekly_celebration_enabled is 'Deprecated legacy as of Rewards 2.1. No active product effect; preserve existing values.';
create table if not exists public.reward_monthly_milestones (
 household_id uuid not null references public.households(id) on delete cascade,
 person_id uuid not null, month_start date not null check(extract(day from month_start)=1),
 earned_minor integer not null check(earned_minor>=0), shown_at timestamptz not null default now(),
 primary key(household_id,person_id,month_start),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
alter table public.reward_monthly_milestones enable row level security;
revoke all on public.reward_monthly_milestones from public,anon,authenticated;
grant select on public.reward_monthly_milestones to authenticated;
grant all on public.reward_monthly_milestones to service_role;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='reward_monthly_milestones' and policyname='household_read') then
  create policy household_read on public.reward_monthly_milestones for select to authenticated using(private.is_household_member(household_id));
 end if;
end $$;
create or replace function private.claim_reward_milestone(p_household_id uuid,p_person_id uuid,p_month_start date)
returns boolean language plpgsql security definer set search_path='' as $$
declare m jsonb; inserted_count integer;
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
 if p_month_start is distinct from date_trunc('month',private.reward_today())::date then return false;end if;
 if not exists(select 1 from public.household_people p join public.reward_person_config c on c.person_id=p.id where p.household_id=p_household_id and p.id=p_person_id and p.is_active and p.reward_enabled and c.allowance_enabled) then return false;end if;
 m=private.allowance_month(p_household_id,p_person_id,p_month_start);
 if (m->>'eligible_total')::int=0 or (m->>'completed_total')::int<>(m->>'eligible_total')::int then return false;end if;
 insert into public.reward_monthly_milestones(household_id,person_id,month_start,earned_minor)
 values(p_household_id,p_person_id,p_month_start,(m->>'earned_minor')::int) on conflict do nothing;
 get diagnostics inserted_count=row_count;
 return inserted_count=1;
end $$;
create or replace function public.claim_reward_milestone(p_household_id uuid,p_person_id uuid,p_month_start date)
returns boolean language sql security invoker set search_path='' as $$select private.claim_reward_milestone(p_household_id,p_person_id,p_month_start)$$;
revoke all on function private.claim_reward_milestone(uuid,uuid,date),public.claim_reward_milestone(uuid,uuid,date) from public,anon;
grant execute on function private.claim_reward_milestone(uuid,uuid,date),public.claim_reward_milestone(uuid,uuid,date) to authenticated;

create or replace function private.reward_state(hid uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'configs',coalesce((select jsonb_agg(to_jsonb(c)-'weekly_celebration_enabled') from public.reward_person_config c where household_id=hid),'[]'),
 'periods',coalesce((select jsonb_agg(to_jsonb(c)) from public.reward_allowance_periods c where household_id=hid),'[]'),
 'occurrences',coalesce((select jsonb_agg(to_jsonb(c)) from public.task_reward_occurrences c where household_id=hid),'[]'),
 'balances',coalesce((select jsonb_agg(to_jsonb(b)) from (select person_id,sum(delta) as balance from public.reward_star_ledger where household_id=hid group by person_id) b),'[]'),
 'ledger',coalesce((select jsonb_agg(to_jsonb(c)) from (select * from public.reward_star_ledger where household_id=hid order by created_at desc,id limit 200) c),'[]'),
 'catalog',coalesce((select jsonb_agg(to_jsonb(c) order by sort_order,title) from public.reward_catalog c where household_id=hid),'[]'),
 'goals',coalesce((select jsonb_agg(to_jsonb(c)) from public.reward_goals c where household_id=hid),'[]'),
 'redemptions',coalesce((select jsonb_agg(to_jsonb(c)) from public.reward_redemptions c where household_id=hid),'[]'),
 'snapshots',coalesce((select jsonb_agg(to_jsonb(c) order by year desc,month desc) from public.allowance_monthly_snapshots c where household_id=hid),'[]'),
 'monthly',coalesce((select jsonb_agg(private.allowance_month(hid,p.id,private.reward_today())) from public.household_people p where household_id=hid and is_active),'[]'));
$$;
create or replace function private.reward_action(p_request_id uuid,p_household_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid:=p_household_id;uid uuid:=auth.uid();pid uuid:=nullif(p_payload->>'person_id','')::uuid;today date:=private.reward_today();
 person public.household_people;cfg public.reward_person_config;s public.task_reward_occurrences;t record;catalog public.reward_catalog;redemption public.reward_redemptions;receipt public.reward_requests;
 is_adult boolean;rule jsonb;desired text;result jsonb:='{}';balance bigint;amount int;hist jsonb;effective date;rid uuid;
begin
 if uid is null or not private.is_household_member(hid) then raise exception 'Household access denied' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Ugyldig handling'; end if;
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 select * into receipt from public.reward_requests where id=p_request_id;
 if found then
  if receipt.household_id<>hid or receipt.user_id is distinct from uid or receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Mutation access denied' using errcode='42501'; end if;
  return receipt.result||jsonb_build_object('already_applied',true,'rewards',private.reward_state(hid),'celebrations','[]'::jsonb);
 end if;
 is_adult=private.is_reward_adult(hid);
 if p_action in ('approve','reject','excuse','unexcuse','config','catalog','redemption_approve','redemption_cancel','redemption_fulfill','payout') and not is_adult then raise exception 'Kun voksne kan udføre denne handling' using errcode='42501'; end if;
 perform private.finalize_reward_months(hid);
 if pid is not null then
  select * into person from public.household_people where id=pid and household_id=hid;
  if not found then raise exception 'Personen findes ikke i familien' using errcode='42501'; end if;
  select * into cfg from public.reward_person_config where person_id=pid and household_id=hid;
 end if;
 if p_action in ('complete','undo','approve','reject','excuse','unexcuse','claim') then
  if pid is null or not person.is_active then raise exception 'Vælg en aktiv person'; end if;
  select * into t from private.reward_task_instances(hid,(p_payload->>'due_date')::date,(p_payload->>'due_date')::date)
   where task_id=(p_payload->>'item_id')::uuid and occurrence_date=(p_payload->>'occurrence_date')::date limit 1;
  if not found then raise exception 'Opgaven findes ikke længere på denne dato'; end if;
  rule=t.rule;
  if rule->>'mode'='none' and not (rule->>'approval')::boolean then raise exception 'Brug almindelig udført-markering for denne opgave'; end if;
  if (rule->>'pool')::boolean then
   if not person.reward_enabled or not coalesce(cfg.star_rewards_enabled,true) then raise exception 'Bonusstjerner er slået fra for personen'; end if;
   if p_action<>'claim' and not exists(select 1 from public.task_reward_occurrences where household_id=hid and origin_id=t.origin_id and occurrence_date=t.occurrence_date and person_id=pid and claimed) then raise exception 'Tag bonusopgaven først'; end if;
  elsif not private.task_assigned_to(t.person_ids,t.people,pid,person.name,person.name_aliases) then raise exception 'Opgaven tilhører en anden person' using errcode='42501'; end if;
  if p_action='claim' and not (rule->>'pool')::boolean then raise exception 'Opgaven er allerede fordelt'; end if;
  if p_action='claim' and exists(select 1 from public.task_reward_occurrences where household_id=hid and origin_id=t.origin_id and occurrence_date=t.occurrence_date and claimed and person_id<>pid) then raise exception 'Opgaven er allerede taget'; end if;
  if p_action in ('complete','approve') and t.due_date>today then raise exception 'Opgaven kan først udføres på sin dato'; end if;
  select * into s from public.task_reward_occurrences where household_id=hid and person_id=pid and origin_id=t.origin_id and occurrence_date=t.occurrence_date for update;
  if not found then
   insert into public.task_reward_occurrences(household_id,person_id,origin_id,occurrence_date,due_date,task_id,title,reward_mode,star_value,requires_approval,claimed)
    values(hid,pid,t.origin_id,t.occurrence_date,t.due_date,t.task_id,t.title,rule->>'mode',case when person.reward_enabled and coalesce(cfg.star_rewards_enabled,true) then (rule->>'stars')::int else 0 end,(rule->>'approval')::boolean,p_action='claim') returning * into s;
  end if;
  if p_action='claim' then
   if s.claimed then
    if not exists(select 1 from public.reward_occurrence_events where occurrence_id=s.id and action='claim') then insert into public.reward_occurrence_events(household_id,person_id,occurrence_id,action,created_by) values(hid,pid,s.id,'claim',uid);end if;
    result=jsonb_build_object('occurrence_id',s.id); else raise exception 'Opgaven er ikke ledig'; end if;
  else
   if p_action='undo' and s.status in ('excused','cancelled') then raise exception 'Fritagelse eller aflysning skal ændres af en voksen' using errcode='42501';end if;
   desired=case p_action when 'complete' then case when s.requires_approval then 'pending' else 'completed' end when 'approve' then 'approved' when 'reject' then 'rejected' when 'excuse' then 'excused' else 'open' end;
   if p_action='approve' and s.status not in ('pending','approved') then raise exception 'Opgaven afventer ikke godkendelse'; end if;
   if p_action='complete' and s.status in ('excused','cancelled') then raise exception 'Opgaven er fritaget eller aflyst'; end if;
   if p_action='complete' and s.status in ('completed','approved') then desired=s.status; end if;
   if p_action='unexcuse' and s.status<>'excused' then raise exception 'Opgaven er ikke fritaget'; end if;
   if s.status<>desired then
    if s.awarded_delta>0 and desired not in ('approved','completed') then perform private.reward_reverse(s,'Tilbageført'); end if;
    if desired in ('completed','approved') and s.reward_mode='stars' and s.awarded_delta=0 and s.star_value>0 then
     insert into public.reward_star_ledger(household_id,person_id,delta,reason,source_type,source_id,idempotency_key,created_by)
      values(hid,pid,s.star_value,'Bonusopgave: '||s.title,'task_award',s.id,s.id::text||':'||(s.revision+1)::text||':award',uid) on conflict(idempotency_key) do nothing;
    end if;
    update public.task_reward_occurrences set status=desired,awarded_delta=case when desired in ('completed','approved') and reward_mode='stars' then star_value else 0 end,
     revision=revision+1,reason=left(coalesce(p_payload->>'reason',''),500),updated_at=now() where id=s.id returning * into s;
    insert into public.reward_occurrence_events(household_id,person_id,occurrence_id,action,reason,created_by) values(hid,pid,s.id,p_action,s.reason,uid);
   end if;
   result=jsonb_build_object('occurrence_id',s.id);
  end if;
 elsif p_action='config' then
  if pid is null then raise exception 'Person mangler'; end if;
  amount=(p_payload->>'monthly_allowance_minor')::int;
  if amount is null or amount not between 0 and 100000000 then raise exception 'Ugyldigt månedsbeløb'; end if;
  effective=case when cfg.person_id is null then today else today+1 end;
  select coalesce(jsonb_agg(h),'[]') into hist from jsonb_array_elements(coalesce(cfg.history,'[]')) h where h->>'from'<>effective::text;
  hist=hist||jsonb_build_array(jsonb_build_object('from',effective,'enabled',(p_payload->>'reward_enabled')::boolean,'allowance',(p_payload->>'allowance_enabled')::boolean,'amount',amount));
  insert into public.reward_person_config(person_id,household_id,allowance_enabled,monthly_allowance_minor,star_rewards_enabled,default_requires_approval,history)
   values(pid,hid,(p_payload->>'allowance_enabled')::boolean,amount,(p_payload->>'star_rewards_enabled')::boolean,(p_payload->>'default_requires_approval')::boolean,hist)
   on conflict(person_id) do update set allowance_enabled=excluded.allowance_enabled,monthly_allowance_minor=excluded.monthly_allowance_minor,star_rewards_enabled=excluded.star_rewards_enabled,
    default_requires_approval=excluded.default_requires_approval,history=excluded.history,updated_at=now();
  update public.household_people set reward_enabled=(p_payload->>'reward_enabled')::boolean where id=pid;
  insert into public.reward_allowance_periods(household_id,person_id,month_start,allowance_minor) values(hid,pid,date_trunc('month',today)::date,amount) on conflict do nothing;
 elsif p_action='catalog' then
  rid=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  if exists(select 1 from public.reward_catalog where id=rid and household_id<>hid) then raise exception 'Household access denied' using errcode='42501'; end if;
  insert into public.reward_catalog(id,household_id,title,description,emoji,star_cost,active,sort_order,created_by)
   values(rid,hid,btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),coalesce(nullif(p_payload->>'emoji',''),'⭐'),(p_payload->>'star_cost')::int,coalesce((p_payload->>'active')::boolean,true),coalesce((p_payload->>'sort_order')::int,0),uid)
   on conflict(id) do update set title=excluded.title,description=excluded.description,emoji=excluded.emoji,star_cost=excluded.star_cost,active=excluded.active,sort_order=excluded.sort_order,updated_at=now();
  if p_payload->>'active'='false' then delete from public.reward_goals where household_id=hid and reward_id=rid; end if;
  result=jsonb_build_object('id',rid);
 elsif p_action in ('goal','redeem') then
  if pid is null or not person.is_active or not person.reward_enabled or not coalesce(cfg.star_rewards_enabled,true) then raise exception 'Vælg en person med bonusstjerner'; end if;
  select * into catalog from public.reward_catalog where id=(p_payload->>'reward_id')::uuid and household_id=hid and active;
  if not found then raise exception 'Belønningen er ikke tilgængelig'; end if;
  if p_action='goal' then
   insert into public.reward_goals(household_id,person_id,reward_id) values(hid,pid,catalog.id) on conflict(person_id) do update set reward_id=excluded.reward_id,updated_at=now();
  else
   select coalesce(sum(delta),0) into balance from public.reward_star_ledger where household_id=hid and person_id=pid;
   if balance<catalog.star_cost then raise exception 'Mangler % ⭐',catalog.star_cost-balance; end if;
   if exists(select 1 from public.reward_redemptions where household_id=hid and person_id=pid and reward_id=catalog.id and status='pending') then raise exception 'Belønningen afventer allerede godkendelse'; end if;
   insert into public.reward_redemptions(household_id,person_id,reward_id,title,emoji,star_cost,created_by) values(hid,pid,catalog.id,catalog.title,catalog.emoji,catalog.star_cost,uid) returning id into rid;
   result=jsonb_build_object('id',rid);
  end if;
 elsif p_action in ('redemption_approve','redemption_cancel','redemption_fulfill') then
  select * into redemption from public.reward_redemptions where id=(p_payload->>'id')::uuid and household_id=hid for update;
  if not found then raise exception 'Indløsningen findes ikke'; end if;
  if p_action='redemption_approve' then
   if redemption.status not in ('pending','approved','fulfilled') then raise exception 'Indløsningen er annulleret'; end if;
   if redemption.status='pending' then
    select coalesce(sum(delta),0) into balance from public.reward_star_ledger where household_id=hid and person_id=redemption.person_id;
    if balance<redemption.star_cost then raise exception 'Der er ikke stjerner nok længere'; end if;
    insert into public.reward_star_ledger(household_id,person_id,delta,reason,source_type,source_id,idempotency_key,created_by)
     values(hid,redemption.person_id,-redemption.star_cost,'Belønning: '||redemption.title,'redemption',redemption.id,redemption.id::text||':redeem',uid) on conflict(idempotency_key) do nothing;
    update public.reward_redemptions set status='approved',approved_by=uid,updated_at=now() where id=redemption.id;
   end if;
  elsif p_action='redemption_cancel' then
   if redemption.status not in ('pending','cancelled') then raise exception 'En godkendt belønning kan markeres gennemført'; end if;
   update public.reward_redemptions set status='cancelled',updated_at=now() where id=redemption.id;
  else
   if redemption.status not in ('approved','fulfilled') then raise exception 'Godkend belønningen først'; end if;
   update public.reward_redemptions set status='fulfilled',updated_at=now() where id=redemption.id;
  end if;
 elsif p_action='payout' then
  update public.allowance_monthly_snapshots set payout_status='paid',paid_at=coalesce(paid_at,now()),paid_by=coalesce(paid_by,uid)
   where id=(p_payload->>'id')::uuid and household_id=hid;
  if not found then raise exception 'Måneden er ikke afsluttet'; end if;
 else raise exception 'Ukendt belønningshandling';end if;
 result=result||jsonb_build_object('already_applied',false,'celebrations','[]'::jsonb);
 insert into public.reward_requests(id,household_id,user_id,action,payload,result) values(p_request_id,hid,uid,p_action,p_payload,result);
 return result||jsonb_build_object('rewards',private.reward_state(hid));
end $$;
create or replace function private.sync_calendar_mutation(
 p_mutation_id uuid,p_household_id uuid,p_expected jsonb,p_upserts jsonb,p_delete_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); receipt public.calendar_mutation_receipts; versions jsonb;
begin
 if uid is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501'; end if;
 if p_mutation_id is null then raise exception 'Mutation ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
 select * into receipt from public.calendar_mutation_receipts where id=p_mutation_id;
 if found then
   if receipt.household_id<>p_household_id or receipt.user_id<>uid then raise exception 'Mutation access denied' using errcode='42501'; end if;
   return jsonb_build_object('already_applied',true,'row_versions',receipt.row_versions,'celebrations','[]'::jsonb);
 end if;
 -- Rewards 2.1: ordinary tasks only persist their completion, with no weekly reward side effects.
 perform public.mutate_calendar(p_household_id,p_expected,p_upserts,p_delete_ids);

 select coalesce(jsonb_object_agg(i.id,i.updated_at),'{}') into versions from public.calendar_items i
 where i.household_id=p_household_id and i.id in(select (e->>'id')::uuid from jsonb_array_elements(p_upserts) e);
 insert into public.calendar_mutation_receipts(id,household_id,user_id,row_versions) values(p_mutation_id,p_household_id,uid,versions);
 return jsonb_build_object('already_applied',false,'row_versions',versions,'celebrations','[]'::jsonb);
end $$;
create or replace function private.export_family_data(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('format_version',1,'exported_at',now(),
 'household',(select jsonb_build_object('id',id,'name',name,'created_at',created_at) from public.households where id=p_household_id),
 'people',coalesce((select jsonb_agg(to_jsonb(p)-'avatar_url') from public.household_people p where household_id=p_household_id),'[]'),
 'calendar_and_tasks',coalesce((select jsonb_agg(to_jsonb(i)-'data'||jsonb_build_object('data',
  (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(i.data) where key=any(array['title','date','time','person','people','personIds','type','note','done','location','durationMin','repeatWeekly','repeatYearly','repeatUntil','birthYear','seriesId','overrideOf','overrideBaseId','exceptions','weekdays','originalDate','previousSeriesId','emoji','taskEmoji','rewardMode','starValue','requiresApproval','bonusPool','rewardOriginId','rewardRules']))))
  from public.calendar_items i where household_id=p_household_id),'[]'),
 'reward_state',coalesce((select jsonb_agg(to_jsonb(r)) from public.reward_celebrations r where household_id=p_household_id),'[]'),
 'monthly_milestones',coalesce((select jsonb_agg(to_jsonb(m)) from public.reward_monthly_milestones m where household_id=p_household_id),'[]'),
 'rewards_v2',private.reward_state(p_household_id)||jsonb_build_object(
 'ledger',coalesce((select jsonb_agg(to_jsonb(l)) from public.reward_star_ledger l where household_id=p_household_id),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.reward_occurrence_events e where household_id=p_household_id),'[]')),
 'feed_metadata',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',source,'name',name,'assigned_person_id',assigned_person_id,'assigned_person_name',assigned_person_name,'is_active',is_active,'last_sync_at',last_sync_at,'last_sync_status',last_sync_status)) from public.calendar_feeds where household_id=p_household_id),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.list_household_members(p_household_id) m),'[]'));
end $$;
notify pgrst,'reload schema';
commit;
