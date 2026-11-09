-- Additive handoff; only hashes, never provider tokens or plaintext codes.
create table private.aula_handoffs (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 created_by uuid not null references auth.users(id), token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes',
 used_at timestamptz, claim_id uuid, completed_at timestamptz, revoked_at timestamptz,
 check(expires_at<=created_at+interval '10 minutes')
);
create index aula_handoffs_household_created on private.aula_handoffs(household_id,created_at);
create index aula_handoffs_creator_created on private.aula_handoffs(created_by,created_at);
-- Fixed-size shared rate counter; no client IPs or secrets.
create table private.aula_handoff_rate(id boolean primary key default true check(id),window_start timestamptz not null,attempts integer not null);
insert into private.aula_handoff_rate values(true,now(),0);
alter table private.aula_handoffs enable row level security;
alter table private.aula_handoff_rate enable row level security;
revoke all on private.aula_handoffs,private.aula_handoff_rate from public,anon,authenticated,service_role;

create function private.aula_handoff_server(action text,hid uuid,uid uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  update public.aula_connections set status='connected',identity_label=nullif(left(p->>'identity_label',120),''),connected_at=now(),last_error_code=null,updated_at=now() where household_id=hid;
  update private.aula_handoffs set completed_at=now() where id=h.id;
  return jsonb_build_object('connected',true);
 end if;
 raise exception 'INVALID_REQUEST';
end;
$$;
revoke all on function private.aula_handoff_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.aula_handoff_server(text,uuid,uuid,jsonb) to service_role;
create function public.create_aula_handoff(p_household_id uuid,p_user_id uuid,p_token_hash text) returns jsonb
language sql security invoker set search_path='' as $$select private.aula_handoff_server('create',p_household_id,p_user_id,jsonb_build_object('token_hash',p_token_hash));$$;
create function public.aula_handoff_server(p_action text,p_household_id uuid,p_user_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.aula_handoff_server(p_action,p_household_id,p_user_id,p_payload);$$;
revoke all on function public.create_aula_handoff(uuid,uuid,text),public.aula_handoff_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_aula_handoff(uuid,uuid,text),public.aula_handoff_server(text,uuid,uuid,jsonb) to service_role;
-- Disconnect invalidates pending and in-flight handoffs, including a late verification.
create function private.aula_revoke_handoffs() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='disconnected' then update private.aula_handoffs set revoked_at=now() where household_id=new.household_id and revoked_at is null and completed_at is null;end if;
 return new;
end;
$$;
revoke all on function private.aula_revoke_handoffs() from public,anon,authenticated,service_role;
create trigger aula_disconnect_revokes_handoffs after update of status on public.aula_connections for each row execute function private.aula_revoke_handoffs();
