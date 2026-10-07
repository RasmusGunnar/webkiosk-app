-- Product Batch 4.0: immutable allowance contracts; existing task states and star ledger remain.
begin;
create table public.allowance_agreements (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 person_id uuid not null, effective_from date not null, cadence text not null check(cadence in ('month','week')),
 amount_minor integer not null check(amount_minor between 0 and 100000000), duties jsonb not null default '[]' check(jsonb_typeof(duties)='array' and jsonb_array_length(duties)<=30),
 legacy_task_ids uuid[] not null default '{}', paused boolean not null default false, needs_review boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(),
 unique(household_id,person_id,effective_from), unique(household_id,person_id,id),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
-- Legacy monthly tables have month-only keys. Keep their history intact, including payouts.
create table public.allowance_contracts (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade, person_id uuid not null,
 agreement_id uuid, period_start date not null, period_end date not null check(period_end>=period_start),
 cadence text not null check(cadence in ('month','week')), allowance_minor integer not null check(allowance_minor between 0 and 100000000),
 rules jsonb not null, closed_at timestamptz, final_totals jsonb, manual_earned_minor integer check(manual_earned_minor between 0 and 100000000),
 payout_status text not null default 'pending' check(payout_status in ('pending','paid')), paid_at timestamptz, paid_by uuid references auth.users(id) on delete set null,
 milestone_shown_at timestamptz, created_at timestamptz not null default now(),
 unique(household_id,person_id,period_start),unique(household_id,person_id,id),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade,
 foreign key(household_id,person_id,agreement_id) references public.allowance_agreements(household_id,person_id,id)
);
alter table public.task_reward_occurrences add column allowance_contract_id uuid;
alter table public.task_reward_occurrences add column window_end date;
alter table public.task_reward_occurrences add column obligation_rule jsonb;
alter table public.task_reward_occurrences add constraint allowance_occurrence_contract foreign key(household_id,person_id,allowance_contract_id) references public.allowance_contracts(household_id,person_id,id) on delete cascade;
alter table public.task_reward_occurrences add constraint allowance_no_stars check(allowance_contract_id is null or (reward_mode='allowance' and star_value=0 and awarded_delta=0 and window_end>=due_date));
create index allowance_occurrence_period on public.task_reward_occurrences(allowance_contract_id) where allowance_contract_id is not null;
create index allowance_agreement_current on public.allowance_agreements(household_id,person_id,effective_from desc);
create index allowance_contract_agreement on public.allowance_contracts(agreement_id);
create index allowance_contract_paid_by on public.allowance_contracts(paid_by);
do $$ declare t text;begin foreach t in array array['allowance_agreements','allowance_contracts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy household_read on public.%I for select to authenticated using(private.is_household_member(household_id))',t);
 execute format('create trigger rewards_revision after insert or update or delete on public.%I for each row execute function private.bump_reward_revision()',t);
end loop;end $$;

create function private.allowance_period_end(day date,cadence text) returns date language sql immutable set search_path='' as $$
 select case cadence when 'week' then day+(7-extract(isodow from day)::int) else (date_trunc('month',day)+interval '1 month - 1 day')::date end;
$$;
-- Calendar-style civil dates, without timezone/DST arithmetic. A weekly window produces ONE obligation.
create function private.allowance_expected(first_day date,last_day date,duties jsonb)
returns table(duty_index integer,day date,window_end date,rule jsonb) language sql immutable set search_path='' as $$
 select (d.ordinality-1)::int,g::date,
 case when d.value->>'schedule'='weekly' then least(last_day,private.allowance_period_end(g::date,'week')) else g::date end,d.value
 from jsonb_array_elements(duties) with ordinality d cross join lateral generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') g
 where d.value->>'schedule'='daily'
 or (d.value->>'schedule'='weekdays' and extract(isodow from g)<=5)
 or (d.value->>'schedule'='selected' and d.value->'weekdays' @> to_jsonb(extract(isodow from g)::int))
 or (d.value->>'schedule'='weekly' and (g::date=first_day or extract(isodow from g)=1));
$$;
create function private.allowance_totals(cid uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'person_id',c.person_id,'period_start',c.period_start,'period_end',c.period_end,'cadence',c.cadence,
 'year',extract(year from c.period_start)::int,'month',extract(month from c.period_start)::int,'allowance_minor',c.allowance_minor,
 'eligible_total',n.eligible,'completed_total',n.completed,'excused_total',n.excused,'expected_total',n.expected,
 'completion_percent',case when n.eligible>0 then round(n.completed::numeric*100/n.eligible,2) else 0 end,
 'earned_minor',case when n.eligible>0 then ((c.allowance_minor::bigint*n.completed*2+n.eligible)/(n.eligible*2))::int when n.expected>0 then c.manual_earned_minor else 0 end,
 'neutral',case when n.expected=0 then 'empty' when n.eligible=0 then 'all_excused' else null end,
 'closed_at',c.closed_at,'payout_status',c.payout_status)
 from public.allowance_contracts c cross join lateral (
 select count(*)::int expected,count(*) filter(where status<>'excused')::int eligible,
 count(*) filter(where status in ('approved','completed'))::int completed,count(*) filter(where status='excused')::int excused
 from public.task_reward_occurrences where allowance_contract_id=c.id
 ) n where c.id=cid;
$$;
create function private.ensure_allowance_periods(hid uuid) returns void language plpgsql security definer set search_path='' as $$
declare p record;a public.allowance_agreements;c public.allowance_contracts;start_day date;last_day date;today date=private.reward_today();x record;origin uuid;origins jsonb;totals jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 for p in select * from public.household_people where household_id=hid and is_active and reward_enabled loop
  select max(period_end)+1 into start_day from public.allowance_contracts where household_id=hid and person_id=p.id;
  if start_day is null then select min(effective_from) into start_day from public.allowance_agreements where household_id=hid and person_id=p.id and not needs_review;end if;
  while start_day is not null and start_day<=today loop
   select * into a from public.allowance_agreements where household_id=hid and person_id=p.id and not needs_review and effective_from<=start_day order by effective_from desc limit 1;
   if not found or a.paused then
    select min(effective_from) into start_day from public.allowance_agreements where household_id=hid and person_id=p.id and not needs_review and not paused and effective_from>start_day;
    continue;
   end if;
   last_day=private.allowance_period_end(start_day,a.cadence);
   insert into public.allowance_contracts(household_id,person_id,agreement_id,period_start,period_end,cadence,allowance_minor,rules)
    values(hid,p.id,a.id,start_day,last_day,a.cadence,a.amount_minor,a.duties) returning * into c;
   origins='{}';
   for x in select * from private.allowance_expected(start_day,last_day,a.duties) loop
    origin=(origins->>x.duty_index::text)::uuid;
    if origin is null then origin=gen_random_uuid();origins=origins||jsonb_build_object(x.duty_index::text,origin);end if;
    insert into public.task_reward_occurrences(household_id,person_id,origin_id,task_id,occurrence_date,due_date,title,reward_mode,star_value,requires_approval,allowance_contract_id,window_end,obligation_rule)
    values(hid,p.id,origin,gen_random_uuid(),x.day,x.day,x.rule->>'title','allowance',0,coalesce((x.rule->>'approval')::boolean,false),c.id,x.window_end,x.rule);
   end loop;
   start_day=last_day+1;
  end loop;
 end loop;
 for c in select * from public.allowance_contracts where household_id=hid and period_end<today and closed_at is null loop
  totals=private.allowance_totals(c.id);
  update public.allowance_contracts set closed_at=clock_timestamp(),final_totals=totals where id=c.id;
 end loop;
end $$;
create function private.allowance_action(hid uuid,action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid=(payload->>'person_id')::uuid;a public.allowance_agreements;c public.allowance_contracts;d jsonb;effective date;cadence text;amount int;today date=private.reward_today();
begin
 if auth.uid() is null or not private.is_reward_adult(hid) then raise exception 'Kun voksne kan ændre lommepengeaftalen' using errcode='42501';end if;
 if action='allowance_save' then
  if not exists(select 1 from public.household_people where household_id=hid and id=pid and is_active) then raise exception 'Vælg en aktiv person';end if;
  cadence=payload->>'cadence';amount=(payload->>'amount_minor')::int;
  if cadence not in ('month','week') or cadence is null or amount is null or amount not between 0 and 100000000
   or jsonb_typeof(payload->'duties') is distinct from 'array' or jsonb_array_length(payload->'duties')>30 then raise exception 'Ugyldig aftale';end if;
  for d in select value from jsonb_array_elements(payload->'duties') loop
   if jsonb_typeof(d) is distinct from 'object' or length(btrim(coalesce(d->>'title',''))) not between 1 and 160
    or coalesce(d->>'schedule','') not in ('daily','weekdays','selected','weekly') or jsonb_typeof(d->'approval') is distinct from 'boolean' then raise exception 'Ugyldig fast pligt';end if;
   if d->>'schedule'='selected' and (jsonb_typeof(d->'weekdays') is distinct from 'array' or jsonb_array_length(d->'weekdays') not between 1 and 7
    or exists(select 1 from jsonb_array_elements(d->'weekdays') v where v::text not in ('1','2','3','4','5','6','7'))) then raise exception 'Vælg gyldige ugedage';end if;
  end loop;
  select * into a from public.allowance_agreements where household_id=hid and person_id=pid order by effective_from desc limit 1;
  if a.id is not null and payload->>'expected' is distinct from a.updated_at::text then raise exception 'Aftalen er ændret på en anden enhed. Åbn den igen.';end if;
  select * into c from public.allowance_contracts where household_id=hid and person_id=pid and period_end>=today order by period_start desc limit 1;
  effective=case when c.id is not null then c.period_end+1 when a.id is not null and not a.needs_review and a.effective_from>today then a.effective_from
   when a.id is null or a.needs_review then case when payload->>'start_today'='true' then today else private.allowance_period_end(today,cadence)+1 end
   else private.allowance_period_end(today,a.cadence)+1 end;
  insert into public.allowance_agreements(household_id,person_id,effective_from,cadence,amount_minor,duties,paused,legacy_task_ids)
  values(hid,pid,effective,cadence,amount,payload->'duties',coalesce((payload->>'paused')::boolean,false),coalesce(a.legacy_task_ids,'{}'))
  on conflict(household_id,person_id,effective_from) do update set cadence=excluded.cadence,amount_minor=excluded.amount_minor,duties=excluded.duties,paused=excluded.paused,needs_review=false,updated_at=clock_timestamp();
  insert into public.reward_person_config(person_id,household_id,allowance_enabled,monthly_allowance_minor) values(pid,hid,true,amount)
   on conflict(person_id) do update set allowance_enabled=true;
  update public.household_people set reward_enabled=true where id=pid and not reward_enabled;
  perform private.ensure_allowance_periods(hid);
  return jsonb_build_object('effective_from',effective);
 elsif action in ('allowance_payout','allowance_resolve') then
  select * into c from public.allowance_contracts where id=(payload->>'id')::uuid and household_id=hid for update;
  if not found or c.closed_at is null then raise exception 'Perioden er ikke afsluttet';end if;
  if action='allowance_resolve' then
   amount=(payload->>'amount_minor')::int;
   if c.payout_status='paid' or c.final_totals->>'neutral' is distinct from 'all_excused' or amount is null or amount not between 0 and c.allowance_minor then raise exception 'Ugyldigt aftalt beløb';end if;
   update public.allowance_contracts set manual_earned_minor=amount,final_totals=final_totals||jsonb_build_object('earned_minor',amount) where id=c.id;
  else
   if c.final_totals->>'earned_minor' is null then raise exception 'Aftal først beløbet for den fritagne periode';end if;
   update public.allowance_contracts set payout_status='paid',paid_at=coalesce(paid_at,now()),paid_by=coalesce(paid_by,auth.uid()) where id=c.id;
  end if;
  return jsonb_build_object('id',c.id);
 end if;
 raise exception 'Ukendt aftalehandling';
end $$;

-- Preserve the immutable identity/rules, even when a legacy calendar template is edited.
create function private.guard_allowance_occurrence() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.households where id=old.household_id) then return coalesce(new,old);end if;
 if old.allowance_contract_id is not null and exists(select 1 from public.allowance_contracts where id=old.allowance_contract_id) then
  if tg_op='DELETE' then raise exception 'Lommepengepligter skal fritages, ikke slettes';end if;
  if (to_jsonb(new)-array['status','reason','revision','updated_at']) is distinct from (to_jsonb(old)-array['status','reason','revision','updated_at']) then raise exception 'Periodens pligt er fastlåst';end if;
  if new.status='cancelled' then raise exception 'Brug Fritag';end if;
  if exists(select 1 from public.allowance_contracts where id=old.allowance_contract_id and (closed_at is not null or period_end<private.reward_today())) then raise exception 'Perioden er afsluttet og låst';end if;
 end if;return coalesce(new,old);
end $$;
create trigger allowance_occurrence_guard before update or delete on public.task_reward_occurrences for each row execute function private.guard_allowance_occurrence();

-- Freeze existing current-month expectations once; retain every historical payout/ledger row.
do $$ declare cfg public.reward_person_config;p public.household_people;c public.allowance_contracts;t record;rules jsonb;start_day date=date_trunc('month',private.reward_today())::date;end_day date;begin
 for cfg in select * from public.reward_person_config where allowance_enabled loop
  perform private.finalize_reward_months(cfg.household_id);
  select * into p from public.household_people where id=cfg.person_id;
  end_day=private.allowance_period_end(start_day,'month');
  -- Only explicit one-person, unmodified weekly templates can be suggested safely.
  select coalesce(jsonb_agg(jsonb_build_object('legacy_task_id',i.id,'title',i.title,'schedule','selected','weekdays',jsonb_build_array(extract(isodow from i.date)::int),'approval',coalesce((i.data->>'requiresApproval')::boolean,false))),'[]') into rules
  from public.calendar_items i where i.household_id=cfg.household_id and i.type='Opgave' and i.person_ids=array[p.id]
   and i.data->>'rewardMode'='allowance' and i.data->>'repeatWeekly'='true'
   and not i.data ?| array['overrideOf','repeatUntil','exceptions'];
  if jsonb_array_length(rules)>30 then rules='[]';end if;
  insert into public.allowance_agreements(household_id,person_id,effective_from,cadence,amount_minor,duties,needs_review,legacy_task_ids)
   values(cfg.household_id,p.id,end_day+1,'month',cfg.monthly_allowance_minor,rules,true,array(select (r->>'legacy_task_id')::uuid from jsonb_array_elements(rules) r));
  insert into public.allowance_contracts(household_id,person_id,period_start,period_end,cadence,allowance_minor,rules)
   values(cfg.household_id,p.id,start_day,end_day,'month',coalesce((select allowance_minor from public.reward_allowance_periods where household_id=cfg.household_id and person_id=p.id and month_start=start_day),cfg.monthly_allowance_minor),jsonb_build_object('legacy_snapshot',true)) returning * into c;
  for t in select x.* from private.reward_task_instances(cfg.household_id,start_day,end_day) x
   where x.rule->>'mode'='allowance' and private.task_assigned_to(x.person_ids,x.people,p.id,p.name,p.name_aliases)
   and coalesce((private.reward_config_on(p.id,x.due_date)->>'allowance')::boolean,false)
   and coalesce((private.reward_config_on(p.id,x.due_date)->>'enabled')::boolean,false)
   and not exists(select 1 from public.task_reward_occurrences o where o.household_id=cfg.household_id and o.person_id=p.id and o.origin_id=x.origin_id and o.occurrence_date=x.occurrence_date and o.status='cancelled')
  loop
   insert into public.task_reward_occurrences(household_id,person_id,origin_id,task_id,occurrence_date,due_date,title,reward_mode,star_value,requires_approval,allowance_contract_id,window_end,obligation_rule)
   values(cfg.household_id,p.id,t.origin_id,t.task_id,t.occurrence_date,t.due_date,t.title,'allowance',0,(t.rule->>'approval')::boolean,c.id,t.due_date,t.rule)
   on conflict(household_id,origin_id,occurrence_date,person_id) do update set allowance_contract_id=c.id,window_end=excluded.window_end,obligation_rule=excluded.obligation_rule,star_value=0;
  end loop;
 end loop;
end $$;

create or replace function private.reward_task_instances(hid uuid,first_day date,last_day date)
returns table(task_id uuid,origin_id uuid,occurrence_date date,due_date date,title text,person_ids uuid[],people jsonb,rule jsonb,legacy_done boolean)
language sql stable security invoker set search_path='' as $$
 with rows as (select i.*,
  coalesce(nullif(i.data->>'rewardOriginId','')::uuid,nullif(i.data->>'overrideBaseId','')::uuid,i.id) as origin,
  nullif(i.data->>'overrideOf','') is not null as is_override,
  coalesce(i.data->>'repeatWeekly','false')='true' and nullif(i.data->>'overrideOf','') is null and coalesce(i.source,'') not in ('aula','google','ics') as repeats
  from public.calendar_items i where i.household_id=hid and i.type='Opgave'),
 occurrences as (
  select r.*,g::date as day from rows r cross join lateral generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') g
  where r.repeats and g::date>=r.date and extract(dow from g)=extract(dow from r.date)
   and g::date<=coalesce(nullif(r.data->>'repeatUntil','')::date,'9999-12-31'::date)
   and not coalesce(r.data->'exceptions' ? g::date::text,false)
   and not coalesce((jsonb_typeof(r.data->'exceptions')='string' and g::date::text=any(string_to_array(replace(r.data->>'exceptions',';',','),','))),false)
   and not exists(select 1 from rows o where o.is_override and (o.data->>'overrideBaseId'=r.id::text or o.data->>'overrideOf'=coalesce(nullif(r.data->>'seriesId',''),r.id::text)) and coalesce(nullif(o.data->>'originalDate','')::date,o.date)=g::date)
  union all select r.*,r.date from rows r where not r.repeats and r.date between first_day and last_day
   and (r.is_override or (not coalesce(r.data->'exceptions' ? r.date::text,false) and not coalesce((jsonb_typeof(r.data->'exceptions')='string' and r.date::text=any(string_to_array(replace(r.data->>'exceptions',';',','),','))),false)))
 )
 select id,origin,coalesce(nullif(data->>'originalDate','')::date,day),day,title,person_ids,
  case when jsonb_typeof(data->'people')='array' then data->'people' else jsonb_build_array(coalesce(nullif(person,''),'Alle')) end,
  private.task_reward_rule(data,day),done and day=date
 from occurrences where not exists(select 1 from public.task_reward_occurrences s where s.household_id=hid and s.allowance_contract_id is not null and s.task_id=occurrences.id and s.occurrence_date=coalesce(nullif(occurrences.data->>'originalDate','')::date,occurrences.day))
 union all
 select s.task_id,s.origin_id,s.occurrence_date,s.due_date,s.title,array[s.person_id],jsonb_build_array(p.name),jsonb_build_object('mode','allowance','stars',0,'approval',s.requires_approval,'pool',false),false
 from public.task_reward_occurrences s join public.household_people p on p.id=s.person_id
 where s.household_id=hid and s.allowance_contract_id is not null and s.due_date between first_day and last_day;
$$;

create or replace function private.reconcile_reward_tasks() returns trigger language plpgsql security definer set search_path='' as $$
declare hid uuid:=coalesce(new.household_id,old.household_id);s public.task_reward_occurrences;t record;new_due date;begin
 if not exists(select 1 from public.households where id=hid) then return null; end if;
 for s in select * from public.task_reward_occurrences where household_id=hid and status<>'cancelled' and allowance_contract_id is null loop
  select i.date into new_due from public.calendar_items i where i.household_id=hid and i.data->>'rewardOriginId'=s.origin_id::text and i.data->>'originalDate'=s.occurrence_date::text and (nullif(i.data->>'overrideOf','') is not null or i.id=s.task_id) limit 1;
  new_due=coalesce(new_due,s.due_date);
  select * into t from private.reward_task_instances(hid,new_due,new_due) where origin_id=s.origin_id and occurrence_date=s.occurrence_date limit 1;
  if found then
   if s.task_id<>t.task_id or s.due_date<>t.due_date or s.title<>t.title then update public.task_reward_occurrences set task_id=t.task_id,due_date=t.due_date,title=t.title,updated_at=now() where id=s.id;end if;
  elsif s.status not in ('completed','approved') then
   perform private.reward_reverse(s,'Opgaven blev fjernet eller flyttet');
   update public.task_reward_occurrences set status='cancelled',awarded_delta=0,revision=revision+1,updated_at=now() where id=s.id;
   insert into public.reward_occurrence_events(household_id,person_id,occurrence_id,action,reason,created_by) values(hid,s.person_id,s.id,'cancelled','Opgaven blev fjernet eller flyttet',auth.uid());
  end if;
 end loop;return null;
end $$;

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
 'agreements',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('expected',a.updated_at::text) order by a.effective_from desc) from public.allowance_agreements a where household_id=hid),'[]'),
