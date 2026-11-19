-- Proven failure: deleting an Aula connector account in a retained household
-- failed with 23503 on aula_connections_created_by_fkey. No rows are rewritten
-- by installing these constraints/triggers; cleanup runs only on user deletion.
begin;
-- Household cascades remove mappings/findings and people in one transaction.
-- Defer person FK checks until all cascade actions have finished.
alter table public.aula_child_mappings alter constraint aula_child_mappings_household_id_person_id_fkey deferrable initially deferred;
alter table public.aula_findings alter constraint aula_findings_household_id_person_id_fkey deferrable initially deferred;
alter table private.aula_handoffs drop constraint aula_handoffs_created_by_fkey, add constraint aula_handoffs_created_by_fkey foreign key(created_by) references auth.users(id) on delete cascade;
alter table private.aula_login_attempts drop constraint aula_login_attempts_user_id_fkey, add constraint aula_login_attempts_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
alter table private.aula_login_flows drop constraint aula_login_flows_user_id_fkey, add constraint aula_login_flows_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
alter table public.aula_connections alter column created_by drop not null;
alter table public.aula_connections drop constraint aula_connections_created_by_fkey, add constraint aula_connections_created_by_fkey foreign key(created_by) references auth.users(id) on delete set null;
create function private.aula_connector_deleted() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.created_by is not null and new.created_by is null then
  perform pg_advisory_xact_lock(hashtextextended('aula:'||new.household_id::text,0));
  delete from private.aula_credentials where household_id=new.household_id;
  delete from private.aula_scan_locks where household_id=new.household_id;
  delete from private.aula_login_flows where household_id=new.household_id;
  update private.aula_handoffs set revoked_at=now() where household_id=new.household_id and revoked_at is null and completed_at is null;
  delete from private.aula_browser_flows where id in (select id from private.aula_handoffs where household_id=new.household_id);
  new.status:='disconnected';new.identity_label:=null;new.last_error_code:=null;new.updated_at:=now();
 end if;
 return new;
end;
$$;
revoke all on function private.aula_connector_deleted() from public,anon,authenticated,service_role;
create trigger aula_connector_deleted before update of created_by on public.aula_connections for each row execute function private.aula_connector_deleted();

-- Attribute newly verified sessions to their actual connecting adult, not the
-- first adult ever to create this family's connection. Refresh does not change it.
CREATE OR REPLACE FUNCTION private.aula_handoff_server(action text, hid uuid, uid uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h private.aula_handoffs; bucket private.aula_handoff_rate;
begin
 if action='create' then
  if not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('aula-handoff-creator:'||uid::text,0));
  perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
  if (select count(*) from private.aula_handoffs where (household_id=hid or created_by=uid) and created_at>now()-interval '15 minutes')>=4 then return jsonb_build_object('error','AULA_RATE_LIMIT');end if;
  if coalesce(p->>'token_hash','')!~'^[a-f0-9]{64}$' then raise exception 'INVALID_REQUEST';end if;
  update private.aula_handoffs set revoked_at=now() where household_id=hid and revoked_at is null and completed_at is null;
  insert into public.aula_connections(household_id,created_by) values(hid,uid) on conflict do nothing;
  insert into private.aula_handoffs(household_id,created_by,token_hash) values(hid,uid,p->>'token_hash') returning * into h;
  return jsonb_build_object('id',h.id,'expires_at',h.expires_at);
 elsif action='claim' then
  select * into bucket from private.aula_handoff_rate where id for update;
  if bucket.window_start<=now()-interval '1 minute' then update private.aula_handoff_rate set window_start=now(),attempts=1 where id;
  elsif bucket.attempts>=30 then return jsonb_build_object('error','AULA_RATE_LIMIT');
  else update private.aula_handoff_rate set attempts=attempts+1 where id;end if;
  select * into h from private.aula_handoffs where token_hash=p->>'token_hash';
  if h.id is null then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  perform pg_advisory_xact_lock(hashtextextended('aula:'||h.household_id::text,0));
  select * into h from private.aula_handoffs where id=h.id for update;
  if h.used_at is not null or h.revoked_at is not null or h.expires_at<=now() or not private.aula_adult(h.household_id,h.created_by) then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  update private.aula_handoffs set used_at=now(),claim_id=gen_random_uuid() where id=h.id returning * into h;
  return jsonb_build_object('id',h.id,'household_id',h.household_id,'created_by',h.created_by,'claim_id',h.claim_id);
 elsif action='finish' then
  perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
  select * into h from private.aula_handoffs where id=(p->>'id')::uuid and household_id=hid and created_by=uid and claim_id=(p->>'claim_id')::uuid for update;
  if h.id is null or h.used_at is null or h.used_at<now()-interval '90 seconds' or h.completed_at is not null or h.revoked_at is not null or h.expires_at<=now() or not private.aula_adult(hid,uid) then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  if exists(select 1 from private.aula_scan_locks where household_id=hid and expires_at>now()) or exists(select 1 from private.aula_login_flows where household_id=hid and expires_at>now()) then return jsonb_build_object('error','AULA_BUSY');end if;
  if jsonb_typeof(p->'encrypted_session') is distinct from 'object' or p->'encrypted_session'->>'version' is distinct from '1' then raise exception 'INVALID_REQUEST';end if;
  insert into private.aula_credentials(household_id,encrypted_session) values(hid,p->'encrypted_session') on conflict(household_id) do update set encrypted_session=excluded.encrypted_session,generation=gen_random_uuid(),updated_at=now();
  update public.aula_connections set created_by=uid,status='connected',identity_label=nullif(left(p->>'identity_label',120),''),connected_at=now(),last_error_code=null,updated_at=now() where household_id=hid;
  update private.aula_handoffs set completed_at=now() where id=h.id;
  return jsonb_build_object('connected',true);
 end if;
 raise exception 'INVALID_REQUEST';
