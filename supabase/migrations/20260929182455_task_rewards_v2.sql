-- Tasks & Rewards 2.0. Additive structures; no existing task/completion data is rewritten.
begin;
create table if not exists public.reward_person_config (
 person_id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
 allowance_enabled boolean not null default false, monthly_allowance_minor integer not null default 10000 check(monthly_allowance_minor between 0 and 100000000),
 star_rewards_enabled boolean not null default true, weekly_celebration_enabled boolean not null default true, default_requires_approval boolean not null default false,
 history jsonb not null default '[]' check(jsonb_typeof(history)='array'), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create table if not exists public.reward_allowance_periods (
 household_id uuid not null references public.households(id) on delete cascade, person_id uuid not null, month_start date not null check(extract(day from month_start)=1),
 allowance_minor integer not null check(allowance_minor>=0), primary key(household_id,person_id,month_start),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create table if not exists public.task_reward_occurrences (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,person_id uuid not null,
 origin_id uuid not null, occurrence_date date not null, due_date date not null, task_id uuid not null, title text not null,
 reward_mode text not null check(reward_mode in ('none','allowance','stars')),star_value integer not null default 0 check(star_value between 0 and 100000),requires_approval boolean not null,
 status text not null default 'open' check(status in ('open','pending','completed','approved','rejected','excused','cancelled')),
 awarded_delta integer not null default 0 check(awarded_delta>=0),revision integer not null default 0,
 reason text not null default '',claimed boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(household_id,origin_id,occurrence_date,person_id),foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create unique index if not exists one_bonus_claim on public.task_reward_occurrences(household_id,origin_id,occurrence_date) where claimed;
create table if not exists public.reward_star_ledger (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,person_id uuid not null,
 delta integer not null check(delta<>0),reason text not null,source_type text not null,source_id uuid not null,idempotency_key text not null unique,
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create table if not exists public.reward_occurrence_events (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,person_id uuid not null,
 occurrence_id uuid not null references public.task_reward_occurrences(id) on delete cascade,action text not null,reason text not null default '',
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create table if not exists public.reward_catalog (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,title text not null check(length(btrim(title)) between 1 and 120),
 description text not null default '' check(length(description)<=1000),emoji text not null default '⭐' check(length(emoji)<=16),star_cost integer not null check(star_cost between 1 and 1000000),
 active boolean not null default true,sort_order integer not null default 0,created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(household_id,id)
);
create table if not exists public.reward_goals (
 household_id uuid not null references public.households(id) on delete cascade,person_id uuid primary key,reward_id uuid not null,updated_at timestamptz not null default now(),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade,
 foreign key(household_id,reward_id) references public.reward_catalog(household_id,id) on delete cascade
);
create table if not exists public.reward_redemptions (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,person_id uuid not null,reward_id uuid not null,
 title text not null,emoji text not null,star_cost integer not null check(star_cost>0),status text not null default 'pending' check(status in ('pending','approved','cancelled','fulfilled')),
 created_by uuid references auth.users(id) on delete set null,approved_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade,
 foreign key(household_id,reward_id) references public.reward_catalog(household_id,id)
);
create unique index if not exists reward_one_pending_request on public.reward_redemptions(household_id,person_id,reward_id) where status='pending';
create table if not exists public.allowance_monthly_snapshots (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id) on delete cascade,person_id uuid not null,
 year integer not null,month integer not null check(month between 1 and 12),eligible_total integer not null,completed_total integer not null,excused_total integer not null,
 completion_percent numeric(6,2) not null,allowance_minor integer not null,earned_minor integer not null,finalized_at timestamptz not null default now(),
 payout_status text not null default 'pending' check(payout_status in ('pending','paid')),paid_at timestamptz,paid_by uuid references auth.users(id) on delete set null,
 unique(household_id,person_id,year,month),foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create table if not exists public.reward_requests (
 id uuid primary key,household_id uuid not null references public.households(id) on delete cascade,user_id uuid references auth.users(id) on delete set null,
 action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create or replace function private.is_reward_adult(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.household_members where household_id=hid and user_id=auth.uid() and role in ('owner','admin','adult'));
$$;
revoke all on function private.is_reward_adult(uuid) from public,anon;
grant execute on function private.is_reward_adult(uuid) to authenticated,service_role;
-- Every new table is read-only to clients; validated RPCs perform all state transitions.
do $$ declare t text; begin
 foreach t in array array['reward_person_config','reward_allowance_periods','task_reward_occurrences','reward_star_ledger','reward_occurrence_events','reward_catalog','reward_goals','reward_redemptions','allowance_monthly_snapshots','reward_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists rewards_member_read on public.%I',t);
  execute format('create policy rewards_member_read on public.%I for select to authenticated using(private.is_household_member(household_id))',t);
  execute format('create index if not exists %I on public.%I(household_id)',t||'_household_idx',t);
 end loop;
end $$;
create index if not exists reward_ledger_person_time on public.reward_star_ledger(household_id,person_id,created_at desc);
create index if not exists reward_occurrence_due on public.task_reward_occurrences(household_id,due_date,person_id);
create index if not exists reward_catalog_creator on public.reward_catalog(created_by);
create index if not exists reward_ledger_creator on public.reward_star_ledger(created_by);
create index if not exists reward_event_creator on public.reward_occurrence_events(created_by);
create index if not exists reward_request_user on public.reward_requests(user_id);
create index if not exists reward_redemption_catalog on public.reward_redemptions(household_id,reward_id);
create index if not exists reward_redemption_creator on public.reward_redemptions(created_by);
create index if not exists reward_redemption_approver on public.reward_redemptions(approved_by);
create index if not exists reward_goal_catalog on public.reward_goals(household_id,reward_id);
create index if not exists reward_snapshot_payer on public.allowance_monthly_snapshots(paid_by);

-- Server date is fixed to the existing Danish civil-calendar convention.
create or replace function private.reward_today() returns date language sql stable set search_path='' as $$select (now() at time zone 'Europe/Copenhagen')::date$$;
create or replace function private.task_reward_rule(d jsonb,day date) returns jsonb language sql immutable set search_path='' as $$
 select coalesce((select r from jsonb_array_elements(coalesce(d->'rewardRules','[]')) r where (r->>'from')::date<=day order by r->>'from' desc limit 1),'{"mode":"none","stars":0,"approval":false,"pool":false}'::jsonb);
$$;
-- Materialize the same weekly bases, exceptions and moved overrides as the calendar.
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
 from occurrences;
$$;
create or replace function private.reward_config_on(pid uuid,day date) returns jsonb language sql stable set search_path='' as $$
 select coalesce((select h from public.reward_person_config c cross join lateral jsonb_array_elements(c.history) h where c.person_id=pid and (h->>'from')::date<=day order by h->>'from' desc limit 1),'{"enabled":false,"allowance":false,"amount":0}'::jsonb);
$$;
create or replace function private.allowance_month(hid uuid,pid uuid,month_day date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare start_day date:=date_trunc('month',month_day)::date;end_day date:=(start_day+interval '1 month'-interval '1 day')::date;total integer;completed integer;excused integer;amount integer;person public.household_people;
begin
 select * into person from public.household_people where id=pid and household_id=hid;
 if not found then raise exception 'Personen findes ikke'; end if;
 select count(*) filter(where coalesce(s.status,'open') not in ('excused','cancelled')),
  count(*) filter(where s.status in ('completed','approved')),
  count(*) filter(where s.status='excused') into total,completed,excused
 from private.reward_task_instances(hid,start_day,end_day) t
 left join public.task_reward_occurrences s on s.household_id=hid and s.person_id=pid and s.origin_id=t.origin_id and s.occurrence_date=t.occurrence_date
 where coalesce(s.reward_mode,t.rule->>'mode')='allowance'
 and coalesce((private.reward_config_on(pid,t.due_date)->>'enabled')::boolean,false)
 and coalesce((private.reward_config_on(pid,t.due_date)->>'allowance')::boolean,false)
 and private.task_assigned_to(t.person_ids,t.people,pid,person.name,person.name_aliases);
 select allowance_minor into amount from public.reward_allowance_periods where household_id=hid and person_id=pid and month_start=start_day;
 if amount is null then select coalesce((private.reward_config_on(pid,end_day)->>'amount')::integer,0) into amount; end if;
 return jsonb_build_object('person_id',pid,'year',extract(year from start_day)::int,'month',extract(month from start_day)::int,'eligible_total',total,'completed_total',completed,'excused_total',excused,
 'completion_percent',case when total>0 then round(completed::numeric*100/total,2) else 0 end,'allowance_minor',amount,'earned_minor',case when total>0 then round(amount::numeric*completed/total)::int else 0 end);
end $$;
create or replace function private.finalize_reward_months(hid uuid) returns void language plpgsql security definer set search_path='' as $$
declare c record;day date;v jsonb;current_month date:=date_trunc('month',private.reward_today())::date;
begin
 for c in select person_id,date_trunc('month',created_at at time zone 'Europe/Copenhagen')::date as start_day from public.reward_person_config where household_id=hid loop
  for day in select g::date from generate_series(c.start_day::timestamp,(current_month-1)::timestamp,interval '1 month') g loop
   if exists(select 1 from public.allowance_monthly_snapshots where household_id=hid and person_id=c.person_id and year=extract(year from day) and month=extract(month from day)) then continue; end if;
   v=private.allowance_month(hid,c.person_id,day);
   insert into public.allowance_monthly_snapshots(household_id,person_id,year,month,eligible_total,completed_total,excused_total,completion_percent,allowance_minor,earned_minor)
    values(hid,c.person_id,(v->>'year')::int,(v->>'month')::int,(v->>'eligible_total')::int,(v->>'completed_total')::int,(v->>'excused_total')::int,(v->>'completion_percent')::numeric,(v->>'allowance_minor')::int,(v->>'earned_minor')::int) on conflict do nothing;
  end loop;
 end loop;
end $$;

-- Task rules are versioned from the edit date; old dates retain their prior rule.
create or replace function private.guard_task_rewards() returns trigger language plpgsql security definer set search_path='' as $$
declare hid uuid:=coalesce(new.household_id,old.household_id);desired jsonb;prior jsonb;rules jsonb;origin uuid;parent public.calendar_items;effective date;managed boolean;
begin
 if not exists(select 1 from public.households where id=hid) then return coalesce(new,old); end if;
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 perform private.finalize_reward_months(hid);
 if tg_op in ('UPDATE','DELETE') and old.type='Opgave' and auth.uid() is not null and not private.is_reward_adult(hid)
 and (coalesce(old.data->>'rewardMode','none')<>'none' or coalesce((old.data->>'requiresApproval')::boolean,false)
 or exists(select 1 from jsonb_array_elements(coalesce(old.data->'rewardRules','[]')) r where r->>'mode'<>'none' or coalesce((r->>'approval')::boolean,false))) then
  raise exception 'Kun voksne kan redigere eller slette belønningsopgaver' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.type<>'Opgave' then return new; end if;
 desired=jsonb_build_object('mode',coalesce(nullif(new.data->>'rewardMode',''),'none'),'stars',coalesce(nullif(new.data->>'starValue','')::int,0),
 'approval',coalesce((new.data->>'requiresApproval')::boolean,false),'pool',coalesce((new.data->>'bonusPool')::boolean,false));
 if desired->>'mode' not in ('none','allowance','stars') or (desired->>'stars')::int not between 0 and 100000 or (desired->>'mode'='stars' and (desired->>'stars')::int<1)
 or ((desired->>'pool')::boolean and desired->>'mode'<>'stars') then raise exception 'Ugyldig belønning'; end if;
 prior=case when tg_op='UPDATE' then jsonb_build_object('mode',coalesce(old.data->>'rewardMode','none'),'stars',coalesce((old.data->>'starValue')::int,0),'approval',coalesce((old.data->>'requiresApproval')::boolean,false),'pool',coalesce((old.data->>'bonusPool')::boolean,false)) else '{"mode":"none","stars":0,"approval":false,"pool":false}'::jsonb end;
 if desired<>prior and auth.uid() is not null and not private.is_reward_adult(hid) then raise exception 'Kun voksne kan ændre opgavebelønninger' using errcode='42501'; end if;
 managed=desired->>'mode'<>'none' or (desired->>'approval')::boolean or prior->>'mode'<>'none' or (prior->>'approval')::boolean;
 if managed and new.done and new.date>=private.reward_today() and (tg_op='INSERT' or old.done is distinct from new.done) then raise exception 'Markér belønningsopgaven udført for den enkelte person'; end if;
 if tg_op='UPDATE' and not managed and not old.data ? 'rewardRules' and not new.data ? 'rewardMode' and not new.data ?| array['rewardRules','rewardOriginId','overrideBaseId','overrideOf'] then return new; end if;
 if tg_op='INSERT' and not managed and not new.data ? 'rewardMode' and not new.data ?| array['rewardRules','rewardOriginId','overrideBaseId','overrideOf'] then return new; end if;
 if tg_op='INSERT' then
  select * into parent from public.calendar_items where household_id=hid and (id::text=new.data->>'overrideBaseId' or coalesce(nullif(data->>'seriesId',''),id::text)=coalesce(nullif(new.data->>'overrideOf',''),nullif(new.data->>'previousSeriesId',''))) limit 1;
  if parent.id is not null and auth.uid() is not null and not private.is_reward_adult(hid) and exists(select 1 from jsonb_array_elements(coalesce(parent.data->'rewardRules','[]')) r where r->>'mode'<>'none' or coalesce((r->>'approval')::boolean,false)) then raise exception 'Kun voksne kan tilpasse belønningsserier' using errcode='42501';end if;
  origin=coalesce(nullif(parent.data->>'rewardOriginId','')::uuid,parent.id,new.id);
  rules=coalesce(parent.data->'rewardRules','[]');
 else origin=coalesce(nullif(old.data->>'rewardOriginId','')::uuid,old.id);rules=coalesce(old.data->'rewardRules','[]');end if;
 if tg_op='UPDATE' and old.date<>new.date and coalesce(old.data->>'repeatWeekly','false')<>'true' and nullif(old.data->>'overrideOf','') is null then new.data=new.data||jsonb_build_object('originalDate',coalesce(nullif(old.data->>'originalDate',''),old.date::text));end if;
 effective=greatest(new.date,private.reward_today());
 if exists(select 1 from public.task_reward_occurrences s where s.household_id=hid and s.origin_id=origin and s.due_date=effective) then effective=effective+1;end if;
 if (tg_op='UPDATE' and old.done) or (tg_op='INSERT' and new.done) then effective=greatest(effective,new.date+1);end if;
 if desired<>private.task_reward_rule(jsonb_build_object('rewardRules',rules),effective)-'from' then
  select coalesce(jsonb_agg(r),'[]') into rules from jsonb_array_elements(rules) r where r->>'from'<>effective::text;
  rules=rules||jsonb_build_array(desired||jsonb_build_object('from',effective));
 end if;
 new.data=new.data||jsonb_build_object('rewardRules',rules,'rewardOriginId',origin);
 return new;
end $$;
drop trigger if exists task_rewards_guard on public.calendar_items;
create trigger task_rewards_guard before insert or update or delete on public.calendar_items for each row execute function private.guard_task_rewards();

create or replace function private.reward_reverse(s public.task_reward_occurrences,why text) returns void language plpgsql security definer set search_path='' as $$
begin
 if s.awarded_delta>0 then
  insert into public.reward_star_ledger(household_id,person_id,delta,reason,source_type,source_id,idempotency_key,created_by)
  values(s.household_id,s.person_id,-s.awarded_delta,why||': '||s.title,'task_reversal',s.id,s.id::text||':'||(s.revision+1)::text||':reverse',auth.uid()) on conflict(idempotency_key) do nothing;
 end if;
end $$;
-- Deferred until the complete calendar batch exists: base/exception/override writes cannot cancel each other halfway through.
create or replace function private.reconcile_reward_tasks() returns trigger language plpgsql security definer set search_path='' as $$
declare hid uuid:=coalesce(new.household_id,old.household_id);s public.task_reward_occurrences;t record;new_due date;begin
 if not exists(select 1 from public.households where id=hid) then return null; end if;
 for s in select * from public.task_reward_occurrences where household_id=hid and status<>'cancelled' loop
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
drop trigger if exists reconcile_reward_tasks on public.calendar_items;
create constraint trigger reconcile_reward_tasks after insert or update or delete on public.calendar_items deferrable initially deferred for each row execute function private.reconcile_reward_tasks();
create or replace function private.guard_person_reward_config() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.reward_person_config; effective date:=private.reward_today()+1; hist jsonb;
begin
 if not exists(select 1 from public.households where id=old.household_id) then return coalesce(new,old); end if;
 perform pg_advisory_xact_lock(hashtextextended(old.household_id::text,0));perform private.finalize_reward_months(old.household_id);
 if tg_op='DELETE' then
  if exists(select 1 from public.task_reward_occurrences where person_id=old.id) or exists(select 1 from public.allowance_monthly_snapshots where person_id=old.id) then raise exception 'Arkivér personen for at bevare belønningshistorikken'; end if;return old;
 end if;
 if (new.reward_enabled is distinct from old.reward_enabled or new.is_active is distinct from old.is_active) and auth.uid() is not null and not private.is_reward_adult(old.household_id) then raise exception 'Kun voksne kan ændre belønningsindstillinger' using errcode='42501'; end if;
 if new.reward_enabled is distinct from old.reward_enabled or new.is_active is distinct from old.is_active then
  select * into cfg from public.reward_person_config where person_id=old.id;
  if found then
   select coalesce(jsonb_agg(h),'[]') into hist from jsonb_array_elements(cfg.history) h where h->>'from'<>effective::text;
   hist=hist||jsonb_build_array(jsonb_build_object('from',effective,'enabled',new.reward_enabled and new.is_active,'allowance',cfg.allowance_enabled,'amount',cfg.monthly_allowance_minor));
   update public.reward_person_config set history=hist,updated_at=now() where person_id=old.id;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists person_reward_config_guard on public.household_people;
create trigger person_reward_config_guard before update or delete on public.household_people for each row execute function private.guard_person_reward_config();
create or replace function private.bump_reward_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare hid uuid:=coalesce(new.household_id,old.household_id);begin
 if exists(select 1 from public.households where id=hid) then
  insert into public.calendar_revisions(household_id,items_version) values(hid,1) on conflict(household_id) do update set items_version=calendar_revisions.items_version+1;
 end if;return null;end $$;
do $$ declare t text;begin
 foreach t in array array['reward_person_config','task_reward_occurrences','reward_star_ledger','reward_catalog','reward_goals','reward_redemptions','allowance_monthly_snapshots'] loop
  execute format('drop trigger if exists rewards_revision on public.%I',t);
  execute format('create trigger rewards_revision after insert or update or delete on public.%I for each row execute function private.bump_reward_revision()',t);
 end loop;
end $$;
create or replace function private.reward_state(hid uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'configs',coalesce((select jsonb_agg(to_jsonb(c)) from public.reward_person_config c where household_id=hid),'[]'),
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
create or replace function private.get_reward_state(p_household_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
 perform private.finalize_reward_months(p_household_id);
 insert into public.reward_allowance_periods(household_id,person_id,month_start,allowance_minor)
 select p_household_id,c.person_id,date_trunc('month',private.reward_today())::date,c.monthly_allowance_minor from public.reward_person_config c where household_id=p_household_id on conflict do nothing;
 return private.reward_state(p_household_id);
end $$;
create or replace function public.get_reward_state(p_household_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_reward_state(p_household_id);$$;

create or replace function private.reward_action(p_request_id uuid,p_household_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid:=p_household_id;uid uuid:=auth.uid();pid uuid:=nullif(p_payload->>'person_id','')::uuid;today date:=private.reward_today();
 person public.household_people;cfg public.reward_person_config;s public.task_reward_occurrences;t record;catalog public.reward_catalog;redemption public.reward_redemptions;receipt public.reward_requests;
 is_adult boolean;rule jsonb;desired text;result jsonb:='{}';claims jsonb:='[]';claim public.reward_celebrations;before_count int;after_count int;boundary int;week_start date;balance bigint;amount int;hist jsonb;effective date;rid uuid;
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
   week_start=date_trunc('week',s.due_date)::date;
   select count(*) into before_count from private.completed_task_rows(hid,week_start,least(week_start+6,today)) x where private.task_assigned_to(x.person_ids,x.people,pid,person.name,person.name_aliases);
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
   if desired in ('completed','approved') and person.reward_enabled and coalesce(cfg.weekly_celebration_enabled,true) then
    select count(*) into after_count from private.completed_task_rows(hid,week_start,least(week_start+6,today)) x where private.task_assigned_to(x.person_ids,x.people,pid,person.name,person.name_aliases);
    foreach boundary in array array[7,9,12] loop
     if before_count<boundary and after_count>=boundary then
      insert into public.reward_celebrations(household_id,person_id,iso_year,iso_week,threshold,completed_count,tasks)
       values(hid,pid,extract(isoyear from week_start)::int,extract(week from week_start)::int,boundary,after_count,
       (select coalesce(jsonb_agg(v.title),'[]') from (select x.title from private.completed_task_rows(hid,week_start,least(week_start+6,today)) x where private.task_assigned_to(x.person_ids,x.people,pid,person.name,person.name_aliases) order by x.date desc limit 6) v))
       on conflict(household_id,person_id,iso_year,iso_week,threshold) do nothing returning * into claim;
      if found then claims=claims||jsonb_build_array(to_jsonb(claim)); end if;
     end if;
    end loop;
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
  insert into public.reward_person_config(person_id,household_id,allowance_enabled,monthly_allowance_minor,star_rewards_enabled,weekly_celebration_enabled,default_requires_approval,history)
   values(pid,hid,(p_payload->>'allowance_enabled')::boolean,amount,(p_payload->>'star_rewards_enabled')::boolean,(p_payload->>'weekly_celebration_enabled')::boolean,(p_payload->>'default_requires_approval')::boolean,hist)
   on conflict(person_id) do update set allowance_enabled=excluded.allowance_enabled,monthly_allowance_minor=excluded.monthly_allowance_minor,star_rewards_enabled=excluded.star_rewards_enabled,
    weekly_celebration_enabled=excluded.weekly_celebration_enabled,default_requires_approval=excluded.default_requires_approval,history=excluded.history,updated_at=now();
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
 result=result||jsonb_build_object('already_applied',false,'celebrations',claims);
 insert into public.reward_requests(id,household_id,user_id,action,payload,result) values(p_request_id,hid,uid,p_action,p_payload,result);
 return result||jsonb_build_object('rewards',private.reward_state(hid));
end $$;
create or replace function public.reward_action(p_request_id uuid,p_household_id uuid,p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.reward_action(p_request_id,p_household_id,p_action,p_payload);$$;

create or replace function private.completed_task_rows_legacy(hid uuid,week_start date,through_date date)
returns table(id uuid,occurrence_key text,title text,date date,person_ids uuid[],people jsonb)
language sql stable security invoker set search_path='' as $$
 with candidates as (
 select i.*, coalesce(nullif(i.data->>'overrideBaseId',''),nullif(i.data->>'overrideOf',''),i.id::text)||'|'||
   coalesce(nullif(i.data->>'originalDate',''),i.date::text) as occurrence_key
 from public.calendar_items i
 where i.household_id=hid and i.type='Opgave' and i.done and private.task_reward_rule(i.data,i.date)->>'mode'='none' and not (private.task_reward_rule(i.data,i.date)->>'approval')::boolean and i.date between week_start and through_date
 and (
   nullif(i.data->>'overrideOf','') is not null
   or (
    not coalesce(i.data->'exceptions' ? i.date::text,false)
    and not coalesce((jsonb_typeof(i.data->'exceptions')='string' and i.date::text=any(string_to_array(replace(i.data->>'exceptions',';',','),','))),false)
    and (coalesce(i.data->>'repeatWeekly','false')<>'true' or coalesce(nullif(i.data->>'repeatUntil',''),'9999-12-31')>=i.date::text)
    and not exists(select 1 from public.calendar_items o where o.household_id=hid and
      (o.data->>'overrideBaseId'=i.id::text or o.data->>'overrideOf'=coalesce(nullif(i.data->>'seriesId',''),i.id::text))
      and coalesce(nullif(o.data->>'originalDate',''),o.date::text)=i.date::text)
   )
 )
 )
 select distinct on (c.occurrence_key) c.id,c.occurrence_key,c.title,c.date,c.person_ids,
   case when jsonb_typeof(c.data->'people')='array' and jsonb_array_length(c.data->'people')>0 then c.data->'people'
     else jsonb_build_array(coalesce(nullif(c.person,''),'Alle')) end
 from candidates c order by c.occurrence_key,c.updated_at desc,c.id;
$$;
create or replace function private.completed_task_rows(hid uuid,week_start date,through_date date)
returns table(id uuid,occurrence_key text,title text,date date,person_ids uuid[],people jsonb)
language sql stable security invoker set search_path='' as $$
 select * from private.completed_task_rows_legacy(hid,week_start,through_date)
 union all
 select s.id,s.origin_id::text||'|'||s.occurrence_date::text,s.title,s.due_date,array[s.person_id],jsonb_build_array(p.name)
 from public.task_reward_occurrences s join public.household_people p on p.id=s.person_id
 where s.household_id=hid and s.status in ('completed','approved') and s.due_date between week_start and through_date;
$$;

create or replace function private.sync_calendar_mutation(
 p_mutation_id uuid,p_household_id uuid,p_expected jsonb,p_upserts jsonb,p_delete_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); receipt public.calendar_mutation_receipts; original_done jsonb; before_counts jsonb:='[]';
 week_start date; local_today date:=(now() at time zone 'Europe/Copenhagen')::date;
 person record; prior record; after_count integer; boundary integer; celebration public.reward_celebrations;
 celebrations jsonb:='[]'; versions jsonb; new_completion boolean; task_list jsonb; mutation_key text;
begin
 if uid is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501'; end if;
 if p_mutation_id is null then raise exception 'Mutation ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
 select * into receipt from public.calendar_mutation_receipts where id=p_mutation_id;
 if found then
   if receipt.household_id<>p_household_id or receipt.user_id<>uid then raise exception 'Mutation access denied' using errcode='42501'; end if;
   return jsonb_build_object('already_applied',true,'row_versions',receipt.row_versions,'celebrations','[]'::jsonb);
 end if;
 -- Compute before/after only for weeks with possible new completions. No load-time claims.
 for week_start in select distinct date_trunc('week',(e->>'date')::date)::date
   from jsonb_array_elements(p_upserts) e
   where e->>'type'='Opgave' and e->>'done'='true' and (e->>'date')::date<=local_today
 loop
   select coalesce(jsonb_agg(to_jsonb(t)),'[]') into original_done from private.completed_task_rows(p_household_id,week_start,least(week_start+6,local_today)) t;
   new_completion=false;
   for person in select e from jsonb_array_elements(p_upserts) e
     where e->>'type'='Opgave' and e->>'done'='true' and (e->>'date')::date between week_start and least(week_start+6,local_today)
   loop
     mutation_key=coalesce(nullif(person.e->'data'->>'overrideBaseId',''),nullif(person.e->'data'->>'overrideOf',''),person.e->>'id')||'|'||
       coalesce(nullif(person.e->'data'->>'originalDate',''),person.e->>'date');
     if not exists(select 1 from jsonb_array_elements(original_done) x where x->>'occurrence_key'=mutation_key)
       and not exists(select 1 from public.calendar_items old where old.id=(person.e->>'id')::uuid and old.household_id=p_household_id and old.type='Opgave' and old.done)
     then new_completion=true; end if;
   end loop;
   if not new_completion then continue; end if;
   for person in select * from public.household_people where household_id=p_household_id and reward_enabled and coalesce((select c.weekly_celebration_enabled from public.reward_person_config c where c.person_id=household_people.id),true) loop
     select count(*) into after_count from private.completed_task_rows(p_household_id,week_start,least(week_start+6,local_today)) t
       where private.task_assigned_to(t.person_ids,t.people,person.id,person.name,person.name_aliases);
     before_counts=before_counts||jsonb_build_array(jsonb_build_object('person',person.id,'week',week_start,'count',after_count));
   end loop;
 end loop;
 -- Existing tenant and row validation is preserved. The definer entry point explicitly
 -- checks auth/membership above; mutate_calendar additionally validates every row tenant.
 perform public.mutate_calendar(p_household_id,p_expected,p_upserts,p_delete_ids);
 for prior in select * from jsonb_to_recordset(before_counts) as x(person uuid,week date,count integer) loop
   select * into person from public.household_people where id=prior.person and household_id=p_household_id and reward_enabled and coalesce((select c.weekly_celebration_enabled from public.reward_person_config c where c.person_id=household_people.id),true);
   if not found then continue; end if;
   select count(*) into after_count from private.completed_task_rows(p_household_id,prior.week,least(prior.week+6,local_today)) t
     where private.task_assigned_to(t.person_ids,t.people,person.id,person.name,person.name_aliases);
   select coalesce(jsonb_agg(x.title),'[]') into task_list from (
     select t.title from private.completed_task_rows(p_household_id,prior.week,least(prior.week+6,local_today)) t
     where private.task_assigned_to(t.person_ids,t.people,person.id,person.name,person.name_aliases) order by t.date desc,t.id limit 6
   ) x;
   foreach boundary in array array[7,9,12] loop
     if prior.count<boundary and after_count>=boundary then
       insert into public.reward_celebrations(household_id,person_id,iso_year,iso_week,threshold,completed_count,tasks)
       values(p_household_id,person.id,extract(isoyear from prior.week)::int,extract(week from prior.week)::int,boundary,after_count,task_list)
       on conflict(household_id,person_id,iso_year,iso_week,threshold) do nothing returning * into celebration;
       if found then celebrations=celebrations||jsonb_build_array(to_jsonb(celebration)); end if;
     end if;
   end loop;
 end loop;
 select coalesce(jsonb_object_agg(i.id,i.updated_at),'{}') into versions from public.calendar_items i
 where i.household_id=p_household_id and i.id in(select (e->>'id')::uuid from jsonb_array_elements(p_upserts) e);
 insert into public.calendar_mutation_receipts(id,household_id,user_id,row_versions) values(p_mutation_id,p_household_id,uid,versions);
 return jsonb_build_object('already_applied',false,'row_versions',versions,'celebrations',celebrations);
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
 'rewards_v2',private.reward_state(p_household_id)||jsonb_build_object(
 'ledger',coalesce((select jsonb_agg(to_jsonb(l)) from public.reward_star_ledger l where household_id=p_household_id),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.reward_occurrence_events e where household_id=p_household_id),'[]')),
 'feed_metadata',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',source,'name',name,'assigned_person_id',assigned_person_id,'assigned_person_name',assigned_person_name,'is_active',is_active,'last_sync_at',last_sync_at,'last_sync_status',last_sync_status)) from public.calendar_feeds where household_id=p_household_id),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.list_household_members(p_household_id) m),'[]'));
end $$;
-- Internal definers cannot be invoked through an accidental PUBLIC execute grant.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array[
 'reward_today','task_reward_rule','reward_task_instances','reward_config_on','allowance_month','finalize_reward_months','guard_task_rewards','reward_reverse','reconcile_reward_tasks','guard_person_reward_config','bump_reward_revision','reward_state','get_reward_state','reward_action','completed_task_rows_legacy']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function private.task_reward_rule(jsonb,date),private.completed_task_rows_legacy(uuid,date,date) to authenticated,service_role;
revoke all on function public.get_reward_state(uuid),public.reward_action(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.get_reward_state(uuid),private.get_reward_state(uuid),public.reward_action(uuid,uuid,text,jsonb),private.reward_action(uuid,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
