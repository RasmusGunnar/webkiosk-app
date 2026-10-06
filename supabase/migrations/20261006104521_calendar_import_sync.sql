-- Calendar Import & Sync 3.0. Additive schema, no automatic data cleanup.
begin;
alter table public.calendar_feeds add column if not exists last_attempt_at timestamptz;
alter table public.calendar_feeds add column if not exists last_result jsonb;
create index if not exists calendar_feeds_due on public.calendar_feeds(last_attempt_at) where is_active;

create or replace function private.calendar_external_key(p_source text,p_feed text,p_uid text,p_occurrence text)
returns text language sql immutable set search_path='' as $$
 select array_to_json(array[p_source,p_feed,p_uid,coalesce(nullif(p_occurrence,''),'single')])::text
$$;
-- Canonicalise both legacy JSON-only and typed rows before the EXISTING unique index.
create or replace function private.normalize_import_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; k text;
begin
 if coalesce(nullif(new.source,''),new.data->>'source') not in ('aula','google','ics')
    or nullif(new.data->>'uid','') is null or not(new.data ? 'recurrenceId') then return new;end if;
 select * into f from public.calendar_feeds where id::text=coalesce(nullif(new.calendar_id,''),new.data->>'calendarId',new.data->>'feedId') and household_id=new.household_id;
 if f.id is null then raise exception 'Imported feed identity unavailable';end if;
 k:=private.calendar_external_key(f.source,f.id::text,new.data->>'uid',new.data->>'recurrenceId');
 new.source:=f.source;new.calendar_id:=f.id::text;new.external_id:=k;
 new.data:=new.data||jsonb_build_object('source',f.source,'feedId',f.id,'calendarId',f.id,'externalKey',k,'externalId',k);
 return new;
end $$;
drop trigger if exists normalize_import_identity on public.calendar_items;
create trigger normalize_import_identity before insert or update on public.calendar_items
 for each row execute function private.normalize_import_identity();

