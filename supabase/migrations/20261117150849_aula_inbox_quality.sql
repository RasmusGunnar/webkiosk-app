-- Source text, provider IDs and credentials are never stored here. Components
-- reference actual review rows; their status remains the authority for decisions.
create table private.aula_review_components (
 finding_id uuid not null references public.aula_findings(id) on delete cascade,
 household_id uuid not null references public.aula_connections(household_id) on delete cascade,
 component_key text not null check(component_key ~ '^[a-f0-9]{64}$'),
 group_key text not null check(group_key ~ '^[a-f0-9]{64}$'),
 origin_source_key text not null check(origin_source_key ~ '^[a-f0-9]{64}$'),
 action_key text not null check(action_key ~ '^[a-f0-9]{64}$'),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 material_revision text not null check(material_revision ~ '^[a-f0-9]{64}$'),
 primary key(finding_id,component_key)
);
create index aula_component_memory on private.aula_review_components(household_id,component_key);
create index aula_component_household on private.aula_review_components(household_id,finding_id);
alter table private.aula_review_components enable row level security;
revoke all on private.aula_review_components from public,anon,authenticated;
grant all on private.aula_review_components to service_role;

alter table public.aula_findings
 add column actionability text check(actionability in ('BRING','DO','PREPARE','DEADLINE','RESPOND','PAY','ATTEND','CHANGE','IMPORTANT_INFO','GENERAL_INFO')),
 add column lifecycle text check(lifecycle in ('dated','immediate','persistent','unresolved')),
 add column expires_on date,
 add constraint aula_conservative_lifecycle check(expires_on is null or (lifecycle='immediate' and date is null and actionability in ('BRING','PREPARE')));

create function private.aula_review_current(start_date date,end_date date,expires_on date,at_time timestamptz default now()) returns boolean
language sql stable security invoker set search_path='' as $$
 select private.aula_finding_current(start_date,end_date,at_time)
  and (start_date is not null or expires_on is null or expires_on>=(at_time at time zone 'Europe/Copenhagen')::date)
$$;
revoke all on function private.aula_review_current(date,date,date,timestamptz) from public,anon,authenticated;
grant execute on function private.aula_review_current(date,date,date,timestamptz) to service_role;

