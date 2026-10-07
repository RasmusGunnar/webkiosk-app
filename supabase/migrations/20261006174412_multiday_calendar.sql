-- Additive interval columns; no existing calendar rows are rewritten.
-- date/time remain the start. All-day end_date is INCLUSIVE in application data.
begin;
alter table public.calendar_items
 add column end_date date,
 add column end_time time without time zone,
 add column all_day boolean;
comment on column public.calendar_items.end_date is 'Inclusive all-day end date; exact civil end date for timed events. NULL keeps legacy duration fallback.';
comment on column public.calendar_items.all_day is 'NULL means legacy inference from start time. New events store an explicit boolean.';

-- Keep the existing transactional/offline RPC wire format compatible. Typed
-- columns are authoritative; JSON carries these fields through older RPCs.
create function private.normalize_calendar_interval()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.end_date is null and new.data ? 'endDate' then new.end_date:=nullif(new.data->>'endDate','')::date; end if;
  if new.end_time is null and new.data ? 'endTime' then new.end_time:=nullif(new.data->>'endTime','')::time; end if;
  if new.all_day is null and jsonb_typeof(new.data->'allDay')='boolean' then new.all_day:=(new.data->>'allDay')::boolean; end if;
 else
  if new.end_date is not distinct from old.end_date and new.data->'endDate' is distinct from old.data->'endDate' then new.end_date:=nullif(new.data->>'endDate','')::date; end if;
  if new.end_time is not distinct from old.end_time and new.data->'endTime' is distinct from old.data->'endTime' then new.end_time:=nullif(new.data->>'endTime','')::time; end if;
  if new.all_day is not distinct from old.all_day and new.data->'allDay' is distinct from old.data->'allDay' then new.all_day:=nullif(new.data->>'allDay','')::boolean; end if;
 end if;
 if new.all_day is true then new.time:=''; new.end_time:=null; end if;
 if new.end_date<new.date or (new.all_day is not true and coalesce(new.end_date,new.date)=new.date and new.end_time<replace(nullif(new.time,''),'.',':')::time) then
  raise exception 'Invalid calendar interval: end precedes start' using errcode='22023';
 end if;
 if new.end_date is not null or new.all_day is not null then
  new.data:=coalesce(new.data,'{}')||jsonb_build_object('endDate',new.end_date,'endTime',case when new.end_time is null then null else to_char(new.end_time,'HH24:MI') end,'allDay',new.all_day);
 end if;
 return new;
end $$;
revoke all on function private.normalize_calendar_interval() from public,anon,authenticated;
create trigger normalize_calendar_interval before insert or update on public.calendar_items for each row execute function private.normalize_calendar_interval();

-- Inclusive civil date occupied by an interval, including legacy midnight/DST.
create function private.calendar_last_date(p_date date,p_time text,p_duration integer,p_end date,p_end_time time,p_all_day boolean)
returns date language plpgsql immutable set search_path='' as $$
declare finish timestamp; last_day date;
begin
 if p_end is not null then
  return greatest(p_date,case when p_all_day is not true and p_end_time='00:00'::time and p_end>p_date then p_end-1 else p_end end);
 end if;
 if p_all_day is true or nullif(p_time,'') is null then
  return p_date+greatest(0,ceil(coalesce(p_duration,0)/1440.0)::int-1);
 end if;
 finish:=(((p_date+replace(nullif(p_time,''),'.',':')::time) at time zone 'Europe/Copenhagen')+make_interval(mins=>greatest(0,coalesce(p_duration,0)))) at time zone 'Europe/Copenhagen';
 last_day:=finish::date;
 if finish::time='00:00'::time and last_day>p_date then last_day:=last_day-1; end if;
 return greatest(p_date,last_day);
end $$;
revoke all on function private.calendar_last_date(date,text,integer,date,time,boolean) from public,anon,authenticated;

