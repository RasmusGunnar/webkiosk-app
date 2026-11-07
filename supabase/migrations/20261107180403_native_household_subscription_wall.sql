-- Product Batch 5. Additive. No production enforcement or Auth configuration change.
begin;
create table public.household_subscriptions (
 household_id uuid primary key references public.households(id) on delete cascade,
 status text not null default 'pending' check(status in ('active','trialing','grace','cancelled','billing_issue','expired','pending')),
 entitlement text not null default 'family_access' check(entitlement='family_access'),
 provider text not null default 'revenuecat' check(provider='revenuecat'),
 purchaser_user_id uuid unique references auth.users(id) on delete set null,
 revenuecat_customer_id uuid unique,
 product_id text, store text, current_period_end timestamptz, will_renew boolean,
 updated_at timestamptz not null default now(), last_verified_at timestamptz,
 verification_started_at timestamptz
);
create table public.subscription_purchase_claims (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes', completed_at timestamptz
);
create index subscription_claim_user on public.subscription_purchase_claims(user_id,created_at desc);
create index subscription_claim_household on public.subscription_purchase_claims(household_id);
create table public.subscription_events (
 provider_event_id text primary key check(length(provider_event_id) between 1 and 200),
 household_id uuid references public.households(id) on delete set null,
 type text not null, received_at timestamptz not null default now(), processed_at timestamptz
);
create table private.subscription_config (id boolean primary key default true check(id), enforcement_enabled boolean not null default false);
insert into private.subscription_config(id,enforcement_enabled) values(true,false);
alter table private.subscription_config enable row level security;
revoke all on private.subscription_config from public,anon,authenticated;

