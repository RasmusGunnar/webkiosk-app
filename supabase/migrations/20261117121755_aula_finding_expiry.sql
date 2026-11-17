-- Only automatic date expiry is suppressive. Existing duplicate/history STALE
-- rows are deliberately not backfilled into this marker table.
create table private.aula_expired_findings (
 finding_id uuid primary key references public.aula_findings(id) on delete cascade,
 expired_at timestamptz not null default now()
);
alter table private.aula_expired_findings enable row level security;
revoke all on private.aula_expired_findings from public,anon,authenticated;
grant all on private.aula_expired_findings to service_role;

create function private.aula_finding_current(start_date date,end_date date,at_time timestamptz default now()) returns boolean
language sql stable security invoker set search_path='' as $$
 select start_date is null or coalesce(end_date,start_date)>=(at_time at time zone 'Europe/Copenhagen')::date
$$;
revoke all on function private.aula_finding_current(date,date,timestamptz) from public,anon,authenticated;
grant execute on function private.aula_finding_current(date,date,timestamptz) to service_role;

create function private.aula_expire_findings(hid uuid default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 with expired as (
  update public.aula_findings f set status='stale',updated_at=now()
  where (hid is null or f.household_id=hid) and f.status='new'
   and not private.aula_finding_current(f.date,f.end_date)
  returning f.id
 ) insert into private.aula_expired_findings(finding_id) select id from expired;
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function private.aula_expire_findings(uuid) from public,anon,authenticated;
grant execute on function private.aula_expire_findings(uuid) to service_role;

-- Preserve the credential-generation fence, actual review decisions, ACLs and
-- scan transaction. Fail closed if an expected existing clause has changed.
do $migration$
declare definition text; patch record;
begin
 definition:=pg_get_functiondef('private.aula_server(text,uuid,uuid,jsonb)'::regprocedure);
 for patch in select * from (values
  ($old$(v.status='new' or v.updated_at>now()-interval '14 days')$old$,
   $new$((v.status='new' and private.aula_finding_current(v.date,v.end_date)) or (v.status<>'new' and v.updated_at>now()-interval '14 days'))$new$),
  ($old$result:=private.aula_store_findings(hid,p);$old$,
   $new$perform private.aula_expire_findings(hid);
   result:=private.aula_store_findings(hid,p);$new$),
  ($old$update public.aula_findings set status='stale',updated_at=now() where household_id=hid and status='new' and date<current_date-7;$old$,
   $new$perform private.aula_expire_findings(hid);$new$)
 ) changes(old_text,new_text) loop
  if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) then raise exception 'AULA_EXPIRY_SERVER_BASE_MISMATCH'; end if;
  definition:=replace(definition,patch.old_text,patch.new_text);
 end loop;
 execute definition;

 definition:=pg_get_functiondef('private.aula_store_findings(uuid,jsonb)'::regprocedure);
 for patch in select * from (values
  ($old$ignored_count integer:=0;$old$,$new$expired_count integer:=0; ignored_count integer:=0;$new$),
  ($old$   select f.* into existing from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id
    where f.household_id=hid and i.household_id=hid and i.action_key=m->>'action_key' and i.origin_source_key=m->>'origin_source_key'
    and f.status='new'$old$,
   $new$   -- Keep accepted/ignored precedence above. Only proven automatic expiry
   -- suppresses an unchanged source OR material revision, including AI drift.
   perform 1 from public.aula_findings f
    join private.aula_finding_identity i on i.finding_id=f.id
    join private.aula_expired_findings e on e.finding_id=f.id
    where f.household_id=hid and i.household_id=hid and f.status='stale'
     and i.action_key=m->>'action_key' and i.origin_source_key=m->>'origin_source_key'
     and (i.source_revision=m->>'source_revision' or i.material_revision=m->>'material_revision')
    for update of f;
   if found then expired_count:=expired_count+1;continue;end if;
   if superseded is null then
    select f.id into superseded from public.aula_findings f
     join private.aula_finding_identity i on i.finding_id=f.id
     join private.aula_expired_findings e on e.finding_id=f.id
     where f.household_id=hid and i.household_id=hid and f.status='stale'
      and i.action_key=m->>'action_key' and i.origin_source_key=m->>'origin_source_key'
     order by e.expired_at desc,f.id desc limit 1 for update of f;
   end if;
   select f.* into existing from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id
    where f.household_id=hid and i.household_id=hid and i.action_key=m->>'action_key' and i.origin_source_key=m->>'origin_source_key'
    and f.status='new'$new$),
  ($old$source_key=target_key and status in ('accepted','ignored')$old$,
   $new$source_key=target_key and (status in ('accepted','ignored') or (status='stale' and id in(select finding_id from private.aula_expired_findings)))$new$),
  ($old$'duplicates_suppressed',ignored_count+accepted_count$old$,
   $new$'previously_expired',expired_count,'duplicates_suppressed',ignored_count+accepted_count+expired_count$new$)
 ) changes(old_text,new_text) loop
  if length(definition)-length(replace(definition,patch.old_text,''))<>length(patch.old_text) then raise exception 'AULA_EXPIRY_MEMORY_BASE_MISMATCH'; end if;
  definition:=replace(definition,patch.old_text,patch.new_text);
 end loop;
 execute definition;

 -- An already-open/old client cannot accept an expired NEW finding after
 -- midnight. Accepted idempotency and all existing date-correction rules stay.
 definition:=pg_get_functiondef('private.aula_review_corrected(uuid,uuid,text,uuid[],text,text,text,boolean)'::regprocedure);
 if position('if f.id is null then raise exception ''AULA_INVALID_FINDING''; end if;' in definition)=0 then raise exception 'AULA_EXPIRY_REVIEW_BASE_MISMATCH'; end if;
 definition:=replace(definition,
  'if f.id is null then raise exception ''AULA_INVALID_FINDING''; end if;',
  'if f.id is null then raise exception ''AULA_INVALID_FINDING''; end if;
 if f.status=''new'' and action=''accept'' and not private.aula_finding_current(f.date,f.end_date) then raise exception ''AULA_INVALID_FINDING''; end if;');
 execute definition;
end $migration$;