-- Explicit maintenance operation. Matches ONLY feed + UID + explicit recurrence identity.
-- Conflicting local edits or task relations abort the transaction; never guess a winner.
create or replace function public.reconcile_calendar_imports(p_feed_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; g record; c public.calendar_items; r public.calendar_items;
 merged jsonb; part jsonb; kv record; v_people uuid[]; any_done boolean; any_hidden boolean;
 archived integer:=0; normalized integer:=0; referenced uuid[];
begin
 select * into f from public.calendar_feeds where id=p_feed_id for update;
 if f.id is null then raise exception 'Feed unavailable';end if;
 if f.import_token is not null and f.import_started_at>now()-interval '2 minutes' then raise exception 'Feed busy';end if;
 for g in select data->>'uid' uid,coalesce(nullif(data->>'recurrenceId',''),'single') occurrence,
  array_agg(id order by created_at,id) ids
  from public.calendar_items where household_id=f.household_id
   and coalesce(source,data->>'source') in ('aula','google','ics')
   and coalesce(calendar_id,data->>'calendarId',data->>'feedId')=f.id::text
   and nullif(data->>'uid','') is not null and data ? 'recurrenceId'
  group by 1,2
 loop
  perform 1 from public.calendar_items where id=any(g.ids) order by id for update;
  select array_agg(distinct id) into referenced from public.calendar_items i where id=any(g.ids) and
   (exists(select 1 from public.task_reward_occurrences t where t.task_id=i.id or t.origin_id=i.id)
    or exists(select 1 from public.calendar_items x where x.id<>i.id and
      (x.data->>'overrideBaseId'=i.id::text or x.data->>'rewardOriginId'=i.id::text)));
  if cardinality(referenced)>1 then raise exception 'Conflicting task relations; manual reconciliation required';end if;
  select * into c from public.calendar_items where id=coalesce(referenced[1],g.ids[1]);
  merged:='{}';v_people:='{}';any_done:=false;any_hidden:=false;
  for r in select * from public.calendar_items where id=any(g.ids) order by created_at,id loop
   if cardinality(g.ids)>1 and (r.detached_from_feed or r.data->>'detachedFromFeed'='true') then
    raise exception 'Detached duplicate requires manual reconciliation';
   end if;
   part:=coalesce(r.data->'importLocalOverrides','{}');
   for kv in select * from jsonb_each(part) loop
    if merged ? kv.key and merged->kv.key is distinct from kv.value then raise exception 'Conflicting local overrides';end if;
   end loop;
   merged:=merged||part;
   if cardinality(r.person_ids)>0 then
    if cardinality(v_people)>0 and not(v_people @> r.person_ids and v_people <@ r.person_ids) then raise exception 'Conflicting person assignment';end if;
    v_people:=r.person_ids;
   end if;
   any_done:=any_done or r.done or coalesce(r.data->>'done','false')='true';
   any_hidden:=any_hidden or coalesce(r.data->>'importHidden','false')='true';
  end loop;
  -- The override table is authoritative. Refuse incompatible JSON remnants.
  select patch into part from public.calendar_import_overrides where household_id=f.household_id and feed_id=f.id and uid=g.uid and occurrence=g.occurrence;
  for kv in select * from jsonb_each(coalesce(part,'{}')) loop
   if merged ? kv.key and merged->kv.key is distinct from kv.value then raise exception 'Conflicting stored overrides';end if;
  end loop;
  merged:=merged||coalesce(part,'{}');
  if cardinality(v_people)>0 and not merged ? 'personIds' and
   (f.assigned_person_id is null or v_people<>array[f.assigned_person_id]) then
   merged:=merged||jsonb_build_object('personIds',to_jsonb(v_people));
  end if;
  if merged<>'{}' or any_hidden then
   insert into public.calendar_import_overrides(household_id,feed_id,uid,occurrence,patch,hidden)
   values(f.household_id,f.id,g.uid,g.occurrence,merged,any_hidden)
   on conflict(household_id,feed_id,uid,occurrence) do update
    set patch=calendar_import_overrides.patch||excluded.patch,hidden=calendar_import_overrides.hidden or excluded.hidden;
  end if;
  if cardinality(g.ids)>1 then
   insert into public.calendar_import_archives(item_id,household_id,canonical_id,original_row)
    select id,household_id,c.id,to_jsonb(i) from public.calendar_items i where id=any(g.ids) and id<>c.id on conflict do nothing;
   delete from public.calendar_items where id=any(g.ids) and id<>c.id;
   archived:=archived+cardinality(g.ids)-1;
  end if;
  update public.calendar_items set source=f.source,calendar_id=f.id::text,
   location=coalesce(location,data->>'location'),duration_min=coalesce(duration_min,(data->>'durationMin')::integer),
   person_ids=case when cardinality(v_people)>0 then v_people else c.person_ids end,done=any_done
   where id=c.id;
  perform private.apply_import_override(c.id);
  normalized:=normalized+1;
 end loop;
 return jsonb_build_object('archived',archived,'normalized',normalized);
end $$;
revoke all on function public.reconcile_calendar_imports(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_calendar_imports(uuid) to service_role;

create or replace function public.begin_calendar_feed_import(p_feed_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; actor uuid;
begin
 select * into f from public.calendar_feeds where id=p_feed_id for update;
 if f.id is null or not f.is_active then raise exception 'Feed inactive or unavailable';end if;
 -- Null actor is internal mode. EXECUTE is service-role only; never a browser RPC.
 select user_id into actor from public.household_members where household_id=f.household_id
  and role in ('owner','admin') and (p_actor_id is null or user_id=p_actor_id) order by (role='owner') desc,user_id limit 1;
 if actor is null then raise exception 'Feed unavailable' using errcode='42501';end if;
 if f.import_token is not null and f.import_started_at>now()-interval '2 minutes' then raise exception 'Import already running';end if;
 update public.calendar_feeds set import_token=gen_random_uuid(),import_started_at=now(),last_attempt_at=now(),
  last_sync_status='syncing',last_sync_message=null where id=f.id returning * into f;
 return to_jsonb(f)||jsonb_build_object('sync_actor_id',actor);
end $$;

create or replace function public.due_calendar_feeds(p_limit integer default 10)
returns table(id uuid) language sql security definer set search_path='' as $$
 select id from public.calendar_feeds where is_active
 and (last_attempt_at is null or last_attempt_at<=now()-interval '295 seconds')
 and (import_token is null or import_started_at<=now()-interval '2 minutes')
 order by last_attempt_at nulls first,id limit least(greatest(p_limit,1),10)
$$;
revoke all on function public.due_calendar_feeds(integer) from public,anon,authenticated;
grant execute on function public.due_calendar_feeds(integer) to service_role;

-- Restore works even if a source occurrence is temporarily outside the import window.
create or replace function public.list_hidden_calendar_imports(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('feed_id',o.feed_id,'uid',o.uid,'occurrence',o.occurrence,
  'feed_name',f.name,'source',f.source,'title',coalesce(item.title,o.patch->>'title','Skjult aftale'),'date',item.date)
  order by f.name,o.uid,o.occurrence)
 from public.calendar_import_overrides o join public.calendar_feeds f on f.id=o.feed_id and f.household_id=o.household_id
 left join lateral(select title,date from public.calendar_items c where c.household_id=o.household_id and c.calendar_id=o.feed_id::text
  and c.data->>'uid'=o.uid and (o.occurrence='*' or coalesce(nullif(c.data->>'recurrenceId',''),'single')=o.occurrence) order by date limit 1)item on true
 where o.household_id=p_household_id and o.hidden),'[]');
end $$;
create or replace function public.restore_calendar_import(p_household_id uuid,p_feed_id uuid,p_uid text,p_occurrence text)
returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.calendar_feeds where id=p_feed_id and household_id=p_household_id for update;
 update public.calendar_import_overrides set hidden=false where household_id=p_household_id and feed_id=p_feed_id and uid=p_uid and occurrence=p_occurrence;
 for item in select id from public.calendar_items where household_id=p_household_id and calendar_id=p_feed_id::text and data->>'uid'=p_uid loop
  perform private.apply_import_override(item.id);
 end loop;
end $$;
revoke all on function public.list_hidden_calendar_imports(uuid),public.restore_calendar_import(uuid,uuid,text,text) from public,anon;
grant execute on function public.list_hidden_calendar_imports(uuid),public.restore_calendar_import(uuid,uuid,text,text) to authenticated;
revoke all on function private.normalize_import_identity(),private.calendar_external_key(text,text,text,text) from public,anon,authenticated;

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
    select * into previous from public.calendar_items where id=existing_id;
    if previous.id is not null and coalesce(previous.data->>'importSourceRemoved','false')<>'true'
     and previous.data->'importSource'=jsonb_build_object('title',coalesce(nullif(payload->>'title',''),'(uden titel)'),'location',payload->'data'->>'location','note',payload->>'note','type','Aktivitet','personIds',to_jsonb(ids),'person',person_name)
     and previous.date=(payload->>'date')::date and previous.time is not distinct from payload->>'time'
     and previous.duration_min is not distinct from (payload->'data'->>'durationMin')::integer then
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
    and c.date between p_range_start and p_range_end
    and coalesce(c.data->>'importSourceRemoved','false')<>'true'
    and not(coalesce(c.external_id,c.data->>'externalKey','')=any(incoming));
  get diagnostics deleted=row_count;
  update public.calendar_feeds set last_sync_at=now(),last_sync_status='success',
    last_sync_message=null,last_import_count=jsonb_array_length(p_rows),import_token=null,import_started_at=null
    where id=f.id;
  return jsonb_build_object('insertedCount',inserted,'updatedCount',updated,'deletedCount',0,'sourceRemovedCount',deleted,'skippedCount',skipped,'importedCount',jsonb_array_length(p_rows));
end $$;


create or replace function public.apply_calendar_feed_import(
 p_feed_id uuid,p_actor_id uuid,p_token uuid,p_rows jsonb,p_range_start date,p_range_end date,p_cleanup boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; r jsonb; d jsonb; ek text; matches uuid[]; x record; result jsonb;
begin
 select * into f from public.calendar_feeds where id=p_feed_id for update;
 if f.id is null or p_token is null or f.import_token is distinct from p_token or not f.is_active
 or not exists(select 1 from public.household_members where household_id=f.household_id and user_id=p_actor_id and role in ('owner','admin')) then raise exception 'Feed unavailable' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid import batch';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  d:=r->'payload'->'data';ek:=r->>'externalKey';
  if nullif(d->>'uid','') is null or not(d ? 'recurrenceId') then raise exception 'External identity missing';end if;
  if ek is distinct from private.calendar_external_key(f.source,f.id::text,d->>'uid',d->>'recurrenceId') then raise exception 'Invalid external key';end if;
  select array_agg(c.id) into matches from public.calendar_items c where c.household_id=f.household_id
   and coalesce(c.source,c.data->>'source') in ('aula','google','ics')
   and coalesce(c.calendar_id,c.data->>'calendarId',c.data->>'feedId')=f.id::text and c.data->>'uid'=d->>'uid'
   and c.data ? 'recurrenceId' and coalesce(nullif(c.data->>'recurrenceId',''),'single')=coalesce(nullif(d->>'recurrenceId',''),'single');
  -- Cleanup is an explicit, archived maintenance operation, never a fuzzy sync delete.
  if cardinality(matches)>1 then raise exception 'Reconcile existing external duplicates before import';end if;
  if cardinality(matches)=1 then
   update public.calendar_items set source=f.source,calendar_id=f.id::text,external_id=ek where id=matches[1]
    and (source is distinct from f.source or calendar_id is distinct from f.id::text or external_id is distinct from ek);
  end if;
 end loop;
 result:=private.apply_calendar_feed_import_base(p_feed_id,p_actor_id,p_token,p_rows,p_range_start,p_range_end,p_cleanup);
 for x in select id from public.calendar_items where household_id=f.household_id and calendar_id=f.id::text and source=f.source
 and not detached_from_feed and coalesce(data->>'detachedFromFeed','false')<>'true'
 and external_id in(select value->>'externalKey' from jsonb_array_elements(p_rows)) loop perform private.apply_import_override(x.id);end loop;
 update public.calendar_feeds set last_result=result where id=f.id;
 return result;
end $$;
create or replace function public.edit_imported_calendar_item(p_id uuid,p_expected timestamptz,p_patch jsonb default '{}',p_hide_scope text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.calendar_items; fid uuid; v_occurrence text; ids uuid[]; names text[]; other record;
begin
 select f.id into fid from public.calendar_items i join public.calendar_feeds f on f.id::text=coalesce(i.calendar_id,i.data->>'calendarId',i.data->>'feedId') and f.household_id=i.household_id where i.id=p_id and coalesce(i.source,i.data->>'source') in ('google','ics','aula');
 -- All import and edit operations acquire the same feed lock before any item locks.
 perform 1 from public.calendar_feeds where id=fid for update;
 select * into c from public.calendar_items where id=p_id for update;
 if auth.uid() is null or not private.is_household_member(c.household_id) or fid is null or nullif(c.data->>'uid','') is null then raise exception 'Imported item unavailable' using errcode='42501';end if;
 if c.updated_at is distinct from p_expected then raise exception 'Aftalen er ændret. Luk og åbn den igen.' using errcode='40001';end if;
 if c.calendar_id is null or c.source is null then update public.calendar_items set calendar_id=fid::text,source=(select source from public.calendar_feeds where id=fid) where id=c.id returning * into c;end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','location','note','type','personIds')) then raise exception 'Invalid override';end if;
 if p_patch ? 'title' and (nullif(trim(p_patch->>'title'),'') is null or length(p_patch->>'title')>1000) then raise exception 'Invalid title';end if;
 if length(p_patch->>'location')>2000 or length(p_patch->>'note')>10000 then raise exception 'Text too long';end if;
 if p_patch ? 'type' and (p_patch->>'type' is null or p_patch->>'type' not in ('Aktivitet','Fritidsinteresse')) then raise exception 'Invalid type';end if;
 if p_patch ? 'personIds' then
  if jsonb_typeof(p_patch->'personIds') is distinct from 'array' then raise exception 'Invalid people';end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(p_patch->'personIds');
  if exists(select 1 from unnest(ids) pid where not exists(select 1 from public.household_people p where p.id=pid and p.household_id=c.household_id)) then raise exception 'Person unavailable';end if;
  select array_agg(name order by name) into names from public.household_people where id=any(ids);
  p_patch:=p_patch||jsonb_build_object('personIds',to_jsonb(ids),'person',coalesce(array_to_string(names,', '),'Alle'));
 end if;
 if p_hide_scope is not null and p_hide_scope not in ('occurrence','series') then raise exception 'Invalid scope';end if;
 v_occurrence:=case when p_hide_scope='series' then '*' else coalesce(nullif(c.data->>'recurrenceId',''),'single') end;
 insert into public.calendar_import_overrides(household_id,feed_id,uid,occurrence,patch,hidden)
 values(c.household_id,fid,c.data->>'uid',v_occurrence,p_patch,p_hide_scope is not null)
 on conflict(household_id,feed_id,uid,occurrence) do update set patch=calendar_import_overrides.patch||excluded.patch,hidden=calendar_import_overrides.hidden or excluded.hidden;
 for other in select id from public.calendar_items where household_id=c.household_id and calendar_id=c.calendar_id and source=c.source and data->>'uid'=c.data->>'uid'
 and (p_hide_scope='series' or id=c.id) loop perform private.apply_import_override(other.id);end loop;
end $$;


-- Avoid revision/WAL storms for identical imports. Changed rows still use the
-- existing household-scoped Realtime path; no second subscription or polling.
create or replace function private.apply_import_override(p_id uuid,p_from_source boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare c public.calendar_items; patch jsonb; raw jsonb; effective jsonb; ids uuid[]; names text[]; hide boolean; next_data jsonb; person_name text;
begin
 select * into c from public.calendar_items where id=p_id for update;
 select o.patch,o.hidden into patch,hide from public.calendar_import_overrides o
 where o.household_id=c.household_id and o.feed_id::text=c.calendar_id and o.uid=c.data->>'uid'
 and o.occurrence=coalesce(nullif(c.data->>'recurrenceId',''),'single');
 patch:=coalesce(patch,'{}');
 hide:=coalesce(hide,false) or exists(select 1 from public.calendar_import_overrides o where o.household_id=c.household_id
 and o.feed_id::text=c.calendar_id and o.uid=c.data->>'uid' and o.occurrence='*' and o.hidden);
 raw:=case when not p_from_source then c.data->'importSource' end;
 raw:=coalesce(raw,jsonb_build_object('title',c.title,'location',c.location,'note',c.note,'type',c.type,'personIds',to_jsonb(c.person_ids),'person',c.person));
 effective:=raw||patch;
 select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(effective->'personIds','[]'));
 select coalesce(array_agg(name order by name),'{}') into names from public.household_people where household_id=c.household_id and id=any(ids);
 if cardinality(ids)=0 then names:=array[coalesce(nullif(effective->>'person',''),'Alle')];end if;
 person_name:=array_to_string(names,', ');
 next_data:=c.data||effective||jsonb_build_object('personIds',to_jsonb(ids),'people',to_jsonb(names),'person',person_name,'importSource',raw,'importLocalOverrides',patch,'importHidden',hide);
 update public.calendar_items set title=effective->>'title',location=effective->>'location',note=effective->>'note',type=effective->>'type',person_ids=ids,person=person_name,data=next_data
 where id=c.id and (title,location,note,type,person_ids,person,data) is distinct from
 (effective->>'title',effective->>'location',effective->>'note',effective->>'type',ids,person_name,next_data);
end $$;

commit;