create table public.household_devices (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 auth_user_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null default 'Vægskærm' check(length(name) between 1 and 60),
 platform text not null check(platform in ('web','ios','android')), mode text not null default 'wall' check(mode='wall'),
 paired_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(), revoked_at timestamptz,
 capabilities text[] not null default array['display','complete_tasks'] check(capabilities <@ array['display','complete_tasks'])
);
create index household_devices_household on public.household_devices(household_id);
create index household_devices_paired_by on public.household_devices(paired_by);
create table public.device_pairing_codes (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 token_hash text not null unique, short_code_hash text not null unique,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes',
 used_at timestamptz, device_id uuid references public.household_devices(id) on delete set null
);
create index pairing_household on public.device_pairing_codes(household_id);
create index pairing_creator on public.device_pairing_codes(created_by);
create index pairing_device on public.device_pairing_codes(device_id);
create table private.pairing_attempts (scope text primary key, window_start timestamptz not null default now(), attempts integer not null default 0);
alter table private.pairing_attempts enable row level security;
revoke all on private.pairing_attempts from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['household_subscriptions','subscription_purchase_claims','subscription_events','household_devices','device_pairing_codes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.household_subscriptions,public.household_devices to authenticated;
create policy subscription_member_read on public.household_subscriptions for select to authenticated using(private.is_household_member(household_id));
create policy device_read on public.household_devices for select to authenticated
 using(auth_user_id=(select auth.uid()) or private.is_household_admin(household_id));

create function private.wall_device() returns public.household_devices language sql stable security definer set search_path='' as $$
 select d from public.household_devices d join auth.users u on u.id=d.auth_user_id
 where d.auth_user_id=auth.uid() and u.is_anonymous is true and d.revoked_at is null;
$$;
create function private.household_entitled(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.household_subscriptions s where s.household_id=hid and s.entitlement='family_access'
  and s.status in ('active','trialing','grace','cancelled','billing_issue') and s.current_period_end>now());
$$;
create function private.wall_can_access(hid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((private.wall_device()).household_id=hid,false)
 and (not (select enforcement_enabled from private.subscription_config where id) or private.household_entitled(hid));
$$;
create function private.subscription_access(p_household_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.household_subscriptions; admin boolean; enabled boolean;
begin
 if auth.uid() is null or not (private.is_household_member(p_household_id) or coalesce((private.wall_device()).household_id=p_household_id,false)) then
  raise exception 'Household access denied' using errcode='42501'; end if;
 select * into s from public.household_subscriptions where household_id=p_household_id;
 select enforcement_enabled into enabled from private.subscription_config where id;
 admin:=private.is_household_admin(p_household_id);
 return jsonb_build_object('enabled',enabled,'entitled',private.household_entitled(p_household_id),
 'status',case when s.current_period_end<=now() and s.status in ('active','trialing','grace','cancelled','billing_issue') then 'expired' else coalesce(s.status,'none') end,
 'entitlement','family_access','can_purchase',admin,'purchaser',s.purchaser_user_id=auth.uid(),
 'period_end',s.current_period_end,'will_renew',s.will_renew,'store',s.store,'last_verified_at',s.last_verified_at);
end $$;
create function private.create_subscription_claim(p_household_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not private.is_household_admin(p_household_id) or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Administrator required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,50));
 if exists(select 1 from public.household_subscriptions where revenuecat_customer_id=auth.uid() and household_id<>p_household_id)
 or exists(select 1 from public.subscription_purchase_claims where user_id=auth.uid() and household_id<>p_household_id and (completed_at is not null or expires_at>now())) then
  raise exception 'Købet er knyttet til en anden familie' using errcode='42501'; end if;
 if private.household_entitled(p_household_id) and exists(select 1 from public.household_subscriptions where household_id=p_household_id and purchaser_user_id is distinct from auth.uid()) then
  raise exception 'Familien har allerede adgang via en anden voksen'; end if;
 select id into result from public.subscription_purchase_claims where user_id=auth.uid() and household_id=p_household_id and expires_at>now() order by created_at desc limit 1;
 if result is null then insert into public.subscription_purchase_claims(household_id,user_id) values(p_household_id,auth.uid()) returning id into result; end if;
 return result;
end $$;
-- Called only with the server key after a fresh RevenueCat REST read. No receipt or provider token is retained.
create function private.apply_subscription_verification(p_user_id uuid,p_claim_id uuid,p_verified jsonb,p_started_at timestamptz,p_event_id text default null,p_type text default 'VERIFY')
returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid; claim public.subscription_purchase_claims; current_row public.household_subscriptions;
begin
 if current_user not in ('postgres','service_role') then raise exception 'Server only' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,50));
 if p_event_id is not null then perform pg_advisory_xact_lock(hashtextextended(p_event_id,52));end if;
 if p_event_id is not null and exists(select 1 from public.subscription_events where provider_event_id=p_event_id and processed_at is not null) then return '{"duplicate":true}';end if;
 select * into current_row from public.household_subscriptions where revenuecat_customer_id=p_user_id;
 hid:=current_row.household_id;
 if p_claim_id is not null then
  select * into claim from public.subscription_purchase_claims where id=p_claim_id and user_id=p_user_id and expires_at>now();
 else
  select * into claim from public.subscription_purchase_claims where user_id=p_user_id and (expires_at>now() or completed_at is not null) order by created_at desc limit 1;
 end if;
 if hid is null then
  if claim.id is not null and exists(select 1 from public.household_members where user_id=p_user_id and household_id=claim.household_id and role in ('owner','admin')) then hid:=claim.household_id;end if;
 elsif claim.id is not null and claim.household_id<>hid then raise exception 'Purchase household mismatch';end if;
 if p_claim_id is not null and claim.id is null then raise exception 'Claim expired';end if;
 -- Recheck permission at the final write, including restores of an already mapped purchase.
 if p_claim_id is not null and not exists(select 1 from public.household_members where user_id=p_user_id and household_id=claim.household_id and role in ('owner','admin')) then
  raise exception 'Administrator required' using errcode='42501';end if;
 if p_event_id is not null then insert into public.subscription_events(provider_event_id,household_id,type) values(p_event_id,hid,left(p_type,80)) on conflict do nothing;end if;
 if hid is not null then
  perform pg_advisory_xact_lock(hashtextextended(hid::text,51));
  if exists(select 1 from public.household_subscriptions where household_id=hid and revenuecat_customer_id is distinct from p_user_id and current_period_end>now() and status<>'expired') then raise exception 'Household already subscribed';end if;
  insert into public.household_subscriptions(household_id,purchaser_user_id,revenuecat_customer_id,status,product_id,store,current_period_end,will_renew,last_verified_at,verification_started_at)
  values(hid,p_user_id,p_user_id,p_verified->>'status',p_verified->>'product_id',p_verified->>'store',nullif(p_verified->>'period_end','')::timestamptz,(p_verified->>'will_renew')::boolean,now(),p_started_at)
  on conflict(household_id) do update set purchaser_user_id=excluded.purchaser_user_id,revenuecat_customer_id=excluded.revenuecat_customer_id,
   status=excluded.status,product_id=excluded.product_id,store=excluded.store,current_period_end=excluded.current_period_end,will_renew=excluded.will_renew,
   last_verified_at=now(),updated_at=now(),verification_started_at=p_started_at
  where public.household_subscriptions.verification_started_at is null or public.household_subscriptions.verification_started_at<=p_started_at;
  if private.household_entitled(hid) then update public.subscription_purchase_claims set completed_at=coalesce(completed_at,now()) where id=claim.id;end if;
 end if;
 if p_event_id is not null then update public.subscription_events set processed_at=now() where provider_event_id=p_event_id;end if;
 return jsonb_build_object('mapped',hid is not null);
