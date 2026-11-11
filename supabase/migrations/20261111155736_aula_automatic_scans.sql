-- Additive scheduling state. Existing scanner, decisions and credentials remain authoritative.
begin;
create table private.aula_schedule_config (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 endpoint text not null default 'https://familiekalender-alpha.vercel.app/api/aula-scan'
 check(endpoint='https://familiekalender-alpha.vercel.app/api/aula-scan'),
 setup_hash bytea, setup_expires_at timestamptz, configured_at timestamptz, last_tick_at timestamptz
);
insert into private.aula_schedule_config(singleton) values(true);
create table private.aula_scheduled_scans (
 household_id uuid not null references public.aula_connections(household_id) on delete cascade,
 slot text not null check(slot ~ '^\d{4}-\d{2}-\d{2}:(morning|afternoon)$'),
 status text not null default 'queued' check(status in ('queued','running','success','partial','reauth','skipped','failed')),
 attempts int not null default 0, request_id bigint, lease uuid,
 queued_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 code text check(code is null or code ~ '^AULA_[A-Z_]+$'), duration_ms int,
 primary key(household_id,slot)
);
create index aula_scheduled_pending on private.aula_scheduled_scans(queued_at) where status in ('queued','running');
create table private.aula_source_checkpoints (
 household_id uuid not null references public.aula_connections(household_id) on delete cascade,
 source_key text not null check(source_key ~ '^[a-f0-9]{64}$'),
 revision text not null check(revision ~ '^[a-f0-9]{64}$'), processed_at timestamptz not null default now(),
 primary key(household_id,source_key)
);
alter table private.aula_schedule_config enable row level security;
alter table private.aula_scheduled_scans enable row level security;
alter table private.aula_source_checkpoints enable row level security;
revoke all on private.aula_schedule_config,private.aula_scheduled_scans,private.aula_source_checkpoints from public,anon,authenticated;

-- Local date + slot are stable identities across CET/CEST. A one-hour catch-up window.
create function private.aula_due_slot(at_time timestamptz) returns text language sql stable set search_path='' as $$
 select case when wall::time>='06:00' and wall::time<'07:00' then wall::date::text||':morning'
 when wall::time>='15:30' and wall::time<'16:30' then wall::date::text||':afternoon' end
 from (select at_time at time zone 'Europe/Copenhagen' wall)s
$$;
revoke all on function private.aula_due_slot(timestamptz) from public,anon,authenticated;

