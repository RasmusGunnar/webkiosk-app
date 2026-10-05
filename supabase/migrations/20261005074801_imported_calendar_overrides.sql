-- Additive local overrides. No cleanup is run when this migration is installed.
begin;
create index if not exists calendar_items_feed_uid on public.calendar_items(household_id,source,(coalesce(calendar_id,data->>'calendarId',data->>'feedId')),(data->>'uid'));
create table if not exists public.calendar_import_overrides (
 household_id uuid not null references public.households(id) on delete cascade,
 feed_id uuid not null references public.calendar_feeds(id) on delete cascade,
 uid text not null, occurrence text not null, patch jsonb not null default '{}', hidden boolean not null default false,
 primary key(household_id,feed_id,uid,occurrence), check(jsonb_typeof(patch)='object')
);
alter table public.calendar_import_overrides enable row level security;
create table if not exists public.calendar_import_archives (
 item_id uuid primary key, household_id uuid not null references public.households(id) on delete cascade,
 canonical_id uuid not null, archived_at timestamptz not null default now(), original_row jsonb not null
);
alter table public.calendar_import_archives enable row level security;
revoke all on public.calendar_import_overrides,public.calendar_import_archives from anon,authenticated;
grant all on public.calendar_import_overrides,public.calendar_import_archives to service_role;
-- These private tables are only accessible through the checked RPCs, never browser writes.
create or replace function private.apply_import_override(p_id uuid,p_from_source boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare c public.calendar_items; patch jsonb; raw jsonb; effective jsonb; ids uuid[]; names text[]; hide boolean;
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
 update public.calendar_items set title=effective->>'title',location=effective->>'location',note=effective->>'note',type=effective->>'type',person_ids=ids,person=array_to_string(names,', '),
 data=c.data||effective||jsonb_build_object('personIds',to_jsonb(ids),'people',to_jsonb(names),'person',array_to_string(names,', '),'importSource',raw,'importLocalOverrides',patch,'importHidden',hide)
 where id=c.id;
end $$;

create or replace function public.edit_imported_calendar_item(p_id uuid,p_expected timestamptz,p_patch jsonb default '{}',p_hide_scope text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.calendar_items; fid uuid; v_occurrence text; ids uuid[]; names text[]; other record;
begin
 select calendar_id::uuid into fid from public.calendar_items where id=p_id and source in ('google','ics','aula');
 -- All import and edit operations acquire the same feed lock before any item locks.
 perform 1 from public.calendar_feeds where id=fid for update;
 select * into c from public.calendar_items where id=p_id for update;
 if auth.uid() is null or not private.is_household_member(c.household_id) or fid is null or nullif(c.data->>'uid','') is null then raise exception 'Imported item unavailable' using errcode='42501';end if;
 if c.updated_at is distinct from p_expected then raise exception 'Aftalen er ændret. Luk og åbn den igen.' using errcode='40001';end if;
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
create or replace function private.apply_calendar_feed_import_base(
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
    and c.data ? 'recurrenceId' and nullif(c.data->>'uid','') is not null
    and c.date between p_range_start and p_range_end
    and not(coalesce(c.external_id,c.data->>'externalKey','')=any(incoming));
  get diagnostics deleted=row_count;
  update public.calendar_feeds set last_sync_at=now(),last_sync_status='success',
    last_sync_message=null,last_import_count=inserted+updated,import_token=null,import_started_at=null
    where id=f.id;
  return jsonb_build_object('insertedCount',inserted,'updatedCount',updated,'deletedCount',deleted,'skippedCount',skipped,'importedCount',inserted+updated);
end $$;

create or replace function public.apply_calendar_feed_import(
 p_feed_id uuid,p_actor_id uuid,p_token uuid,p_rows jsonb,p_range_start date,p_range_end date,p_cleanup boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.calendar_feeds; r jsonb; d jsonb; ek text; canonical uuid; duplicates uuid[]; x record; result jsonb;
begin
 select * into f from public.calendar_feeds where id=p_feed_id for update;
 if f.id is null or p_token is null or f.import_token is distinct from p_token or not f.is_active
 or not exists(select 1 from public.household_members where household_id=f.household_id and user_id=p_actor_id and role in ('owner','admin')) then raise exception 'Feed unavailable' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid import batch';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  d:=r->'payload'->'data';ek:=r->>'externalKey';
  -- A known UID and explicit recurrence field are required. No title/time matching.
  if nullif(d->>'uid','') is null or not(d ? 'recurrenceId') then raise exception 'External identity missing';end if;
  select array_agg(c.id order by (c.detached_from_feed or coalesce(c.data->>'detachedFromFeed','false')='true') desc,c.created_at,c.id) into duplicates
  from public.calendar_items c where c.household_id=f.household_id and c.source=f.source
   and coalesce(c.calendar_id,c.data->>'calendarId',c.data->>'feedId')=f.id::text
   and c.data->>'uid'=d->>'uid' and c.data ? 'recurrenceId'
   and coalesce(nullif(c.data->>'recurrenceId',''),'single')=coalesce(nullif(d->>'recurrenceId',''),'single');
  if cardinality(duplicates)>0 then
   canonical:=duplicates[1];
   -- Conflicting detached edits require human reconciliation; abort atomically.
   if (select count(*) from public.calendar_items where id=any(duplicates) and (detached_from_feed or data->>'detachedFromFeed'='true'))>1 then raise exception 'Conflicting local edits; reconcile imported duplicates first';end if;
   insert into public.calendar_import_archives(item_id,household_id,canonical_id,original_row)
    select c.id,c.household_id,canonical,to_jsonb(c) from public.calendar_items c where c.id=any(duplicates) and c.id<>canonical on conflict do nothing;
   delete from public.calendar_items where id=any(duplicates) and id<>canonical;
   update public.calendar_items set external_id=ek,data=data||jsonb_build_object('externalId',ek,'externalKey',ek) where id=canonical;
  end if;
 end loop;
 result:=private.apply_calendar_feed_import_base(p_feed_id,p_actor_id,p_token,p_rows,p_range_start,p_range_end,p_cleanup);
 for x in select id from public.calendar_items where household_id=f.household_id and calendar_id=f.id::text and source=f.source
 and not detached_from_feed and coalesce(data->>'detachedFromFeed','false')<>'true'
 and external_id in(select value->>'externalKey' from jsonb_array_elements(p_rows)) loop
  perform private.apply_import_override(x.id,true);
 end loop;
 return result;
end $$;
revoke all on function private.apply_import_override(uuid,boolean),private.apply_calendar_feed_import_base(uuid,uuid,uuid,jsonb,date,date,boolean) from public,anon,authenticated;
revoke all on function public.edit_imported_calendar_item(uuid,timestamptz,jsonb,text) from public,anon;
grant execute on function public.edit_imported_calendar_item(uuid,timestamptz,jsonb,text) to authenticated;
revoke all on function public.apply_calendar_feed_import(uuid,uuid,uuid,jsonb,date,date,boolean) from public,anon,authenticated;
grant execute on function public.apply_calendar_feed_import(uuid,uuid,uuid,jsonb,date,date,boolean) to service_role;
commit;