end $$;

create function public.subscription_access(p_household_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.subscription_access(p_household_id);$$;
create function public.create_subscription_claim(p_household_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.create_subscription_claim(p_household_id);$$;
create function public.apply_subscription_verification(p_user_id uuid,p_claim_id uuid,p_verified jsonb,p_started_at timestamptz,p_event_id text default null,p_type text default 'VERIFY')
returns jsonb language sql security invoker set search_path='' as $$select private.apply_subscription_verification(p_user_id,p_claim_id,p_verified,p_started_at,p_event_id,p_type);$$;
revoke all on function private.apply_subscription_verification(uuid,uuid,jsonb,timestamptz,text,text),public.apply_subscription_verification(uuid,uuid,jsonb,timestamptz,text,text) from public,anon,authenticated;
grant execute on function private.apply_subscription_verification(uuid,uuid,jsonb,timestamptz,text,text),public.apply_subscription_verification(uuid,uuid,jsonb,timestamptz,text,text) to service_role;

-- Device pairing implementations follow. Personal native_devices remains the push-registration model.
create function private.create_wall_pairing(p_household_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare token text; code text; expiry timestamptz;begin
 if auth.uid() is null or not private.is_household_admin(p_household_id) then raise exception 'Administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,53));
 if (select count(*) from public.device_pairing_codes where created_by=auth.uid() and created_at>now()-interval '10 minutes')>=10 then raise exception 'Vent lidt før du opretter en ny kode';end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');code:=upper(encode(extensions.gen_random_bytes(5),'hex'));
 insert into public.device_pairing_codes(household_id,token_hash,short_code_hash,created_by)
 values(p_household_id,encode(extensions.digest(token,'sha256'),'hex'),encode(extensions.digest(code,'sha256'),'hex'),auth.uid()) returning expires_at into expiry;
 return jsonb_build_object('token',token,'code',left(code,5)||'-'||right(code,5),'expires_at',expiry);
end $$;
-- Failures return normally so rate-limit counters commit even for invalid/expired/replayed tokens.
create function private.redeem_wall_pairing(p_code text,p_platform text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); code text; pairing public.device_pairing_codes; device public.household_devices; scope_key text; n integer;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and is_anonymous is true) then raise exception 'Anonymous device session required' using errcode='42501';end if;
 if p_platform not in ('web','ios','android') then return '{"error":"invalid"}';end if;
 -- Global limit also bounds attempts by attackers rotating anonymous identities. Auth adds IP rate limits.
 foreach scope_key in array array['pairing:global','pairing:'||uid::text] loop
  insert into private.pairing_attempts(scope,attempts) values(scope_key,1)
  on conflict(scope) do update set attempts=case when private.pairing_attempts.window_start<now()-interval '10 minutes' then 1 else private.pairing_attempts.attempts+1 end,
   window_start=case when private.pairing_attempts.window_start<now()-interval '10 minutes' then now() else private.pairing_attempts.window_start end returning attempts into n;
  if n>(case when scope_key='pairing:global' then 300 else 8 end) then return '{"error":"rate_limited"}';end if;
 end loop;
 if exists(select 1 from public.household_devices where auth_user_id=uid) then return '{"error":"already_paired"}';end if;
 if length(p_code)>80 then return '{"error":"invalid"}';end if;
 code:=btrim(p_code);
 if code~'^[0-9a-f]{64}$' then
  select * into pairing from public.device_pairing_codes where token_hash=encode(extensions.digest(code,'sha256'),'hex') for update;
 else
  code:=upper(replace(code,'-',''));
  if code!~'^[0-9A-F]{10}$' then return '{"error":"invalid"}';end if;
  select * into pairing from public.device_pairing_codes where short_code_hash=encode(extensions.digest(code,'sha256'),'hex') for update;
 end if;
 if pairing.id is null or pairing.used_at is not null or pairing.expires_at<=now() then return '{"error":"invalid"}';end if;
 if not exists(select 1 from public.household_members where household_id=pairing.household_id and user_id=pairing.created_by and role in ('owner','admin')) then return '{"error":"invalid"}';end if;
 insert into public.household_devices(household_id,auth_user_id,platform,paired_by) values(pairing.household_id,uid,p_platform,pairing.created_by) returning * into device;
 update public.device_pairing_codes set used_at=now(),device_id=device.id where id=pairing.id;
 return jsonb_build_object('device',to_jsonb(device));
end $$;
create function private.manage_wall_device(p_device_id uuid,p_action text,p_name text default null) returns void language plpgsql security definer set search_path='' as $$
declare d public.household_devices;begin
 select * into d from public.household_devices where id=p_device_id for update;
 if auth.uid() is null or d.id is null then raise exception 'Device access denied' using errcode='42501';end if;
 if p_action='name' and ((d.auth_user_id=auth.uid() and d.revoked_at is null) or private.is_household_admin(d.household_id)) then
  if length(btrim(p_name)) not between 1 and 60 or p_name is null then raise exception 'Vælg et navn på 1–60 tegn';end if;
  update public.household_devices set name=btrim(p_name) where id=d.id;
 elsif p_action='revoke' and private.is_household_admin(d.household_id) then
  update public.household_devices set revoked_at=coalesce(revoked_at,now()) where id=d.id;
 else raise exception 'Device access denied' using errcode='42501';end if;
end $$;

-- Explicit projection: no feed URLs, source payload, account details, receipts or administrator data.
create function private.wall_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.household_devices;hid uuid;r jsonb;begin
 d:=private.wall_device();hid:=d.household_id;
 if hid is null then raise exception 'Device revoked or unpaired' using errcode='42501';end if;
 update public.household_devices set last_seen_at=now() where id=d.id and last_seen_at<now()-interval '1 minute';
 if not private.wall_can_access(hid) then return jsonb_build_object('device',to_jsonb(d),'access',private.subscription_access(hid),'household',jsonb_build_object('id',hid));end if;
 perform private.ensure_allowance_periods(hid);
 r:=private.reward_state(hid);
 return jsonb_build_object('device',to_jsonb(d),'access',private.subscription_access(hid),
 'household',(select jsonb_build_object('id',id,'name',name,'memberRole','device') from public.households where id=hid),
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'household_id',household_id,'name',name,'role',role,'color',color,'is_active',is_active,'reward_enabled',reward_enabled)) from public.household_people where household_id=hid),'[]'),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'household_id',household_id,'title',title,'type',type,'date',date,'time',time,
  'end_date',end_date,'end_time',end_time,'all_day',all_day,'duration_min',duration_min,'person',person,'person_ids',person_ids,'done',done,'location',location,
  'source',source,'recipe_id',recipe_id,'updated_at',updated_at,'data',coalesce((select jsonb_object_agg(k,v) from jsonb_each(coalesce(i.data,'{}')) as kv(k,v)
   where k=any(array['title','type','date','time','durationMin','endDate','endTime','allDay','person','people','done','location','repeatWeekly','repeatYearly','repeatUntil','seriesId','exceptions','overrideOf','overrideBaseId','originalDate','birthDate','rewardOriginId','rewardMode','starValue','requiresApproval','taskEmoji','bonusPool','rewardRuleHistory'])),'{}')))
  from public.calendar_items i where household_id=hid and coalesce(i.data->>'importHidden','false')<>'true' and coalesce(i.data->>'importSourceRemoved','false')<>'true' and coalesce(i.data->>'importArchived','false')<>'true'),'[]'),
 'rewards',jsonb_build_object('configs',r->'configs','occurrences',r->'occurrences','balances',r->'balances','monthly',r->'monthly','catalog',r->'catalog','goals',r->'goals'));
