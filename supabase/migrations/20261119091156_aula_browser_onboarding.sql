-- Short-lived, server-only PKCE transaction. Existing Aula credentials and
-- mappings are changed only by the already verified handoff finish contract.
create table private.aula_browser_flows (
 id uuid primary key references private.aula_handoffs(id) on delete cascade,
 state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 encrypted_flow jsonb check(encrypted_flow is null or (jsonb_typeof(encrypted_flow)='object' and octet_length(encrypted_flow::text)<12000)),
 completion_hash text check(completion_hash ~ '^[a-f0-9]{64}$'),
 encrypted_session jsonb check(encrypted_session is null or (jsonb_typeof(encrypted_session)='object' and octet_length(encrypted_session::text)<100000)),
 native boolean not null default false,
 created_at timestamptz not null default now()
);
alter table private.aula_browser_flows enable row level security;
revoke all on private.aula_browser_flows from public,anon,authenticated,service_role;

create function private.aula_browser_server(action text,hid uuid,uid uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h private.aula_handoffs; f private.aula_browser_flows; result jsonb;
begin
 -- Expired ciphertext is never usable, even before this lazy physical cleanup.
 delete from private.aula_browser_flows where created_at<now()-interval '10 minutes';
 if action='start' then
  if not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501';end if;
  if coalesce(p->>'state_hash','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p->'encrypted_flow') is distinct from 'object' or p->'encrypted_flow'->>'version' is distinct from '1' then raise exception 'INVALID_REQUEST';end if;
  result:=private.aula_handoff_server('create',hid,uid,jsonb_build_object('token_hash',p->>'state_hash'));
  if result ? 'error' then return result;end if;
  insert into private.aula_browser_flows(id,state_hash,encrypted_flow,native) values((result->>'id')::uuid,p->>'state_hash',p->'encrypted_flow',coalesce((p->>'native')::boolean,false));
  return result;
 elsif action='claim' then
  -- Reuse the existing bounded global rate counter and single-use claim.
  result:=private.aula_handoff_server('claim',null,null,jsonb_build_object('token_hash',p->>'state_hash'));
  if result ? 'error' then return result;end if;
  select * into f from private.aula_browser_flows where id=(result->>'id')::uuid for update;
  if f.id is null or f.encrypted_flow is null then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  update private.aula_browser_flows set encrypted_flow=null where id=f.id;
  return result||jsonb_build_object('encrypted_flow',f.encrypted_flow,'native',f.native);
 elsif action in ('prepare','finish') then
  if not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
  select * into h from private.aula_handoffs where id=(p->>'id')::uuid and household_id=hid and created_by=uid for update;
  select * into f from private.aula_browser_flows where id=h.id for update;
  if h.id is null or f.id is null or h.used_at is null or h.revoked_at is not null or h.completed_at is not null or h.expires_at<=now() or h.used_at<now()-interval '90 seconds' then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  if action='prepare' then
   if h.claim_id is distinct from (p->>'claim_id')::uuid or f.completion_hash is not null or coalesce(p->>'completion_hash','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p->'encrypted_session') is distinct from 'object' or octet_length((p->'encrypted_session')::text)>100000 then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
   update private.aula_browser_flows set completion_hash=p->>'completion_hash',encrypted_session=p->'encrypted_session' where id=h.id;
   update private.aula_handoffs set used_at=now() where id=h.id;
   return jsonb_build_object('prepared',true);
  end if;
  -- The completion proof is delivered to the originating browser/app only.
  -- Polling never exposes it; JWT, household and initiating adult are rechecked.
  if f.completion_hash is null or f.completion_hash is distinct from p->>'completion_hash' or f.encrypted_session is null then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  result:=private.aula_handoff_server('finish',hid,uid,jsonb_build_object('id',h.id,'claim_id',h.claim_id,'encrypted_session',f.encrypted_session));
  if not(result ? 'error') then delete from private.aula_browser_flows where id=h.id;end if;
  return result;
 elsif action in ('status','cancel') then
  if not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501';end if;
  select * into h from private.aula_handoffs where id=(p->>'id')::uuid and household_id=hid and created_by=uid;
  if h.id is null then return jsonb_build_object('error','AULA_HANDOFF_INVALID');end if;
  if action='cancel' then
   update private.aula_handoffs set revoked_at=now() where id=h.id and completed_at is null;
   delete from private.aula_browser_flows where id=h.id;
   return jsonb_build_object('cancelled',true);
  end if;
  return jsonb_build_object('connected',h.completed_at is not null,'expired',h.revoked_at is not null or h.expires_at<=now() or (h.used_at is not null and h.used_at<now()-interval '90 seconds' and h.completed_at is null));
 end if;
 raise exception 'INVALID_REQUEST';
end;
$$;
revoke all on function private.aula_browser_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.aula_browser_server(text,uuid,uuid,jsonb) to service_role;
create function public.aula_browser_server(p_action text,p_household_id uuid,p_user_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.aula_browser_server(p_action,p_household_id,p_user_id,p_payload); $$;
revoke all on function public.aula_browser_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.aula_browser_server(text,uuid,uuid,jsonb) to service_role;
