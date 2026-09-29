-- Mega 5. Additive schema changes; no existing application rows are rewritten.
begin;
create table if not exists public.native_devices(
 user_id uuid not null references auth.users(id) on delete cascade,
 installation_id uuid not null,
 household_id uuid not null references public.households(id) on delete cascade,
 platform text not null check(platform in ('android','ios')),
 app_version text not null check(length(app_version) between 1 and 40),
 push_token text check(length(push_token) between 16 and 4096),
 last_seen timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '1 day',
 primary key(user_id,installation_id)
);
create index if not exists native_devices_household on public.native_devices(household_id);
create index if not exists native_devices_token on public.native_devices(push_token) where push_token is not null;
alter table public.native_devices enable row level security;
revoke all on public.native_devices from public,anon,authenticated;
grant select,delete on public.native_devices to authenticated;
grant all on public.native_devices to service_role;
drop policy if exists native_devices_own on public.native_devices;
create policy native_devices_own on public.native_devices for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and private.is_household_member(household_id));
create or replace function private.register_device(p_installation_id uuid,p_household_id uuid,p_platform text,p_app_version text,p_push_token text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 -- A refreshed OS token belongs to one active account. It is never exposed to other members.
 if p_push_token is not null then delete from public.native_devices where push_token=p_push_token and (user_id,installation_id)<>(auth.uid(),p_installation_id); end if;
 insert into public.native_devices(user_id,installation_id,household_id,platform,app_version,push_token)
 values(auth.uid(),p_installation_id,p_household_id,p_platform,p_app_version,p_push_token)
 on conflict(user_id,installation_id) do update set household_id=excluded.household_id,platform=excluded.platform,app_version=excluded.app_version,push_token=excluded.push_token,last_seen=now(),expires_at=now()+interval '1 day';
end $$;
create or replace function public.register_device(p_installation_id uuid,p_household_id uuid,p_platform text,p_app_version text,p_push_token text default null)
returns void language sql security invoker set search_path='' as $$ select private.register_device(p_installation_id,p_household_id,p_platform,p_app_version,p_push_token); $$;
create or replace function public.unregister_device(p_installation_id uuid)
returns void language sql security invoker set search_path='' as $$ delete from public.native_devices where user_id=auth.uid() and installation_id=p_installation_id; $$;
revoke all on function private.register_device(uuid,uuid,text,text,text),public.register_device(uuid,uuid,text,text,text),public.unregister_device(uuid) from public,anon;
grant execute on function private.register_device(uuid,uuid,text,text,text),public.register_device(uuid,uuid,text,text,text),public.unregister_device(uuid) to authenticated;

-- Durable deletion outbox: a retry completes Storage/Auth after the database transaction.
-- It contains IDs only, is inaccessible to clients and disappears with the Auth user.
create table if not exists public.account_deletion_jobs(
 user_id uuid primary key references auth.users(id) on delete cascade,
 household_ids uuid[] not null,
 created_at timestamptz not null default now()
);
alter table public.account_deletion_jobs enable row level security;
revoke all on public.account_deletion_jobs from public,anon,authenticated;
grant all on public.account_deletion_jobs to service_role;
-- Historical authorship becomes anonymous when the author deletes their login.
alter table public.calendar_items alter column created_by drop not null;
alter table public.households alter column created_by drop not null;
create or replace function private.guard_tenant_row()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.household_id is distinct from old.household_id then raise exception 'Household cannot be changed'; end if;
 if new.id is distinct from old.id then raise exception 'Row identity cannot be changed'; end if;
 if tg_table_name='calendar_items' then
 if new.created_by is distinct from old.created_by then
  if not (current_user in ('postgres','service_role') and new.created_by is null) then raise exception 'Creator cannot be changed'; end if;
 end if;
 end if;
 return new;
end $$;
-- A pending deletion cannot race with new profiles, families, memberships or uploads.
create or replace function private.block_deleting_account()
returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if tg_table_name='households' then uid=new.created_by; elsif tg_table_name='household_members' then uid=new.user_id; else uid=new.id; end if;
 if uid is not null then
  perform 1 from auth.users where id=uid for update;
  if exists(select 1 from public.account_deletion_jobs where user_id=uid) then raise exception 'Account deletion in progress' using errcode='42501'; end if;
 end if;
 return new;
end $$;
drop trigger if exists block_deleting_account on public.households;
create trigger block_deleting_account before insert on public.households for each row execute function private.block_deleting_account();
drop trigger if exists block_deleting_account on public.household_members;
create trigger block_deleting_account before insert or update on public.household_members for each row execute function private.block_deleting_account();
drop trigger if exists block_deleting_account on public.profiles;
create trigger block_deleting_account before insert or update on public.profiles for each row execute function private.block_deleting_account();

create or replace function private.account_deletion_plan()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 return jsonb_build_object('pending',exists(select 1 from public.account_deletion_jobs where user_id=auth.uid()),
 'households',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'role',m.role,
 'members',(select count(*) from public.household_members n where n.household_id=h.id),
 'requires_deletion',m.role='owner' and not exists(select 1 from public.household_members n where n.household_id=h.id and n.role='owner' and n.user_id<>auth.uid())))
 from public.households h join public.household_members m on m.household_id=h.id where m.user_id=auth.uid()),'[]'::jsonb));
end $$;
create or replace function public.account_deletion_plan() returns jsonb language sql stable security invoker set search_path='' as $$select private.account_deletion_plan();$$;
revoke all on function private.account_deletion_plan(),public.account_deletion_plan() from public,anon;
grant execute on function private.account_deletion_plan(),public.account_deletion_plan() to authenticated;