end $$;

-- Extend only completion access; ownership/admin/membership predicates stay unchanged everywhere else.
create function private.wall_can_complete(hid uuid,action text) returns boolean language sql stable security definer set search_path='' as $$
 select action in ('complete','undo','claim') and private.wall_can_access(hid) and 'complete_tasks'=any((private.wall_device()).capabilities);
$$;
do $$ declare definition text; old_guard text:='if uid is null or not private.is_household_member(hid) then';begin
 definition:=pg_get_functiondef('private.reward_action(uuid,uuid,text,jsonb)'::regprocedure);
 if position(old_guard in definition)=0 then raise exception 'Reward guard changed; review migration';end if;
 definition:=replace(definition,old_guard,'if uid is null or not (private.is_household_member(hid) or private.wall_can_complete(hid,p_action)) then');
 execute definition;
end $$;
create function private.complete_task_as_device(p_request_id uuid,p_item_id uuid,p_due_date date,p_person_id uuid default null,p_done boolean default true,p_action text default 'complete')
returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid:=(private.wall_device()).household_id;t record;i public.calendar_items;series text;oid uuid;begin
 if hid is null or not private.wall_can_complete(hid,p_action) then raise exception 'Device access denied' using errcode='42501';end if;
 if p_due_date is null or p_due_date>private.reward_today() or p_due_date<private.reward_today()-31 then raise exception 'Vælg en aktuel opgave';end if;
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 select * into t from private.reward_task_instances(hid,p_due_date,p_due_date) where task_id=p_item_id limit 1;
 if not found then raise exception 'Opgaven findes ikke';end if;
 if t.rule->>'mode'<>'none' or (t.rule->>'approval')::boolean then
  return private.reward_action(p_request_id,hid,p_action,jsonb_build_object('person_id',p_person_id,'item_id',p_item_id,'due_date',p_due_date,'occurrence_date',t.occurrence_date));
 end if;
 select * into i from public.calendar_items where id=t.task_id and household_id=hid and type='Opgave' for update;
 if i.id is null or coalesce(i.source,'') in ('google','aula','ics') then raise exception 'Opgaven styres af en anden kilde';end if;
 if coalesce(i.data->>'repeatWeekly','false')='true' and nullif(i.data->>'overrideOf','') is null then
  series:=coalesce(nullif(i.data->>'seriesId',''),i.id::text);oid:=gen_random_uuid();
  update public.calendar_items set data=jsonb_set(data,'{exceptions}',coalesce(data->'exceptions','[]')||to_jsonb(p_due_date::text)) where id=i.id;
  insert into public.calendar_items(id,household_id,created_by,title,type,date,time,person,person_ids,done,data)
   values(oid,hid,auth.uid(),i.title,i.type,p_due_date,i.time,i.person,i.person_ids,p_done,i.data||jsonb_build_object('date',p_due_date,'done',p_done,'repeatWeekly',false,'exceptions','[]'::jsonb,'seriesId',series,'overrideOf',series,'overrideBaseId',i.id,'originalDate',p_due_date));
 else update public.calendar_items set done=p_done,data=jsonb_set(coalesce(data,'{}'),'{done}',to_jsonb(p_done)) where id=i.id;end if;
 return '{"ok":true}';