create function private.aula_bind_components(hid uuid,fid uuid,components jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
 if jsonb_array_length(components)>100 then raise exception 'AULA_MEMORY_LIMIT';end if;
 if not exists(select 1 from public.aula_findings where id=fid and household_id=hid) then raise exception 'AULA_FORBIDDEN';end if;
 for c in select value from jsonb_array_elements(components) loop
  insert into private.aula_review_components(finding_id,household_id,component_key,group_key,origin_source_key,action_key,source_revision,material_revision)
  values(fid,hid,c->>'component_key',c->>'group_key',c->>'origin_source_key',c->>'action_key',c->>'source_revision',c->>'material_revision')
  on conflict(finding_id,component_key) do nothing;
 end loop;
end $$;
revoke all on function private.aula_bind_components(uuid,uuid,jsonb) from public,anon,authenticated;

-- Keep the proven legacy identity/review behaviour intact behind a small wrapper.
alter function private.aula_store_findings(uuid,jsonb) rename to aula_store_findings_v1;
create function private.aula_store_findings(hid uuid,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare x jsonb;c jsonb;b jsonb;r jsonb;kept jsonb:='[]';fid uuid;prior uuid;
 all_covered boolean;covered integer:=0;retired integer:=0;updated_clusters integer:=0;
 decision record;keep_ids uuid[]:='{}';
begin
 if jsonb_array_length(coalesce(p->'component_bindings','[]'))>5000 or jsonb_array_length(coalesce(p->'reconcile','[]'))>5000 then raise exception 'AULA_MEMORY_LIMIT';end if;
 for b in select value from jsonb_array_elements(coalesce(p->'component_bindings','[]')) loop
  perform private.aula_bind_components(hid,(b->>'finding_id')::uuid,b->'components');
 end loop;
 for x in select value from jsonb_array_elements(coalesce(p->'findings','[]')) loop
  all_covered:=jsonb_array_length(coalesce(x->'components','[]'))>0;prior:=null;
  for c in select value from jsonb_array_elements(coalesce(x->'components','[]')) loop
   -- Lock the reviewed row, including a review performed since scan_memory.
   select f.id,rc.source_revision,rc.material_revision into decision
    from private.aula_review_components rc join public.aula_findings f on f.id=rc.finding_id
    where rc.household_id=hid and f.household_id=hid and rc.component_key=c->>'component_key'
     and (f.status in ('accepted','ignored') or exists(select 1 from private.aula_expired_findings e where e.finding_id=f.id))
    order by f.updated_at desc,f.id desc limit 1 for update of f;
   if not found then all_covered:=false;
   else
    prior:=decision.id;
    if decision.source_revision<>c->>'source_revision' and decision.material_revision<>c->>'material_revision' then all_covered:=false;end if;
   end if;
  end loop;
  if all_covered then covered:=covered+1;continue;end if;
  kept:=kept||jsonb_build_array(x||case when prior is null then '{}'::jsonb else jsonb_build_object('component_supersedes',prior) end);
 end loop;
 r:=private.aula_store_findings_v1(hid,p||jsonb_build_object('findings',kept));
 for x in select value from jsonb_array_elements(kept) loop
  select f.id into fid from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id
   where f.household_id=hid and f.status='new' and i.household_id=hid
    and i.action_key=x->'identity'->>'action_key' and i.material_revision=x->'identity'->>'material_revision'
   order by f.created_at limit 1;
  if fid is null then continue;end if;
  keep_ids:=array_append(keep_ids,fid);
  -- Only NEW rows are changed. Previously accepted/ignored rows are immutable.
  delete from private.aula_review_components where household_id=hid and finding_id=fid;
  perform private.aula_bind_components(hid,fid,coalesce(x->'components','[]'));
  update public.aula_findings set actionability=x->>'actionability',lifecycle=x->>'lifecycle',
   expires_on=case when x->>'lifecycle'='immediate' then nullif(x->>'expires_on','')::date end where id=fid and status='new';
  if x->>'component_supersedes' is not null then
   update private.aula_finding_identity set supersedes=coalesce(supersedes,(x->>'component_supersedes')::uuid) where finding_id=fid;
   updated_clusters:=updated_clusters+1;
  end if;
 end loop;
 -- A bounded compare-and-set list from successful, fully analyzed source
 -- origins. Partial/unread sources never authorize retirement. Concurrent user
 -- decisions and concurrent finding changes fail the status/timestamp check.
 for b in select value from jsonb_array_elements(coalesce(p->'reconcile','[]')) loop
  update public.aula_findings f set status='stale',updated_at=now()
   where f.id=(b->>'finding_id')::uuid and f.household_id=hid and f.status='new'
    and f.updated_at=(b->>'updated_at')::timestamptz and not(f.id=any(keep_ids))
    and exists(select 1 from private.aula_finding_identity i where i.finding_id=f.id and i.household_id=hid and i.origin_source_key=b->>'origin_source_key');
  if found then retired:=retired+1;end if;
 end loop;
 return r||jsonb_build_object('component_covered_suppressed',covered,'quality_retired',retired,'cluster_updates',updated_clusters);
end $$;
revoke all on function private.aula_store_findings(uuid,jsonb) from public,anon,authenticated;

-- Extend only the shared expiry predicate and read-only scan memory projection.
do $migration$
declare definition text;signature text;old text;new text;
begin
 foreach signature in array array['private.aula_expire_findings(uuid)','private.aula_server(text,uuid,uuid,jsonb)','private.aula_review_corrected(uuid,uuid,text,uuid[],text,text,text,boolean)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  old:=case when signature like 'private.aula_server%' then 'private.aula_finding_current(v.date,v.end_date)' else 'private.aula_finding_current(f.date,f.end_date)' end;
  new:=case when signature like 'private.aula_server%' then 'private.aula_review_current(v.date,v.end_date,v.expires_on)' else 'private.aula_review_current(f.date,f.end_date,f.expires_on)' end;
  if position(old in definition)=0 then raise exception 'AULA_QUALITY_EXPIRY_BASE_MISMATCH';end if;
  definition:=replace(definition,old,new);
  if signature like 'private.aula_server%' then
   old:='jsonb_build_object(''identity'',to_jsonb(i))';
   new:='jsonb_build_object(''identity'',to_jsonb(i),''automatically_expired'',exists(select 1 from private.aula_expired_findings ex where ex.finding_id=af.id),''components'',coalesce((select jsonb_agg(to_jsonb(rc)) from private.aula_review_components rc where rc.finding_id=af.id and rc.household_id=hid),''[]''::jsonb))';
   if position(old in definition)=0 then raise exception 'AULA_QUALITY_MEMORY_BASE_MISMATCH';end if;
   definition:=replace(definition,old,new);
  end if;
  execute definition;
 end loop;
end $migration$;
