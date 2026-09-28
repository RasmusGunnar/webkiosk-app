-- Additive: no existing calendar rows are rewritten.
begin;

-- Publish only household revision counters, not private event/feed payloads.
-- A counter also handles DELETE reliably across Realtime server versions.
create table if not exists public.calendar_revisions (
  household_id uuid primary key references public.households(id) on delete cascade,
  items_version bigint not null default 0,
  people_version bigint not null default 0,
  feeds_version bigint not null default 0
);
alter table public.calendar_revisions enable row level security;
revoke all on public.calendar_revisions from public,anon,authenticated;
grant select on public.calendar_revisions to authenticated;
grant all on public.calendar_revisions to service_role;
drop policy if exists calendar_revisions_select on public.calendar_revisions;
create policy calendar_revisions_select on public.calendar_revisions for select to authenticated
  using(private.is_household_member(household_id));

create or replace function private.bump_calendar_revision()
returns trigger language plpgsql security definer set search_path='' as $$
declare hid uuid := coalesce(new.household_id,old.household_id);
begin
  -- Called only by these owned-table triggers, including the service-role importer.
  -- Skip household cascades; do not recreate a revision row during household deletion.
  if not exists(select 1 from public.households where id=hid) then return null; end if;
  insert into public.calendar_revisions(household_id,items_version,people_version,feeds_version)
  values(hid,(tg_table_name='calendar_items')::int,(tg_table_name='household_people')::int,(tg_table_name='calendar_feeds')::int)
  on conflict(household_id) do update set
    items_version=calendar_revisions.items_version+excluded.items_version,
    people_version=calendar_revisions.people_version+excluded.people_version,
    feeds_version=calendar_revisions.feeds_version+excluded.feeds_version;
  return null;
end $$;
revoke all on function private.bump_calendar_revision() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['calendar_items','household_people','calendar_feeds'] loop
    execute format('drop trigger if exists calendar_revision on public.%I',t);
    execute format('create trigger calendar_revision after insert or update or delete on public.%I for each row execute function private.bump_calendar_revision()',t);
  end loop;
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='calendar_revisions') then
    alter publication supabase_realtime add table public.calendar_revisions;
  end if;
end $$;

-- One transaction for base+exceptions+overrides and Mon-Fri creation.
-- Invoker security retains the existing calendar RLS, grants and validation triggers.
-- Expected row versions reject edits made from stale open editors.
create or replace function public.mutate_calendar(
  p_household_id uuid, p_expected jsonb, p_upserts jsonb, p_delete_ids uuid[]
) returns void language plpgsql security invoker set search_path='' as $$
declare entry jsonb; current_row public.calendar_items; rid uuid; seen uuid[] := '{}';
begin
  if auth.uid() is null or not private.is_household_member(p_household_id) then
    raise exception 'Household access denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'array' or jsonb_typeof(p_upserts) is distinct from 'array'
    or p_delete_ids is null or jsonb_array_length(p_expected)>2000 or jsonb_array_length(p_upserts)>2000 or cardinality(p_delete_ids)>2000 then
    raise exception 'Invalid calendar batch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,0));
  for entry in select value from jsonb_array_elements(p_expected) loop
    select * into current_row from public.calendar_items where id=(entry->>'id')::uuid and household_id=p_household_id for update;
    if not found or current_row.updated_at is distinct from (entry->>'updated_at')::timestamptz then
      raise exception 'Kalenderen er ændret på en anden enhed. Luk og åbn aftalen igen.';
    end if;
  end loop;
  foreach rid in array p_delete_ids loop
    if not exists(select 1 from jsonb_array_elements(p_expected) e where (e->>'id')::uuid=rid) then raise exception 'Expected version required'; end if;
    delete from public.calendar_items where id=rid and household_id=p_household_id;
    if not found then raise exception 'Calendar item missing'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_upserts) loop
    rid=(entry->>'id')::uuid;
    if rid is null or rid=any(seen) or rid=any(p_delete_ids) or length(btrim(coalesce(entry->>'title',''))) not between 1 and 1000
      or jsonb_typeof(entry->'data') is distinct from 'object' then raise exception 'Invalid calendar item'; end if;
    seen=array_append(seen,rid);
    if exists(select 1 from jsonb_array_elements(p_expected) e where (e->>'id')::uuid=rid) then
      update public.calendar_items set
        title=entry->>'title',date=(entry->>'date')::date,time=entry->>'time',person=entry->>'person',
        person_ids=array(select jsonb_array_elements_text(entry->'person_ids'))::uuid[],type=entry->>'type',
        note=entry->>'note',done=(entry->>'done')::boolean,location=entry->>'location',
        duration_min=(entry->>'duration_min')::integer,data=entry->'data'
        where id=rid and household_id=p_household_id;
      if not found then raise exception 'Calendar item missing'; end if;
    else
      insert into public.calendar_items(id,household_id,created_by,title,date,time,person,person_ids,type,note,done,location,duration_min,data)
      values(rid,p_household_id,auth.uid(),entry->>'title',(entry->>'date')::date,entry->>'time',entry->>'person',
        array(select jsonb_array_elements_text(entry->'person_ids'))::uuid[],entry->>'type',entry->>'note',
        (entry->>'done')::boolean,entry->>'location',(entry->>'duration_min')::integer,entry->'data');
    end if;
  end loop;
end $$;
revoke all on function public.mutate_calendar(uuid,jsonb,jsonb,uuid[]) from public,anon;
grant execute on function public.mutate_calendar(uuid,jsonb,jsonb,uuid[]) to authenticated;
commit;