end $$;
-- Anonymous display identities must never bootstrap a family or accept member invitations.
create function private.guard_wall_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;begin
 if tg_table_name='households' then uid:=new.created_by;else uid:=new.user_id;end if;
 if exists(select 1 from auth.users where id=uid and is_anonymous is true) then raise exception 'Display identities cannot become household members' using errcode='42501';end if;
 return new;
end $$;
create trigger wall_no_household before insert on public.households for each row execute function private.guard_wall_identity();
create trigger wall_no_membership before insert or update on public.household_members for each row execute function private.guard_wall_identity();

create function public.create_wall_pairing(p_household_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.create_wall_pairing(p_household_id);$$;
create function public.redeem_wall_pairing(p_code text,p_platform text) returns jsonb language sql security invoker set search_path='' as $$select private.redeem_wall_pairing(p_code,p_platform);$$;
create function public.manage_wall_device(p_device_id uuid,p_action text,p_name text default null) returns void language sql security invoker set search_path='' as $$select private.manage_wall_device(p_device_id,p_action,p_name);$$;
create function public.wall_snapshot() returns jsonb language sql security invoker set search_path='' as $$select private.wall_snapshot();$$;
create function public.complete_task_as_device(p_request_id uuid,p_item_id uuid,p_due_date date,p_person_id uuid default null,p_done boolean default true,p_action text default 'complete')
 returns jsonb language sql security invoker set search_path='' as $$select private.complete_task_as_device(p_request_id,p_item_id,p_due_date,p_person_id,p_done,p_action);$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure::text as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public')
 and p.proname=any(array['wall_device','household_entitled','wall_can_access','subscription_access','create_subscription_claim','create_wall_pairing','redeem_wall_pairing','manage_wall_device','wall_snapshot','wall_can_complete','complete_task_as_device','guard_wall_identity']) loop
  execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
  if f.proname<>'guard_wall_identity' then execute 'grant execute on function '||f.signature||' to authenticated,service_role';end if;
 end loop;
end $$;
-- Only device-row changes use Realtime. Display data is fetched through the safe projection, not raw table subscriptions.
alter publication supabase_realtime add table public.household_devices;
commit;
