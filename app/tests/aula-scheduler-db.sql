create temp table scheduler_http(id bigint generated always as identity,url text,body jsonb,headers jsonb,timeout_ms int);
create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{"Content-Type":"application/json"}',timeout_milliseconds int default 5000)
returns bigint language plpgsql security definer set search_path='' as $$declare result bigint;begin
 if body->>'household_id'=current_setting('test.fail_household',true) then raise exception 'Synthetic delivery failure';end if;
 insert into pg_temp.scheduler_http(url,body,headers,timeout_ms) values(url,body,headers,timeout_milliseconds) returning id into result;return result;
end$$;
create temp table scheduler_assertions(name text);
create function pg_temp.check_that(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAILED: %',label;end if;
 insert into pg_temp.scheduler_assertions values(label);
end$$;
do $$
declare u uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); disconnected uuid:=gen_random_uuid(); reauth uuid:=gen_random_uuid(); no_aula uuid:=gen_random_uuid();
 result jsonb; lease uuid; token text; before_creds jsonb; n int; r record;
begin
 perform pg_temp.check_that(not (select active from cron.job where jobname='aula-auto-scan'),'Migration registers inactive job');
 for r in select * from (values
  ('2026-01-12T05:00:00Z','2026-01-12:morning'),('2026-01-12T14:30:00Z','2026-01-12:afternoon'),
  ('2026-07-12T04:00:00Z','2026-07-12:morning'),('2026-07-12T13:30:00Z','2026-07-12:afternoon'),
  ('2026-03-28T05:00:00Z','2026-03-28:morning'),('2026-03-29T04:00:00Z','2026-03-29:morning'),
  ('2026-10-24T04:00:00Z','2026-10-24:morning'),('2026-10-25T05:00:00Z','2026-10-25:morning'),
  ('2026-10-25T14:30:00Z','2026-10-25:afternoon'),('2026-03-29T13:30:00Z','2026-03-29:afternoon')) v(ts,slot)
 loop perform pg_temp.check_that(private.aula_due_slot(r.ts::timestamptz)=r.slot,'Copenhagen/DST '||r.ts);end loop;
 perform pg_temp.check_that(private.aula_due_slot('2026-11-12T04:59:59Z') is null and private.aula_due_slot('2026-11-12T06:00:00Z') is null,'Outside morning window');
 perform pg_temp.check_that(private.aula_due_slot('2026-11-12T14:29:59Z') is null and private.aula_due_slot('2026-11-12T15:30:00Z') is null,'Outside afternoon window');
 perform pg_temp.check_that(not has_function_privilege('anon','public.aula_scheduler(text,uuid,uuid,jsonb)','execute') and not has_function_privilege('authenticated','public.aula_scheduler(text,uuid,uuid,jsonb)','execute'),'Scheduler RPC service-only');
 perform pg_temp.check_that(not has_function_privilege('authenticated','private.bootstrap_aula_scheduler()','execute') and not has_function_privilege('anon','private.dispatch_aula_scans(timestamptz)','execute'),'No public bootstrap/dispatch');
 perform pg_temp.check_that(not has_table_privilege('authenticated','private.aula_source_checkpoints','select') and not has_table_privilege('anon','private.aula_scheduled_scans','select'),'Private state inaccessible');
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform public.aula_scheduler('setup');raise exception 'Allowed anonymous setup';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.role','service_role',true);
 begin perform public.aula_scheduler('setup',null,null,'{"token":"wrong","secret":"synthetic"}');raise exception 'Allowed wrong setup';exception when others then if sqlerrm<>'AULA_UNAUTHORIZED' then raise;end if;end;
 perform pg_temp.check_that(private.dispatch_aula_scans()?'inactive','Inactive scheduler sends nothing');
 perform private.bootstrap_aula_scheduler();select headers->>'x-aula-setup' into token from pg_temp.scheduler_http order by id desc limit 1;
 perform pg_temp.check_that(length(token)=64 and (select setup_hash=extensions.digest(token,'sha256') from private.aula_schedule_config),'Bootstrap capability hash only');
 update private.aula_schedule_config set setup_expires_at=now()-interval '1 second';
 begin perform public.aula_scheduler('setup',null,null,jsonb_build_object('token',token,'secret',repeat('s',64)));raise exception 'Allowed expired setup';exception when others then if sqlerrm<>'AULA_UNAUTHORIZED' then raise;end if;end;
 update private.aula_schedule_config set setup_expires_at=now()+interval '1 minute';
 perform public.aula_scheduler('setup',null,null,jsonb_build_object('token',token,'secret',repeat('s',64)));
 perform pg_temp.check_that((select setup_hash is null and setup_expires_at is null and configured_at is not null from private.aula_schedule_config),'Setup consumes capability');
 begin perform public.aula_scheduler('setup',null,null,jsonb_build_object('token',token,'secret',repeat('s',64)));raise exception 'Allowed replay';exception when others then if sqlerrm<>'AULA_UNAUTHORIZED' then raise;end if;end;
 perform pg_temp.check_that((select decrypted_secret=repeat('s',64) from vault.decrypted_secrets where name='aula_sync_secret'),'Existing secret copied to Vault');
 truncate pg_temp.scheduler_http;
 insert into auth.users(id,email_confirmed_at,is_anonymous) values(u,now(),false);
 insert into public.households(id,name,created_by) values(h,'Synthetic',u),(other,'Other',u),(disconnected,'Disconnected',u),(reauth,'Expired',u),(no_aula,'No Aula',u);
 insert into public.household_members(household_id,user_id,role) values(h,u,'owner'),(other,u,'owner') on conflict do nothing;
 insert into public.aula_connections(household_id,created_by,status) values(h,u,'connected'),(other,u,'connected'),(disconnected,u,'disconnected'),(reauth,u,'reauth_required');
 insert into private.aula_credentials(household_id,encrypted_session) values(h,'{"version":1,"ciphertext":"synthetic"}'),(other,'{"version":1,"ciphertext":"synthetic"}');
 select encrypted_session into before_creds from private.aula_credentials where household_id=h;
 -- Exclude pre-existing local fixtures; rolled back with everything else.
 update public.aula_connections set status='disconnected' where household_id not in(h,other,disconnected,reauth);
 update private.aula_schedule_config set enabled=true;
 perform cron.alter_job(jobid,active:=true) from cron.job where jobname='aula-auto-scan';
 perform pg_temp.check_that(public.aula_scheduler('status',h,u)->>'active'='true','Adult sees active automatic status');
 begin perform public.aula_scheduler('status',h,gen_random_uuid());raise exception 'Allowed outsider status';exception when others then if sqlerrm<>'AULA_FORBIDDEN' then raise;end if;end;
 result:=private.dispatch_aula_scans('2026-11-12T05:00:00Z');
 perform pg_temp.check_that(result->>'dispatched'='2' and result->>'eligible'='2','Only connected households dispatched');
 perform pg_temp.check_that((select count(*)=2 and bool_and(body->>'full'='false') and bool_and(headers->>'x-aula-sync-secret'=repeat('s',64)) and bool_and(timeout_ms=270000) from pg_temp.scheduler_http),'Bounded authenticated existing endpoint; incremental body');
 perform pg_temp.check_that(not exists(select 1 from private.aula_scheduled_scans where household_id in(disconnected,reauth,no_aula)),'Disconnected/reauth/no connection skipped');
 result:=private.dispatch_aula_scans('2026-11-12T05:01:00Z');perform pg_temp.check_that(result->>'dispatched'='0','Duplicate dispatcher does not redeliver immediately');
 -- A manual lease already exists: scheduled slot is consumed as busy.
 result:=private.aula_server('scan_claim',h,u,'{}');lease:=(result->>'lease')::uuid;
 result:=public.aula_scheduler('claim',h,null,'{"slot":"2026-11-12:morning"}');perform pg_temp.check_that(result->>'skip'='busy','Manual running -> scheduled skip');
 perform public.aula_scheduler('finish',h,u,jsonb_build_object('lease',lease,'api_version',25,'counts','{}'::jsonb));
 result:=public.aula_scheduler('claim',h,null,'{"slot":"2026-11-12:morning"}');perform pg_temp.check_that(result->>'skip'='duplicate','Skipped slot cannot run again');
 -- A scheduled lease blocks manual claims and duplicate scheduled deliveries.
 result:=public.aula_scheduler('claim',other,null,'{"slot":"2026-11-12:morning"}');lease:=(result->>'lease')::uuid;
 begin perform private.aula_server('scan_claim',other,u,'{}');raise exception 'Allowed parallel manual scan';exception when others then if sqlerrm<>'AULA_BUSY' then raise;end if;end;
 perform pg_temp.check_that(public.aula_scheduler('claim',other,null,'{"slot":"2026-11-12:morning"}')->>'skip'='duplicate','Automatic running blocks duplicate');
 perform public.aula_scheduler('finish',other,null,jsonb_build_object('lease',lease,'api_version',25,'counts',jsonb_build_object('partial',1,'scan_duration_ms',1234),'checkpoints',jsonb_build_array(jsonb_build_object('source_key',repeat('a',64),'revision',repeat('b',64)))));
 perform pg_temp.check_that((select status='partial' and duration_ms=1234 from private.aula_scheduled_scans where household_id=other and slot='2026-11-12:morning'),'Partial success persisted');
 perform pg_temp.check_that((select count(*)=1 from private.aula_source_checkpoints where household_id=other),'Successful sources checkpointed atomically');
 -- Invalid checkpoint rolls back original scan_finish and retains the lease for fail handling.
 result:=private.aula_server('scan_claim',other,u,'{}');lease:=(result->>'lease')::uuid;
 begin perform public.aula_scheduler('finish',other,null,jsonb_build_object('lease',lease,'api_version',25,'checkpoints','[{"source_key":"invalid","revision":"invalid"}]'::jsonb));raise exception 'Allowed invalid checkpoint';exception when check_violation then null;end;
 perform pg_temp.check_that(exists(select 1 from private.aula_scan_locks l where l.household_id=other),'Checkpoint failure rolls back scan transaction');
 perform public.aula_scheduler('fail',other,null,jsonb_build_object('lease',lease,'error','AULA_REAUTH_REQUIRED'));
 perform pg_temp.check_that((select status='reauth_required' from public.aula_connections where household_id=other),'Invalid refresh sets reauth');
 result:=private.dispatch_aula_scans('2026-11-12T14:30:00Z');perform pg_temp.check_that(result->>'eligible'='1','Expired session excluded from next slot');
 -- Disconnect between enqueue and delivery is checked again.
 update public.aula_connections set status='disconnected' where household_id=h;
 perform pg_temp.check_that(public.aula_scheduler('claim',h,null,'{"slot":"2026-11-12:afternoon"}')->>'skip'='ineligible','Disconnect race safely skipped');
 perform pg_temp.check_that((select encrypted_session=before_creds from private.aula_credentials where household_id=h),'Existing encrypted session preserved');
 -- Missing stored credentials do not cause an endless scheduled retry.
 update public.aula_connections set status='connected' where household_id=disconnected;
 perform private.dispatch_aula_scans('2026-11-13T05:00:00Z');
 perform pg_temp.check_that(public.aula_scheduler('claim',disconnected,null,'{"slot":"2026-11-13:morning"}')->>'skip'='reauth','Missing credentials stop future automatic scans');
 -- Multiple households fan out independently, never a 100-household sequential HTTP request.
 for n in 1..12 loop
  h:=gen_random_uuid();insert into public.households(id,name,created_by) values(h,'Scale fixture',u);insert into public.aula_connections(household_id,created_by,status) values(h,u,'connected');
 end loop;
 perform set_config('test.fail_household',h::text,true);
 result:=private.dispatch_aula_scans('2026-11-14T05:00:00Z');
 perform pg_temp.check_that((result->>'dispatched')::int+(result->>'failed')::int=10,'Fanout bounded to ten independent requests');
 result:=private.dispatch_aula_scans('2026-11-14T05:01:00Z');
 perform pg_temp.check_that((select count(*)=12 from private.aula_scheduled_scans where slot='2026-11-14:morning') and (select count(*)=1 from private.aula_scheduled_scans where slot='2026-11-14:morning' and code='AULA_DISPATCH_FAILED'),'One delivery failure does not stop other households');
 perform pg_temp.check_that(not exists(select 1 from public.calendar_items where household_id in(select household_id from public.aula_connections where created_by=u)),'No automatic activity creation');
 -- Delivery retries only before claim, at most three; no started slot is replayed.
 update private.aula_scheduled_scans set queued_at=now()-interval '6 minutes' where status='queued';
 perform private.dispatch_aula_scans('2026-11-14T05:07:00Z');
 perform pg_temp.check_that((select max(attempts)<=2 from private.aula_scheduled_scans),'Only unclaimed delivery retried');
 update private.aula_scheduled_scans set attempts=3,queued_at=now()-interval '6 minutes' where status='queued';
 perform private.dispatch_aula_scans('2026-11-14T05:14:00Z');
 perform pg_temp.check_that(not exists(select 1 from private.aula_scheduled_scans where status='queued'),'Finite delivery retry bound');
end$$;
select 'PASS: '||name from pg_temp.scheduler_assertions;
select count(*)||' scheduler database checks passed' from pg_temp.scheduler_assertions;