create or replace function private.apply_calendar_feed_import_base(
 p_feed_id uuid,p_actor_id uuid,p_token uuid,p_rows jsonb,p_range_start date,p_range_end date,p_cleanup boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; row_data jsonb; payload jsonb; ek text; ids uuid[]; person_name text;
 inserted integer:=0; updated integer:=0; deleted integer:=0; skipped integer:=0;
 existing_id uuid; incoming text[]:='{}'; touched integer; effective_ids uuid[]; previous public.calendar_items;
begin
  select * into f from public.calendar_feeds where id=p_feed_id for update;
  if f.id is null or not exists(select 1 from public.household_members where household_id=f.household_id and user_id=p_actor_id and role in ('owner','admin')) then
    raise exception 'Feed unavailable' using errcode='42501';
  end if;
  if not f.is_active or f.import_token is distinct from p_token or p_token is null then raise exception 'Import is no longer current'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid import batch'; end if;
  if jsonb_array_length(p_rows)>10000 or p_range_start is null or p_range_end is null or p_range_end<p_range_start then
    raise exception 'Invalid import batch';
  end if;
  ids:='{}';
  person_name:=coalesce(nullif(f.assigned_person_name,''),'Alle');
  if f.assigned_person_id is not null then
    select name into person_name from public.household_people where id=f.assigned_person_id and household_id=f.household_id;
    ids:=array[f.assigned_person_id];
  else
    select array_agg(id) into effective_ids from public.household_people
      where household_id=f.household_id and (lower(name)=lower(person_name) or lower(person_name)=any(select lower(unnest(name_aliases))));
    if cardinality(effective_ids)=1 then ids:=effective_ids; end if;
  end if;
  for row_data in select value from jsonb_array_elements(p_rows) loop
    ek:=row_data->>'externalKey'; payload:=row_data->'payload';
    if ek is null or ek='' or jsonb_typeof(payload) is distinct from 'object' or payload->>'date' is null
      or (payload->>'date')::date>p_range_end
      or private.calendar_last_date((payload->>'date')::date,payload->>'time',(payload->'data'->>'durationMin')::int,nullif(payload->'data'->>'endDate','')::date,nullif(payload->'data'->>'endTime','')::time,nullif(payload->'data'->>'allDay','')::boolean)<p_range_start
      or (payload ? 'data' and jsonb_typeof(payload->'data') is distinct from 'object') then raise exception 'Invalid calendar row'; end if;
    if ek=any(incoming) then raise exception 'Duplicate external key'; end if;
    incoming:=array_append(incoming,ek);
    -- Preserve detached edits, including when the source title/time changes the old external key.
    if exists(select 1 from public.calendar_items c
      where c.household_id=f.household_id and c.source=f.source
      and coalesce(c.calendar_id,c.data->>'calendarId',c.data->>'feedId')=f.id::text
      and (c.detached_from_feed or c.data->>'detachedFromFeed'='true')
      and (c.external_id=ek or (c.data->>'uid'=payload->'data'->>'uid' and c.data->>'occurrenceDate'=payload->'data'->>'occurrenceDate'))
    ) then skipped:=skipped+1; continue; end if;
    select id into existing_id from public.calendar_items where household_id=f.household_id and source=f.source and external_id=ek;
    select * into previous from public.calendar_items where id=existing_id;
    if previous.id is not null and coalesce(previous.data->>'importSourceRemoved','false')<>'true'
     and previous.data->'importSource'=jsonb_build_object('title',coalesce(nullif(payload->>'title',''),'(uden titel)'),'location',payload->'data'->>'location','note',payload->>'note','type','Aktivitet','personIds',to_jsonb(ids),'person',person_name)
     and previous.date=(payload->>'date')::date and previous.time is not distinct from payload->>'time'
     and previous.duration_min is not distinct from (payload->'data'->>'durationMin')::integer
     and previous.end_date is not distinct from nullif(payload->'data'->>'endDate','')::date
     and previous.end_time is not distinct from nullif(payload->'data'->>'endTime','')::time
     and previous.all_day is not distinct from nullif(payload->'data'->>'allDay','')::boolean then
      skipped:=skipped+1;continue;
    end if;
    insert into public.calendar_items(household_id,title,date,time,person,person_ids,type,note,done,created_by,source,external_id,calendar_id,location,duration_min,data)
    values(f.household_id,coalesce(nullif(payload->>'title',''),'(uden titel)'),(payload->>'date')::date,payload->>'time',person_name,ids,
      'Aktivitet',payload->>'note',false,p_actor_id,f.source,ek,f.id::text,payload->'data'->>'location',(payload->'data'->>'durationMin')::integer,
      coalesce(payload->'data','{}'::jsonb) || jsonb_build_object('source',f.source,'feedId',f.id,'calendarId',f.id,'externalId',ek,'externalKey',ek,'person',person_name,'people',jsonb_build_array(person_name),'personIds',to_jsonb(ids),'importSourceRemoved',false))
    on conflict(household_id,source,external_id) do update set
      title=excluded.title,date=excluded.date,time=excluded.time,person=excluded.person,person_ids=excluded.person_ids,
      type=excluded.type,note=excluded.note,calendar_id=excluded.calendar_id,location=excluded.location,duration_min=excluded.duration_min,
      data=calendar_items.data || excluded.data || jsonb_build_object('done',calendar_items.done)
    where not calendar_items.detached_from_feed and coalesce(calendar_items.data->>'detachedFromFeed','false')<>'true';
    get diagnostics touched=row_count;
    if touched>0 then
     if existing_id is null then inserted:=inserted+1; else updated:=updated+1; end if;
     perform private.apply_import_override((select id from public.calendar_items where household_id=f.household_id and source=f.source and external_id=ek),true);
    end if;
  end loop;
  update public.calendar_items c set data=c.data||jsonb_build_object('importSourceRemoved',true) where p_cleanup is true and c.household_id=f.household_id and c.source=f.source
    and coalesce(c.calendar_id,c.data->>'calendarId',c.data->>'feedId')=f.id::text
    and not c.detached_from_feed and coalesce(c.data->>'detachedFromFeed','false')<>'true'
    and c.data ? 'recurrenceId' and nullif(c.data->>'uid','') is not null
    and c.date<=p_range_end and private.calendar_last_date(c.date,c.time,c.duration_min,c.end_date,c.end_time,c.all_day)>=p_range_start
    and coalesce(c.data->>'importSourceRemoved','false')<>'true'
    and not(coalesce(c.external_id,c.data->>'externalKey','')=any(incoming));
  get diagnostics deleted=row_count;
  update public.calendar_feeds set last_sync_at=now(),last_sync_status='success',
    last_sync_message=null,last_import_count=jsonb_array_length(p_rows),import_token=null,import_started_at=null
    where id=f.id;
  return jsonb_build_object('insertedCount',inserted,'updatedCount',updated,'deletedCount',0,'sourceRemovedCount',deleted,'skippedCount',skipped,'importedCount',jsonb_array_length(p_rows));
end $$;



notify pgrst,'reload schema';
commit;
