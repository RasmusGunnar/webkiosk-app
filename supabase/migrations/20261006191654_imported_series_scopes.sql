-- Persistent imported-series rules in the existing override/exclusion table.
-- No source write-back, cleanup, calendar row copying or historical data rewrite.
begin;
alter table public.calendar_import_overrides
 add column if not exists effective_from timestamptz,
 add column if not exists effective_date date,
 add column if not exists display_title text,
 add column if not exists rule_scope text generated always as
  (case when occurrence='*' then 'series' when effective_from is not null then 'future' else 'occurrence' end) stored;
comment on column public.calendar_import_overrides.effective_from is
 'Immutable source recurrence slot, never the mutable displayed start. Future rule key is from:<original recurrenceId>.';

create or replace function private.calendar_recurrence_slot(p_slot text)
returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if p_slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return p_slot::date::timestamp at time zone 'UTC'; end if;
 if p_slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then return p_slot::timestamptz; end if;
 return null;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
revoke all on function private.calendar_recurrence_slot(text) from public,anon,authenticated;

-- Whole-series defaults, followed by effective-from boundaries, followed by a
-- specific occurrence. Hidden rules combine with OR and restore independently.
create or replace function private.apply_import_override(p_id uuid,p_from_source boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare c public.calendar_items; patch jsonb:='{}'; raw jsonb; effective jsonb; ids uuid[]; names text[];
 hide boolean:=false; next_data jsonb; person_name text; slot text; instant timestamptz; rule record;
begin
 select * into c from public.calendar_items where id=p_id for update;
 if not found then return; end if;
 slot:=coalesce(nullif(c.data->>'recurrenceId',''),'single');
 instant:=private.calendar_recurrence_slot(slot);
 for rule in select o.patch,o.hidden from public.calendar_import_overrides o
  where o.household_id=c.household_id and o.feed_id::text=c.calendar_id and o.uid=c.data->>'uid'
   and (o.occurrence='*' or o.occurrence=slot or o.effective_from<=instant)
  order by case o.rule_scope when 'series' then 0 when 'future' then 1 else 2 end,
   o.effective_from nulls first,o.occurrence
 loop patch:=patch||rule.patch; hide:=hide or rule.hidden; end loop;
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
revoke all on function private.apply_import_override(uuid,boolean) from public,anon,authenticated;

-- Separate RPC name keeps the deployed four-argument client contract unambiguous.
create or replace function public.edit_imported_calendar_scope(
 p_id uuid,p_expected timestamptz,p_patch jsonb,p_scope text,p_hide boolean default false
) returns void language plpgsql security definer set search_path='' as $$
declare c public.calendar_items; fid uuid; slot text; rule_key text; boundary timestamptz; boundary_date date;
 ids uuid[]; names text[]; other record; changed_fields text[];
begin
 select f.id into fid from public.calendar_items i join public.calendar_feeds f
  on f.id::text=coalesce(i.calendar_id,i.data->>'calendarId',i.data->>'feedId') and f.household_id=i.household_id
  where i.id=p_id and coalesce(i.source,i.data->>'source') in ('google','ics','aula');
 -- Keep feed -> item lock order shared with manual and scheduled import.
 perform 1 from public.calendar_feeds where id=fid for update;
 select * into c from public.calendar_items where id=p_id for update;
 if auth.uid() is null or not private.is_household_member(c.household_id) or fid is null or nullif(c.data->>'uid','') is null then raise exception 'Imported item unavailable' using errcode='42501';end if;
 if c.updated_at is distinct from p_expected then raise exception 'Aftalen er ændret. Luk og åbn den igen.' using errcode='40001';end if;
 if p_scope is null or p_scope not in ('occurrence','future','series') or p_hide is null then raise exception 'Invalid scope';end if;
 slot:=coalesce(nullif(c.data->>'recurrenceId',''),'single');
 boundary:=private.calendar_recurrence_slot(slot);
 if p_scope='future' and boundary is null then raise exception 'Denne aftale har ingen gyldig gentagelse.' using errcode='22023';end if;
 rule_key:=case p_scope when 'series' then '*' when 'future' then 'from:'||slot else slot end;
 boundary_date:=case when length(slot)=10 and boundary is not null then slot::date
  when boundary is not null then (boundary at time zone coalesce(nullif(c.data->>'timeZone',''),'Europe/Copenhagen'))::date else c.date end;
 if c.calendar_id is null or c.source is null then
  update public.calendar_items set calendar_id=fid::text,source=(select source from public.calendar_feeds where id=fid) where id=c.id returning * into c;
 end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','location','note','type','personIds')) then raise exception 'Invalid override';end if;
 if p_patch ? 'title' and (jsonb_typeof(p_patch->'title')<>'string' or nullif(trim(p_patch->>'title'),'') is null or length(p_patch->>'title')>1000) then raise exception 'Invalid title';end if;
 if exists(select 1 from jsonb_each(p_patch) e where e.key in ('location','note') and jsonb_typeof(e.value) not in ('string','null')) then raise exception 'Invalid text';end if;
 if length(p_patch->>'location')>2000 or length(p_patch->>'note')>10000 then raise exception 'Text too long';end if;
 if p_patch ? 'type' and (p_patch->>'type' is null or p_patch->>'type' not in ('Aktivitet','Fritidsinteresse')) then raise exception 'Invalid type';end if;
 if p_patch ? 'personIds' then
  if jsonb_typeof(p_patch->'personIds') is distinct from 'array' then raise exception 'Invalid people';end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(p_patch->'personIds');
  if exists(select 1 from unnest(ids) pid where pid is null or not exists(select 1 from public.household_people p where p.id=pid and p.household_id=c.household_id)) then raise exception 'Person unavailable';end if;
  select array_agg(name order by name) into names from public.household_people where id=any(ids);
  p_patch:=p_patch||jsonb_build_object('personIds',to_jsonb(ids),'person',coalesce(array_to_string(names,', '),'Alle'));
 end if;
 -- The latest explicit choice wins ONLY for the chosen fields and scope.
 -- Remove superseded keys from narrower rules, retaining their other fields
 -- and all exclusions. Earlier future rules remain in effect before boundary.
 select coalesce(array_agg(k),'{}') into changed_fields from jsonb_object_keys(p_patch) k;
 if p_scope<>'occurrence' and cardinality(changed_fields)>0 then
  update public.calendar_import_overrides o set patch=o.patch-changed_fields
   where o.household_id=c.household_id and o.feed_id=fid and o.uid=c.data->>'uid' and o.occurrence<>rule_key
   and o.patch ?| changed_fields and (p_scope='series' or
    (o.rule_scope='future' and o.effective_from>=boundary) or
    (o.rule_scope='occurrence' and private.calendar_recurrence_slot(o.occurrence)>=boundary));
 end if;
 insert into public.calendar_import_overrides(household_id,feed_id,uid,occurrence,patch,hidden,effective_from,effective_date,display_title)
 values(c.household_id,fid,c.data->>'uid',rule_key,p_patch,p_hide,case when p_scope='future' then boundary end,boundary_date,c.title)
 on conflict(household_id,feed_id,uid,occurrence) do update set
  patch=calendar_import_overrides.patch||excluded.patch,hidden=calendar_import_overrides.hidden or excluded.hidden,
  effective_from=excluded.effective_from,effective_date=excluded.effective_date,display_title=excluded.display_title;
 for other in select id from public.calendar_items where household_id=c.household_id and calendar_id=c.calendar_id
  and source=c.source and data->>'uid'=c.data->>'uid' and
   (p_scope='series' or (p_scope='occurrence' and id=c.id) or
    (p_scope='future' and private.calendar_recurrence_slot(data->>'recurrenceId')>=boundary))
 loop perform private.apply_import_override(other.id);end loop;
end $$;
revoke all on function public.edit_imported_calendar_scope(uuid,timestamptz,jsonb,text,boolean) from public,anon;
grant execute on function public.edit_imported_calendar_scope(uuid,timestamptz,jsonb,text,boolean) to authenticated;

-- Backwards-compatible entry point for existing clients and callers.
create or replace function public.edit_imported_calendar_item(p_id uuid,p_expected timestamptz,p_patch jsonb default '{}',p_hide_scope text default null)
returns void language sql security invoker set search_path='' as $$
 select public.edit_imported_calendar_scope(p_id,p_expected,p_patch,coalesce(p_hide_scope,'occurrence'),p_hide_scope is not null);
$$;

create or replace function public.list_hidden_calendar_imports(p_household_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('feed_id',o.feed_id,'uid',o.uid,'occurrence',o.occurrence,
  'scope',o.rule_scope,'effective_from',o.effective_from,'effective_date',o.effective_date,
  'feed_name',f.name,'source',f.source,'title',coalesce(item.title,o.patch->>'title',o.display_title,'Skjult aftale'),'date',coalesce(o.effective_date,item.date))
  order by f.name,o.uid,o.occurrence)
 from public.calendar_import_overrides o join public.calendar_feeds f on f.id=o.feed_id and f.household_id=o.household_id
 left join lateral(select title,date from public.calendar_items c where c.household_id=o.household_id and c.calendar_id=o.feed_id::text
  and c.data->>'uid'=o.uid and (o.occurrence='*' or coalesce(nullif(c.data->>'recurrenceId',''),'single')=o.occurrence
   or (o.rule_scope='future' and private.calendar_recurrence_slot(c.data->>'recurrenceId')>=o.effective_from)) order by date limit 1)item on true
 where o.household_id=p_household_id and o.hidden),'[]');
end $$;
-- restore_calendar_import already clears only the selected key's hidden flag,
-- then reapplies surviving rules. Its contract and field patches are unchanged.
notify pgrst,'reload schema';
commit;