'contracts',coalesce((select jsonb_agg((coalesce(c.final_totals,private.allowance_totals(c.id)))||jsonb_build_object('closed_at',c.closed_at,'payout_status',c.payout_status) order by c.period_start desc) from public.allowance_contracts c where household_id=hid),'[]'),
'monthly',coalesce((select jsonb_agg(private.allowance_totals(c.id)) from public.allowance_contracts c where household_id=hid and private.reward_today() between c.period_start and c.period_end),'[]'));
$$;

create or replace function private.finalize_reward_months(hid uuid) returns void language plpgsql security definer set search_path='' as $$begin perform private.ensure_allowance_periods(hid);end $$;

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
 if p_action in ('allowance_save','allowance_payout','allowance_resolve') then
  result=private.allowance_action(hid,p_action,p_payload);
 elsif p_action in ('complete','undo','approve','reject','excuse','unexcuse','claim') then
  if pid is null or not person.is_active then raise exception 'Vælg en aktiv person'; end if;
  select * into t from private.reward_task_instances(hid,(p_payload->>'due_date')::date,(p_payload->>'due_date')::date)
   where task_id=(p_payload->>'item_id')::uuid and occurrence_date=(p_payload->>'occurrence_date')::date and (cardinality(person_ids)=0 or pid=any(person_ids)) limit 1;
  if not found then raise exception 'Opgaven findes ikke længere på denne dato'; end if;
  if exists(select 1 from public.task_reward_occurrences o join public.allowance_contracts c on c.id=o.allowance_contract_id where o.household_id=hid and o.person_id=pid and o.task_id=t.task_id and o.occurrence_date=t.occurrence_date and (c.closed_at is not null or c.period_end<today)) then raise exception 'Perioden er afsluttet og låst';end if;
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

create or replace function private.claim_reward_milestone(p_household_id uuid,p_person_id uuid,p_month_start date)
returns boolean language plpgsql security definer set search_path='' as $$
declare m jsonb; inserted_count integer;
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
 select private.allowance_totals(c.id) into m from public.allowance_contracts c where c.household_id=p_household_id and c.person_id=p_person_id and c.period_start=p_month_start and private.reward_today() between c.period_start and c.period_end;
 if m is null or (m->>'eligible_total')::int=0 or (m->>'completed_total')::int<>(m->>'eligible_total')::int then return false;end if;
 update public.allowance_contracts set milestone_shown_at=now() where id=(m->>'id')::uuid and milestone_shown_at is null;
 get diagnostics inserted_count=row_count;return inserted_count=1;
end $$;
do $$ declare r record;begin for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('allowance_period_end','allowance_expected','allowance_totals','ensure_allowance_periods','allowance_action','guard_allowance_occurrence') loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);end loop;end $$;
notify pgrst,'reload schema';
commit;
