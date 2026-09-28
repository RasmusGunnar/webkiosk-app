-- Mega 3: additive reward metadata, immutable celebration claims and idempotent mutation receipts.
begin;
alter table public.household_people add column if not exists reward_enabled boolean;
update public.household_people set reward_enabled=(role='child') where reward_enabled is null;
create or replace function private.default_person_rewards()
returns trigger language plpgsql set search_path='' as $$
begin if new.reward_enabled is null then new.reward_enabled=(new.role='child'); end if; return new; end $$;
revoke all on function private.default_person_rewards() from public,anon,authenticated;
drop trigger if exists default_person_rewards on public.household_people;
create trigger default_person_rewards before insert on public.household_people for each row execute function private.default_person_rewards();
alter table public.household_people alter column reward_enabled set not null;

create table if not exists public.reward_celebrations (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 person_id uuid not null,
 iso_year integer not null,
 iso_week integer not null check(iso_week between 1 and 53),
 threshold integer not null check(threshold in (7,9,12)),
 completed_count integer not null,
 tasks jsonb not null default '[]',
 created_at timestamptz not null default now(),
 unique(household_id,person_id,iso_year,iso_week,threshold),
 foreign key(household_id,person_id) references public.household_people(household_id,id) on delete cascade
);
create table if not exists public.calendar_mutation_receipts (
 id uuid primary key,
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 row_versions jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists calendar_receipts_household on public.calendar_mutation_receipts(household_id);
create index if not exists calendar_receipts_user on public.calendar_mutation_receipts(user_id);
alter table public.reward_celebrations enable row level security;
alter table public.calendar_mutation_receipts enable row level security;
revoke all on public.reward_celebrations,public.calendar_mutation_receipts from public,anon,authenticated;
grant select on public.reward_celebrations,public.calendar_mutation_receipts to authenticated;
grant all on public.reward_celebrations,public.calendar_mutation_receipts to service_role;
drop policy if exists celebrations_select on public.reward_celebrations;
create policy celebrations_select on public.reward_celebrations for select to authenticated using(private.is_household_member(household_id));
drop policy if exists receipts_select on public.calendar_mutation_receipts;
create policy receipts_select on public.calendar_mutation_receipts for select to authenticated using(user_id=(select auth.uid()) and private.is_household_member(household_id));

-- Physical completed rows already represent weekly completion overrides. A legacy base done
-- belongs only to its first date; suppressed bases must not double-count their override.
create or replace function private.completed_task_rows(hid uuid,week_start date,through_date date)
returns table(id uuid,occurrence_key text,title text,date date,person_ids uuid[],people jsonb)
language sql stable security invoker set search_path='' as $$
 with candidates as (
 select i.*, coalesce(nullif(i.data->>'overrideBaseId',''),nullif(i.data->>'overrideOf',''),i.id::text)||'|'||
   coalesce(nullif(i.data->>'originalDate',''),i.date::text) as occurrence_key
 from public.calendar_items i
 where i.household_id=hid and i.type='Opgave' and i.done and i.date between week_start and through_date
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
revoke all on function private.completed_task_rows(uuid,date,date) from public,anon;
grant execute on function private.completed_task_rows(uuid,date,date) to authenticated,service_role;

create or replace function private.task_assigned_to(pids uuid[],names jsonb,pid uuid,pname text,aliases text[])
returns boolean language sql stable security invoker set search_path='' as $$
 select case when cardinality(pids)>0 then pid=any(pids)
 else exists(select 1 from jsonb_array_elements_text(names) n where lower(btrim(n))='alle'
   or ((lower(btrim(n))=lower(btrim(pname)) or exists(select 1 from unnest(aliases) a where lower(btrim(a))=lower(btrim(n))))
     and 1=(select count(*) from public.household_people candidate where candidate.household_id=(select household_id from public.household_people where id=pid)
       and (lower(btrim(candidate.name))=lower(btrim(n)) or exists(select 1 from unnest(candidate.name_aliases) a where lower(btrim(a))=lower(btrim(n))))))) end;
$$;
revoke all on function private.task_assigned_to(uuid[],jsonb,uuid,text,text[]) from public,anon;
grant execute on function private.task_assigned_to(uuid[],jsonb,uuid,text,text[]) to authenticated,service_role;

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
   for person in select * from public.household_people where household_id=p_household_id and reward_enabled loop
     select count(*) into after_count from private.completed_task_rows(p_household_id,week_start,least(week_start+6,local_today)) t
       where private.task_assigned_to(t.person_ids,t.people,person.id,person.name,person.name_aliases);
     before_counts=before_counts||jsonb_build_array(jsonb_build_object('person',person.id,'week',week_start,'count',after_count));
   end loop;
 end loop;
 -- Existing tenant and row validation is preserved. The definer entry point explicitly
 -- checks auth/membership above; mutate_calendar additionally validates every row tenant.
 perform public.mutate_calendar(p_household_id,p_expected,p_upserts,p_delete_ids);
 for prior in select * from jsonb_to_recordset(before_counts) as x(person uuid,week date,count integer) loop
   select * into person from public.household_people where id=prior.person and household_id=p_household_id and reward_enabled;
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
create or replace function public.sync_calendar_mutation(
 p_mutation_id uuid,p_household_id uuid,p_expected jsonb,p_upserts jsonb,p_delete_ids uuid[]
) returns jsonb language sql security invoker set search_path='' as $$
 select private.sync_calendar_mutation(p_mutation_id,p_household_id,p_expected,p_upserts,p_delete_ids);
$$;
revoke all on function private.sync_calendar_mutation(uuid,uuid,jsonb,jsonb,uuid[]),public.sync_calendar_mutation(uuid,uuid,jsonb,jsonb,uuid[]) from public,anon;
grant execute on function private.sync_calendar_mutation(uuid,uuid,jsonb,jsonb,uuid[]),public.sync_calendar_mutation(uuid,uuid,jsonb,jsonb,uuid[]) to authenticated;
commit;
