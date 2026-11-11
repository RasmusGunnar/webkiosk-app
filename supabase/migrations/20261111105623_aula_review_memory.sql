-- Identity/decision metadata only. No raw Aula content or provider IDs.
create table private.aula_finding_identity (
 finding_id uuid primary key references public.aula_findings(id) on delete cascade,
 household_id uuid not null references public.aula_connections(household_id) on delete cascade,
 origin_source_key text not null check(origin_source_key ~ '^[a-f0-9]{64}$'),
 action_key text not null check(action_key ~ '^[a-f0-9]{64}$'),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 material_revision text not null check(material_revision ~ '^[a-f0-9]{64}$'),
 supersedes uuid references public.aula_findings(id) on delete set null
);
create index aula_identity_action on private.aula_finding_identity(household_id,action_key);
create index aula_identity_supersedes on private.aula_finding_identity(supersedes) where supersedes is not null;
alter table private.aula_finding_identity enable row level security;
revoke all on private.aula_finding_identity from public,anon,authenticated;
grant all on private.aula_finding_identity to service_role;

-- Called only inside the existing credential-generation-fenced scan transaction.
create function private.aula_store_findings(hid uuid,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare x jsonb; m jsonb; b jsonb; people uuid[]; existing public.aula_findings; prior_identity private.aula_finding_identity;
 saved_id uuid; superseded uuid; target_key text; cleaned integer:=0; pending_cleaned integer:=0;
 ignored_count integer:=0; accepted_count integer:=0; inserted_count integer:=0;
 refreshed_count integer:=0; updated_count integer:=0; bound_count integer:=0;
 reference_stored integer:=0; reference_new integer:=0; reference_date integer:=0; reference_people integer:=0;
begin
 if jsonb_array_length(coalesce(p->'findings','[]'))>500 or jsonb_array_length(coalesce(p->'bindings','[]'))>5000 then raise exception 'AULA_MEMORY_LIMIT'; end if;
 for b in select value from jsonb_array_elements(coalesce(p->'bindings','[]')) loop
  m=b->'identity';
  if not exists(select 1 from public.aula_findings where household_id=hid and id=(b->>'finding_id')::uuid) then raise exception 'AULA_FORBIDDEN'; end if;
  insert into private.aula_finding_identity(finding_id,household_id,origin_source_key,action_key,source_revision,material_revision)
  values((b->>'finding_id')::uuid,hid,m->>'origin_source_key',m->>'action_key',m->>'source_revision',m->>'material_revision') on conflict(finding_id) do nothing;
  if found then bound_count:=bound_count+1; end if;
 end loop;
 for x in select value from jsonb_array_elements(coalesce(p->'findings','[]')) loop
  people=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(x->'person_ids',case when nullif(x->>'person_id','') is null then '[]'::jsonb else jsonb_build_array(x->>'person_id') end)) order by 1);
  if cardinality(people)>30 or exists(select 1 from unnest(people) pid where not exists(select 1 from public.aula_child_mappings where household_id=hid and person_id=pid)) then raise exception 'AULA_UNMAPPED_PERSON'; end if;
  m=x->'identity';target_key=x->>'source_key';superseded:=null;saved_id:=null;
  if m is not null then
   -- Lock the actual finding, so a simultaneous ignore/accept cannot be reset.
   select f.* into existing from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id
    where f.household_id=hid and i.household_id=hid and i.action_key=m->>'action_key' and i.origin_source_key=m->>'origin_source_key'
    and (f.status in ('accepted','ignored') or f.created_calendar_item_id is not null
     or exists(select 1 from public.calendar_items c where c.household_id=hid and (c.data->>'aulaFindingId'=f.id::text or c.data->>'aulaSourceKey'=f.source_key)))
    order by f.updated_at desc,f.id desc limit 1 for update of f;
   if found then
    select * into prior_identity from private.aula_finding_identity where finding_id=existing.id and household_id=hid;
    if prior_identity.source_revision=m->>'source_revision' or prior_identity.material_revision=m->>'material_revision' then
     if existing.status='ignored' then ignored_count:=ignored_count+1;else accepted_count:=accepted_count+1;end if;
     continue;
    end if;
    superseded:=existing.id;
   end if;
   select f.* into existing from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id
    where f.household_id=hid and i.household_id=hid and i.action_key=m->>'action_key' and i.origin_source_key=m->>'origin_source_key'
    and f.status='new' order by f.created_at,f.id limit 1 for update of f;
   if found then target_key:=existing.source_key;refreshed_count:=refreshed_count+1;
   elsif superseded is not null then updated_count:=updated_count+1;
   else inserted_count:=inserted_count+1;end if;
   -- A later reversion to an older reviewed revision is itself a real update.
   -- Keep the old decision immutable and bind the new row to the latest review.
   if superseded is not null and exists(select 1 from public.aula_findings where household_id=hid and source_key=target_key and status in ('accepted','ignored')) then
    target_key:=encode(sha256(convert_to(target_key||':'||superseded::text,'UTF8')),'hex');
   end if;
  end if;
  insert into public.aula_findings(household_id,person_id,person_ids,source_kind,source_key,type,title,date,time,end_date,end_time,location,confidence,reason,summary,proposed_action,source_updated_at)
  values(hid,case when cardinality(people)=1 then people[1] end,people,x->>'source_kind',target_key,x->>'type',x->>'title',nullif(x->>'date','')::date,nullif(x->>'time',''),nullif(x->>'end_date','')::date,nullif(x->>'end_time',''),coalesce(x->>'location',''),x->>'confidence',x->>'reason',x->>'summary',x->>'proposed_action',nullif(x->>'source_updated_at','')::timestamptz)
  on conflict(household_id,source_key) do update set person_id=excluded.person_id,person_ids=excluded.person_ids,type=excluded.type,title=excluded.title,date=excluded.date,time=excluded.time,end_date=excluded.end_date,end_time=excluded.end_time,location=excluded.location,confidence=excluded.confidence,reason=excluded.reason,summary=excluded.summary,proposed_action=excluded.proposed_action,source_updated_at=excluded.source_updated_at,updated_at=now() where aula_findings.status='new'
  returning id into saved_id;
  if saved_id is not null and m is not null then
   insert into private.aula_finding_identity(finding_id,household_id,origin_source_key,action_key,source_revision,material_revision,supersedes)
   values(saved_id,hid,m->>'origin_source_key',m->>'action_key',m->>'source_revision',m->>'material_revision',superseded)
   on conflict(finding_id) do update set origin_source_key=excluded.origin_source_key,action_key=excluded.action_key,source_revision=excluded.source_revision,material_revision=excluded.material_revision,supersedes=excluded.supersedes;
  end if;
  if x->>'reference'='true' and saved_id is not null then
   reference_stored:=reference_stored+1;reference_new:=reference_new+1;
   if x->>'date'=x->>'reference_date' then reference_date:=reference_date+1;end if;
   reference_people:=reference_people+1;
  end if;
 end loop;
 -- Clean only a proven same-origin/action/revision pending duplicate. Historical
 -- decisions and calendar items remain byte-for-byte unchanged.
 with latest_review as (
  select distinct on(ri.origin_source_key,ri.action_key) ri.* from private.aula_finding_identity ri join public.aula_findings r on r.id=ri.finding_id
  where ri.household_id=hid and r.household_id=hid and r.status in ('accepted','ignored') order by ri.origin_source_key,ri.action_key,r.updated_at desc,r.id desc
 ),duplicates as (
  select f.id from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id
  where f.household_id=hid and f.status='new' and exists(
   select 1 from latest_review ri where ri.origin_source_key=i.origin_source_key and ri.action_key=i.action_key
    and (ri.source_revision=i.source_revision or ri.material_revision=i.material_revision)))
 update public.aula_findings f set status='stale',updated_at=now() where f.household_id=hid and f.status='new' and f.id in(select id from duplicates);
 get diagnostics cleaned=row_count;
 with ranked as (
  select f.id,row_number() over(partition by i.origin_source_key,i.action_key,i.material_revision order by f.created_at,f.id) ordinal
  from public.aula_findings f join private.aula_finding_identity i on i.finding_id=f.id and i.household_id=hid
  where f.household_id=hid and f.status='new')
 update public.aula_findings f set status='stale',updated_at=now() where f.household_id=hid and f.status='new' and f.id in(select id from ranked where ordinal>1);
 get diagnostics pending_cleaned=row_count;cleaned:=cleaned+pending_cleaned;
 return jsonb_build_object('findings_stored',inserted_count+updated_count+refreshed_count,'previously_ignored',ignored_count,'previously_accepted',accepted_count,'duplicates_suppressed',ignored_count+accepted_count,'old_duplicates_cleaned',cleaned,'legitimate_new',inserted_count,'material_updates',updated_count,'pending_refreshed',refreshed_count,'legacy_bound',bound_count,'reference_stored',reference_stored,'reference_new',reference_new,'reference_date_matches',reference_date,'reference_people_match',reference_people);