-- Service-only bridge: original scan_claim/scan_finish transactions are reused.
create function public.aula_scheduler(p_action text,p_household_id uuid default null,p_user_id uuid default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare hid uuid:=p_household_id; p jsonb:=coalesce(p_payload,'{}'); cfg private.aula_schedule_config;
 s private.aula_scheduled_scans; result jsonb; row_value jsonb; secret_id uuid; error_code text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'AULA_FORBIDDEN' using errcode='42501';end if;
 if p_action='setup' then
  select * into cfg from private.aula_schedule_config where singleton for update;
  if cfg.setup_expires_at is null or cfg.setup_expires_at<now() or cfg.setup_hash is distinct from extensions.digest(coalesce(p->>'token',''),'sha256') then raise exception 'AULA_UNAUTHORIZED';end if;
  if length(coalesce(p->>'secret',''))<32 or length(p->>'secret')>512 then raise exception 'AULA_NOT_CONFIGURED';end if;
  select id into secret_id from vault.secrets where name='aula_sync_secret';
  if secret_id is null then perform vault.create_secret(p->>'secret','aula_sync_secret');else perform vault.update_secret(secret_id,p->>'secret');end if;
  update private.aula_schedule_config set configured_at=now(),setup_hash=null,setup_expires_at=null where singleton;
  return '{"configured":true}';
 end if;
 if p_action='status' then
  if not private.aula_adult(hid,p_user_id) then raise exception 'AULA_FORBIDDEN';end if;
  return jsonb_build_object('active',exists(select 1 from private.aula_schedule_config c where c.enabled and c.configured_at is not null and exists(select 1 from cron.job j where j.jobname='aula-auto-scan' and j.active)));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
 if p_action='claim' then
  select * into s from private.aula_scheduled_scans where household_id=hid and slot=p->>'slot' for update;
  if s.household_id is null then raise exception 'AULA_INVALID_SLOT';end if;
  if s.status<>'queued' then return '{"skip":"duplicate"}';end if;
  if not exists(select 1 from private.aula_schedule_config where enabled) or not exists(select 1 from public.aula_connections where household_id=hid and status='connected') then
   update private.aula_scheduled_scans set status='skipped',finished_at=now() where household_id=hid and slot=s.slot;return '{"skip":"ineligible"}';
  end if;
  begin result:=private.aula_server('scan_claim',hid,null,'{}');
  exception when others then
   error_code:=case when sqlerrm='AULA_BUSY' then 'AULA_BUSY' when sqlerrm='AULA_REAUTH_REQUIRED' then 'AULA_REAUTH_REQUIRED' else 'AULA_STORAGE_ERROR' end;
   if error_code='AULA_REAUTH_REQUIRED' then update public.aula_connections set status='reauth_required',last_error_code=error_code,updated_at=now() where household_id=hid;end if;
   update private.aula_scheduled_scans set status=case when error_code='AULA_BUSY' then 'skipped' when error_code='AULA_REAUTH_REQUIRED' then 'reauth' else 'failed' end,code=error_code,finished_at=now() where household_id=hid and slot=s.slot;
   return jsonb_build_object('skip',case when error_code='AULA_BUSY' then 'busy' when error_code='AULA_REAUTH_REQUIRED' then 'reauth' else 'failed' end);
  end;
  update private.aula_scheduled_scans set status='running',started_at=now(),lease=(result->>'lease')::uuid where household_id=hid and slot=s.slot;
  return result;
 elsif p_action='checkpoints' then
  if not exists(select 1 from private.aula_scan_locks where household_id=hid and lease=(p->>'lease')::uuid and expires_at>now()) then raise exception 'AULA_LEASE_EXPIRED';end if;
  return jsonb_build_object('sources',coalesce((select jsonb_agg(jsonb_build_object('source_key',c.source_key,'revision',c.revision)) from private.aula_source_checkpoints c where household_id=hid and processed_at>now()-interval '60 days'),'[]'::jsonb));
 elsif p_action='finish' then
  -- Cache only sources whose analysis completed; commit with the existing finding transaction.
  result:=private.aula_server('scan_finish',hid,p_user_id,p);
  if jsonb_array_length(coalesce(p->'checkpoints','[]'))>300 then raise exception 'AULA_INVALID_CHECKPOINTS';end if;
  for row_value in select value from jsonb_array_elements(coalesce(p->'checkpoints','[]')) loop
   insert into private.aula_source_checkpoints(household_id,source_key,revision) values(hid,row_value->>'source_key',row_value->>'revision')
   on conflict(household_id,source_key) do update set revision=excluded.revision,processed_at=now();
  end loop;
  delete from private.aula_source_checkpoints where household_id=hid and processed_at<now()-interval '60 days';
  update private.aula_scheduled_scans set status=case when coalesce((p#>>'{counts,partial}')::int,0)>0 then 'partial' else 'success' end,finished_at=now(),duration_ms=(p#>>'{counts,scan_duration_ms}')::int
   where household_id=hid and lease=(p->>'lease')::uuid and status='running';
  return result;
 elsif p_action='fail' then
  result:=private.aula_server('scan_fail',hid,p_user_id,p);
  update private.aula_scheduled_scans set status=case when p->>'error' in ('AULA_REAUTH_REQUIRED','AULA_SESSION_INVALID') then 'reauth' else 'failed' end,finished_at=now(),code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else 'AULA_TEMPORARY_ERROR' end
   where household_id=hid and lease=(p->>'lease')::uuid and status='running';return result;
 end if;
 raise exception 'AULA_INVALID_ACTION';
end $$;
revoke all on function public.aula_scheduler(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.aula_scheduler(text,uuid,uuid,jsonb) to service_role;

-- One-use setup capability copies the EXISTING Vercel secret to Vault, server-to-server.
-- No secret is returned to an operator, browser, migration, URL or log.
create function private.bootstrap_aula_scheduler() returns bigint language plpgsql security definer set search_path='' as $$
declare token text:=encode(extensions.gen_random_bytes(32),'hex'); request_id bigint; endpoint text;
begin
 select c.endpoint into endpoint from private.aula_schedule_config c where singleton for update;
 update private.aula_schedule_config set setup_hash=extensions.digest(token,'sha256'),setup_expires_at=now()+interval '10 minutes' where singleton;
 select net.http_post(url:=replace(endpoint,'/api/aula-scan','/api/aula-scheduler-setup'),headers:=jsonb_build_object('content-type','application/json','x-aula-setup',token),body:='{}',timeout_milliseconds:=30000) into request_id;
 return request_id;
end $$;
revoke all on function private.bootstrap_aula_scheduler() from public,anon,authenticated;

create function private.dispatch_aula_scans(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.aula_schedule_config; secret text; slot_id text; row_value record; sent_id bigint; queued int:=0; failed int:=0; eligible int:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('aula-scheduler-dispatch',0)) then return '{"skipped":1}';end if;
 select * into cfg from private.aula_schedule_config where singleton;
 if not cfg.enabled or cfg.configured_at is null then return '{"inactive":1}';end if;
 update private.aula_schedule_config set last_tick_at=now() where singleton;
 -- A started scan is never retried for the same slot. A failed delivery may retry before claim.
 update private.aula_scheduled_scans set status='failed',code='AULA_TIMEOUT',finished_at=now() where status='running' and started_at<now()-interval '6 minutes';
 update private.aula_scheduled_scans set status='failed',code='AULA_DELIVERY_FAILED',finished_at=now() where status='queued' and (queued_at<now()-interval '1 hour' or (attempts>=3 and queued_at<now()-interval '5 minutes'));
 slot_id:=private.aula_due_slot(at_time);if slot_id is null then return '{"outside_slot":1}';end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='aula_sync_secret';
 if length(coalesce(secret,''))<32 then return '{"not_configured":1}';end if;
 select count(*) into eligible from public.aula_connections where status='connected';
 insert into private.aula_scheduled_scans(household_id,slot)
  select c.household_id,slot_id from public.aula_connections c where c.status='connected'
  and not exists(select 1 from private.aula_scheduled_scans s where s.household_id=c.household_id and s.slot=slot_id)
  order by c.household_id limit 10 on conflict do nothing;
 for row_value in select s.household_id,s.slot from private.aula_scheduled_scans s join public.aula_connections c on c.household_id=s.household_id
  where s.slot=slot_id and s.status='queued' and c.status='connected' and s.attempts<3 and (s.attempts=0 or s.queued_at<now()-interval '5 minutes') order by s.queued_at limit 10 for update of s skip locked loop
  begin
   select net.http_post(url:=cfg.endpoint,headers:=jsonb_build_object('content-type','application/json','x-aula-sync-secret',secret),
    body:=jsonb_build_object('household_id',row_value.household_id,'scheduled_slot',slot_id,'full',false),timeout_milliseconds:=270000) into sent_id;
   update private.aula_scheduled_scans set request_id=sent_id,attempts=attempts+1,queued_at=now() where household_id=row_value.household_id and slot=row_value.slot;
   queued:=queued+1;
  exception when others then
   update private.aula_scheduled_scans set status='failed',code='AULA_DISPATCH_FAILED',finished_at=now() where household_id=row_value.household_id and slot=row_value.slot;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('slot',slot_id,'eligible',eligible,'dispatched',queued,'failed',failed);
end $$;
revoke all on function private.dispatch_aula_scans(timestamptz) from public,anon,authenticated;
select cron.schedule('aula-auto-scan','* * * * *','select private.dispatch_aula_scans();');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='aula-auto-scan';
commit;