end;
$function$;

CREATE OR REPLACE FUNCTION private.aula_server(action text, hid uuid, uid uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   update public.aula_connections set created_by=uid,status='connected',identity_label=left(p->>'identity_label',120),connected_at=now(),last_error_code=null,updated_at=now() where household_id=hid;
  else
   code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else null end;
   update public.aula_connections set status=case when exists(select 1 from private.aula_credentials where household_id=hid) then 'connected' else 'disconnected' end,last_error_code=code,updated_at=now() where household_id=hid;
  end if;
  delete from private.aula_login_flows where id=f.id; return '{}';
 elsif action='status' then
  delete from private.aula_login_flows where household_id=hid and expires_at<=now();
  update public.aula_connections set status=case when exists(select 1 from private.aula_credentials where household_id=hid) then 'connected' else 'disconnected' end,last_error_code='AULA_TIMEOUT',updated_at=now() where household_id=hid and status='connecting' and not exists(select 1 from private.aula_login_flows where household_id=hid);
  return jsonb_build_object('connection',(select to_jsonb(a) from public.aula_connections a where household_id=hid),'mappings',coalesce((select jsonb_agg(to_jsonb(m)) from public.aula_child_mappings m where household_id=hid),'[]'::jsonb),'findings',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('review_state',case when exists(select 1 from private.aula_finding_identity vi where vi.finding_id=v.id and vi.household_id=hid and vi.supersedes is not null) then 'UPDATED' else 'NEW' end) order by v.date nulls last,v.created_at desc) from public.aula_findings v where household_id=hid and ((v.status='new' and private.aula_review_current(v.date,v.end_date,v.expires_on)) or (v.status<>'new' and v.updated_at>now()-interval '14 days'))),'[]'::jsonb),'scanning',exists(select 1 from private.aula_scan_locks where household_id=hid and expires_at>now()));
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
   return jsonb_build_object('findings',coalesce((select jsonb_agg(to_jsonb(af)||jsonb_build_object('identity',to_jsonb(i),'automatically_expired',exists(select 1 from private.aula_expired_findings ex where ex.finding_id=af.id),'components',coalesce((select jsonb_agg(to_jsonb(rc)) from private.aula_review_components rc where rc.finding_id=af.id and rc.household_id=hid),'[]'::jsonb))) from public.aula_findings af left join private.aula_finding_identity i on i.finding_id=af.id and i.household_id=hid where af.household_id=hid),'[]'::jsonb));
  elsif action='scan_credentials' then return c.encrypted_session;
  elsif action='scan_save_session' then update private.aula_credentials set encrypted_session=p->'encrypted_session',updated_at=now() where household_id=hid; return '{}';
  elsif action='scan_finish' then
   for x in select value from jsonb_array_elements(coalesce(p->'children','[]')) loop
    insert into public.aula_child_mappings(household_id,provider_child_key,display_name,school,class_name,group_names)
    values(hid,x->>'provider_child_key',left(x->>'display_name',120),left(coalesce(x->>'school',''),200),left(coalesce(x->>'class_name',''),80),array(select jsonb_array_elements_text(coalesce(x->'group_names','[]'))))
    on conflict(household_id,provider_child_key) do update set display_name=excluded.display_name,school=excluded.school,class_name=excluded.class_name,group_names=excluded.group_names,updated_at=now();
   end loop;
   perform private.aula_expire_findings(hid);
   result:=private.aula_store_findings(hid,p);
   perform private.aula_expire_findings(hid);
   update public.aula_connections set status='connected',api_version=(p->>'api_version')::int,last_success_at=now(),last_error_code=null,scan_counts=coalesce(p->'counts','{}')||result,updated_at=now() where household_id=hid;
  else
   code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else 'AULA_TEMPORARY_ERROR' end;
   update public.aula_connections set status=case when code in ('AULA_REAUTH_REQUIRED','AULA_SESSION_INVALID') then 'reauth_required' else 'connected' end,last_error_code=code,updated_at=now() where household_id=hid;
  end if;
  delete from private.aula_scan_locks where household_id=hid and lease=l.lease; return jsonb_build_object('memory_counts',coalesce(result,'{}'));
 end if;
 raise exception 'AULA_INVALID_ACTION';
end $function$;

commit;