create or replace function private.begin_account_deletion(p_user_id uuid,p_delete_households uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare required uuid[]; job public.account_deletion_jobs; uid_email text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,5));
 perform 1 from auth.users where id=p_user_id for update;
 if not found then raise exception 'Account not found'; end if;
 select * into job from public.account_deletion_jobs where user_id=p_user_id;
 if found then return jsonb_build_object('household_ids',job.household_ids,'pending',true); end if;
 -- Lock the family parents before counting members; concurrent invitations/deletions serialize.
 perform 1 from public.households h where exists(select 1 from public.household_members m where m.household_id=h.id and m.user_id=p_user_id) order by h.id for update;
 select coalesce(array_agg(m.household_id order by m.household_id),'{}') into required
 from public.household_members m where m.user_id=p_user_id and m.role='owner'
 and not exists(select 1 from public.household_members n where n.household_id=m.household_id and n.role='owner' and n.user_id<>p_user_id);
 if required<>array(select distinct x from unnest(coalesce(p_delete_households,'{}')) x order by x) then
  raise exception 'Confirm each family where you are the only owner, or transfer ownership first' using errcode='23514';
 end if;
 if exists(select 1 from storage.objects where (owner_id=p_user_id::text or owner=p_user_id) and bucket_id<>'household-avatars') then
  raise exception 'Account owns unsupported storage objects' using errcode='23514';
 end if;
 insert into public.account_deletion_jobs(user_id,household_ids) values(p_user_id,required);
 -- Keep family-owned images for remaining members. Ownership metadata is not the access rule:
 -- the private bucket uses household membership. No files are deleted via SQL.
 update storage.objects set owner=null,owner_id=null where bucket_id='household-avatars' and (owner_id=p_user_id::text or owner=p_user_id);
 select lower(email) into uid_email from auth.users where id=p_user_id;
 delete from public.household_invitations where invited_by=p_user_id or lower(email)=uid_email;
 delete from public.calendar_feeds where household_id=any(required);
 delete from public.households where id=any(required);
 update public.households set created_by=null where created_by=p_user_id;
 update public.calendar_items set created_by=null where created_by=p_user_id;
 delete from public.native_devices where user_id=p_user_id;
 delete from public.calendar_mutation_receipts where user_id=p_user_id;
 delete from public.household_members where user_id=p_user_id;
 delete from public.profiles where id=p_user_id;
 return jsonb_build_object('household_ids',required,'pending',true);
end $$;
create or replace function public.begin_account_deletion(p_user_id uuid,p_delete_households uuid[])
returns jsonb language sql security invoker set search_path='' as $$select private.begin_account_deletion(p_user_id,p_delete_households);$$;
create or replace function private.account_deletion_objects(p_user_id uuid)
returns table(name text) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 return query select o.name from storage.objects o join public.account_deletion_jobs j on j.user_id=p_user_id
 where o.bucket_id='household-avatars' and split_part(o.name,'/',1)=any(array(select unnest(j.household_ids)::text)) order by o.name limit 100;
end $$;
create or replace function public.account_deletion_objects(p_user_id uuid)
returns table(name text) language sql stable security invoker set search_path='' as $$select * from private.account_deletion_objects(p_user_id);$$;
revoke all on function private.begin_account_deletion(uuid,uuid[]),public.begin_account_deletion(uuid,uuid[]),private.account_deletion_objects(uuid),public.account_deletion_objects(uuid) from public,anon,authenticated;
grant execute on function private.begin_account_deletion(uuid,uuid[]),public.begin_account_deletion(uuid,uuid[]),private.account_deletion_objects(uuid),public.account_deletion_objects(uuid) to service_role;

-- Export is a single consistent snapshot. Explicit field lists exclude feed secrets, tokens and auth metadata.
create or replace function private.export_family_data(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('format_version',1,'exported_at',now(),
 'household',(select jsonb_build_object('id',id,'name',name,'created_at',created_at) from public.households where id=p_household_id),
 'people',coalesce((select jsonb_agg(to_jsonb(p)-'avatar_url') from public.household_people p where household_id=p_household_id),'[]'),
 'calendar_and_tasks',coalesce((select jsonb_agg(to_jsonb(i)-'data'||jsonb_build_object('data',
  (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(i.data) where key=any(array['title','date','time','person','people','personIds','type','note','done','location','durationMin','repeatWeekly','repeatYearly','repeatUntil','birthYear','seriesId','overrideOf','overrideBaseId','exceptions','weekdays','originalDate','previousSeriesId','emoji','taskEmoji']))))
  from public.calendar_items i where household_id=p_household_id),'[]'),
 'reward_state',coalesce((select jsonb_agg(to_jsonb(r)) from public.reward_celebrations r where household_id=p_household_id),'[]'),
 'feed_metadata',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',source,'name',name,'assigned_person_id',assigned_person_id,'assigned_person_name',assigned_person_name,'is_active',is_active,'last_sync_at',last_sync_at,'last_sync_status',last_sync_status)) from public.calendar_feeds where household_id=p_household_id),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.list_household_members(p_household_id) m),'[]'));
end $$;
create or replace function public.export_family_data(p_household_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select private.export_family_data(p_household_id);$$;
revoke all on function private.export_family_data(uuid),public.export_family_data(uuid) from public,anon;
grant execute on function private.export_family_data(uuid),public.export_family_data(uuid) to authenticated;
revoke all on function private.block_deleting_account(),private.guard_tenant_row() from public,anon,authenticated;
commit;