end $$;
revoke all on function private.aula_store_findings(uuid,jsonb) from public,anon,authenticated;

create or replace function private.aula_server(action text,hid uuid,uid uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f private.aula_login_flows; c private.aula_credentials; l private.aula_scan_locks;
 x jsonb; result jsonb; fid uuid; code text; saved_status text; people uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
 if action not in ('scan_claim','scan_credentials','scan_save_session','scan_finish','scan_fail','scan_memory') and not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 if uid is not null and not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 if action='begin' then
  delete from private.aula_login_attempts where attempted_at<now()-interval '1 day';
  if (select count(*) from private.aula_login_attempts where (household_id=hid or user_id=uid) and attempted_at>now()-interval '15 minutes')>=4 then raise exception 'AULA_RATE_LIMIT'; end if;
  if exists(select 1 from private.aula_login_flows where household_id=hid and expires_at>now()) or exists(select 1 from private.aula_scan_locks where household_id=hid and expires_at>now()) then raise exception 'AULA_BUSY'; end if;
  insert into private.aula_login_attempts(household_id,user_id) values(hid,uid);
  delete from private.aula_login_flows where household_id=hid;
  insert into public.aula_connections(household_id,created_by,status) values(hid,uid,'connecting') on conflict(household_id) do update set status='connecting',last_error_code=null,updated_at=now();
  insert into private.aula_login_flows(household_id,user_id) values(hid,uid) returning id into fid;
  return jsonb_build_object('flow_id',fid);
 elsif action in ('flow','identity_wait','identity_choose','finish','cancel') then
  select * into f from private.aula_login_flows where id=(p->>'flow_id')::uuid and household_id=hid and user_id=uid;
  if f.id is null or f.expires_at<=now() then raise exception 'AULA_FLOW_EXPIRED'; end if;
  if action='flow' then return jsonb_build_object('selected_identity',f.selected_identity); end if;
  if action='identity_wait' then
   if (p->>'count')::int not between 1 and 30 then raise exception 'AULA_INVALID_IDENTITY'; end if;
   update private.aula_login_flows set status='identity',identity_count=(p->>'count')::int where id=f.id; return '{}';
  elsif action='identity_choose' then
   if f.status<>'identity' or (p->>'index')::int not between 1 and f.identity_count or p->>'index' is null then raise exception 'AULA_INVALID_IDENTITY'; end if;
   update private.aula_login_flows set selected_identity=(p->>'index')::int where id=f.id and selected_identity is null; return '{}';
  elsif action='finish' then
   insert into private.aula_credentials(household_id,encrypted_session) values(hid,p->'encrypted_session') on conflict(household_id) do update set encrypted_session=excluded.encrypted_session,generation=gen_random_uuid(),updated_at=now();
   update public.aula_connections set status='connected',identity_label=left(p->>'identity_label',120),connected_at=now(),last_error_code=null,updated_at=now() where household_id=hid;
  else
   code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else null end;
   update public.aula_connections set status=case when exists(select 1 from private.aula_credentials where household_id=hid) then 'connected' else 'disconnected' end,last_error_code=code,updated_at=now() where household_id=hid;
  end if;
  delete from private.aula_login_flows where id=f.id; return '{}';
 elsif action='status' then
  delete from private.aula_login_flows where household_id=hid and expires_at<=now();
  update public.aula_connections set status=case when exists(select 1 from private.aula_credentials where household_id=hid) then 'connected' else 'disconnected' end,last_error_code='AULA_TIMEOUT',updated_at=now() where household_id=hid and status='connecting' and not exists(select 1 from private.aula_login_flows where household_id=hid);
  return jsonb_build_object('connection',(select to_jsonb(a) from public.aula_connections a where household_id=hid),'mappings',coalesce((select jsonb_agg(to_jsonb(m)) from public.aula_child_mappings m where household_id=hid),'[]'::jsonb),'findings',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('review_state',case when exists(select 1 from private.aula_finding_identity vi where vi.finding_id=v.id and vi.household_id=hid and vi.supersedes is not null) then 'UPDATED' else 'NEW' end) order by v.date nulls last,v.created_at desc) from public.aula_findings v where household_id=hid and (v.status='new' or v.updated_at>now()-interval '14 days')),'[]'::jsonb),'scanning',exists(select 1 from private.aula_scan_locks where household_id=hid and expires_at>now()));
 elsif action='disconnect' then
  delete from private.aula_credentials where household_id=hid;
  delete from private.aula_login_flows where household_id=hid;
  delete from private.aula_scan_locks where household_id=hid;
  update public.aula_connections set status='disconnected',identity_label=null,last_error_code=null,updated_at=now() where household_id=hid;
  return '{}';
 elsif action='scan_claim' then
  if exists(select 1 from private.aula_login_flows where household_id=hid and expires_at>now()) then raise exception 'AULA_BUSY'; end if;
  select * into c from private.aula_credentials where household_id=hid;
  if c.household_id is null then raise exception 'AULA_REAUTH_REQUIRED'; end if;
  delete from private.aula_scan_locks where household_id=hid and expires_at<=now();
  if exists(select 1 from private.aula_scan_locks where household_id=hid) then raise exception 'AULA_BUSY'; end if;
  insert into private.aula_scan_locks(household_id,generation) values(hid,c.generation) returning * into l;
  select last_success_at::text into saved_status from public.aula_connections where household_id=hid;
  update public.aula_connections set last_scan_at=now(),updated_at=now() where household_id=hid;
  return jsonb_build_object('lease',l.lease,'encrypted_session',c.encrypted_session,'last_success_at',saved_status,'mappings',coalesce((select jsonb_agg(to_jsonb(m)) from public.aula_child_mappings m where household_id=hid),'[]'::jsonb));
 elsif action in ('scan_credentials','scan_save_session','scan_finish','scan_fail','scan_memory') then
  select * into l from private.aula_scan_locks where household_id=hid and lease=(p->>'lease')::uuid and expires_at>now();
  select * into c from private.aula_credentials where household_id=hid;
  if l.lease is null or c.generation is distinct from l.generation then raise exception 'AULA_LEASE_EXPIRED'; end if;
  if action='scan_memory' then
   if (select count(*) from public.aula_findings where household_id=hid)>5000 then raise exception 'AULA_MEMORY_LIMIT'; end if;
   return jsonb_build_object('findings',coalesce((select jsonb_agg(to_jsonb(af)||jsonb_build_object('identity',to_jsonb(i))) from public.aula_findings af left join private.aula_finding_identity i on i.finding_id=af.id and i.household_id=hid where af.household_id=hid),'[]'::jsonb));
  elsif action='scan_credentials' then return c.encrypted_session;
  elsif action='scan_save_session' then update private.aula_credentials set encrypted_session=p->'encrypted_session',updated_at=now() where household_id=hid; return '{}';
  elsif action='scan_finish' then
   for x in select value from jsonb_array_elements(coalesce(p->'children','[]')) loop
    insert into public.aula_child_mappings(household_id,provider_child_key,display_name,school,class_name,group_names)
    values(hid,x->>'provider_child_key',left(x->>'display_name',120),left(coalesce(x->>'school',''),200),left(coalesce(x->>'class_name',''),80),array(select jsonb_array_elements_text(coalesce(x->'group_names','[]'))))
    on conflict(household_id,provider_child_key) do update set display_name=excluded.display_name,school=excluded.school,class_name=excluded.class_name,group_names=excluded.group_names,updated_at=now();
   end loop;
   result:=private.aula_store_findings(hid,p);
   update public.aula_findings set status='stale',updated_at=now() where household_id=hid and status='new' and date<current_date-7;
   update public.aula_connections set status='connected',api_version=(p->>'api_version')::int,last_success_at=now(),last_error_code=null,scan_counts=coalesce(p->'counts','{}')||result,updated_at=now() where household_id=hid;
  else
   code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else 'AULA_TEMPORARY_ERROR' end;
   update public.aula_connections set status=case when code in ('AULA_REAUTH_REQUIRED','AULA_SESSION_INVALID') then 'reauth_required' else 'connected' end,last_error_code=code,updated_at=now() where household_id=hid;
  end if;
  delete from private.aula_scan_locks where household_id=hid and lease=l.lease; return jsonb_build_object('memory_counts',coalesce(result,'{}')); 
 end if;
 raise exception 'AULA_INVALID_ACTION';
end $$;
