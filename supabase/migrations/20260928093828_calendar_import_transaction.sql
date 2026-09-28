-- Service-only, atomic feed imports. Caller identity is verified by Edge and rechecked here.
begin;
create or replace function public.begin_calendar_feed_import(p_feed_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds;
begin
  select * into f from public.calendar_feeds where id=p_feed_id for update;
  if f.id is null or not exists(select 1 from public.household_members where household_id=f.household_id and user_id=p_actor_id and role in ('owner','admin')) then
    raise exception 'Feed unavailable' using errcode='42501';
  end if;
  if not f.is_active then raise exception 'Feed inactive'; end if;
  if f.import_token is not null and f.import_started_at>now()-interval '2 minutes' then raise exception 'Import already running'; end if;
  update public.calendar_feeds set import_token=gen_random_uuid(),import_started_at=now(),
    last_sync_status='syncing',last_sync_message=null where id=f.id returning * into f;
  return to_jsonb(f);
end $$;

create or replace function public.fail_calendar_feed_import(p_feed_id uuid,p_token uuid,p_message text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.calendar_feeds set last_sync_status='error',
    last_sync_message=case when p_message in ('FETCH_FAILED','INVALID_ICS','IMPORT_LIMIT','IMPORT_FAILED','URL_NOT_ALLOWED')
      then p_message else 'IMPORT_FAILED' end,
    import_token=null,import_started_at=null
    where id=p_feed_id and import_token=p_token;
end $$;

create or replace function public.apply_calendar_feed_import(
 p_feed_id uuid,p_actor_id uuid,p_token uuid,p_rows jsonb,p_range_start date,p_range_end date,p_cleanup boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; row_data jsonb; payload jsonb; ek text; ids uuid[]; person_name text;
 inserted integer:=0; updated integer:=0; deleted integer:=0; skipped integer:=0;
 existing_id uuid; incoming text[]:='{}'; touched integer; effective_ids uuid[];
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
      or (payload->>'date')::date not between p_range_start and p_range_end
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
    insert into public.calendar_items(household_id,title,date,time,person,person_ids,type,note,done,created_by,source,external_id,calendar_id,location,duration_min,data)
    values(f.household_id,coalesce(nullif(payload->>'title',''),'(uden titel)'),(payload->>'date')::date,payload->>'time',person_name,ids,
      'Aktivitet',payload->>'note',false,p_actor_id,f.source,ek,f.id::text,payload->'data'->>'location',(payload->'data'->>'durationMin')::integer,
      coalesce(payload->'data','{}'::jsonb) || jsonb_build_object('source',f.source,'feedId',f.id,'calendarId',f.id,'externalId',ek,'externalKey',ek,'person',person_name,'people',jsonb_build_array(person_name),'personIds',to_jsonb(ids)))
    on conflict(household_id,source,external_id) do update set
      title=excluded.title,date=excluded.date,time=excluded.time,person=excluded.person,person_ids=excluded.person_ids,
      type=excluded.type,note=excluded.note,calendar_id=excluded.calendar_id,location=excluded.location,duration_min=excluded.duration_min,
      data=calendar_items.data || excluded.data || jsonb_build_object('done',calendar_items.done)
    where not calendar_items.detached_from_feed and coalesce(calendar_items.data->>'detachedFromFeed','false')<>'true';
    get diagnostics touched=row_count;
    if touched>0 then if existing_id is null then inserted:=inserted+1; else updated:=updated+1; end if; end if;
  end loop;
  delete from public.calendar_items c where p_cleanup is true and c.household_id=f.household_id and c.source=f.source
    and coalesce(c.calendar_id,c.data->>'calendarId',c.data->>'feedId')=f.id::text
    and not c.detached_from_feed and coalesce(c.data->>'detachedFromFeed','false')<>'true'
    and c.date between p_range_start and p_range_end
    and not(coalesce(c.external_id,c.data->>'externalKey','')=any(incoming));
  get diagnostics deleted=row_count;
  update public.calendar_feeds set last_sync_at=now(),last_sync_status='success',
    last_sync_message=null,last_import_count=inserted+updated,import_token=null,import_started_at=null
    where id=f.id;
  return jsonb_build_object('insertedCount',inserted,'updatedCount',updated,'deletedCount',deleted,'skippedCount',skipped,'importedCount',inserted+updated);
end $$;
revoke all on function public.begin_calendar_feed_import(uuid,uuid),public.fail_calendar_feed_import(uuid,uuid,text),
 public.apply_calendar_feed_import(uuid,uuid,uuid,jsonb,date,date,boolean) from public,anon,authenticated;
grant execute on function public.begin_calendar_feed_import(uuid,uuid),public.fail_calendar_feed_import(uuid,uuid,text),
 public.apply_calendar_feed_import(uuid,uuid,uuid,jsonb,date,date,boolean) to service_role;
commit;
