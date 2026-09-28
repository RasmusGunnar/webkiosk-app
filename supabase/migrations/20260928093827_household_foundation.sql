-- Additive foundation, based on schema/live-before-foundation.json.
-- Back up and verify live drift first. Existing data and legacy JSON are retained.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

alter table public.household_people add column if not exists avatar_path text;
alter table public.household_people add column if not exists name_aliases text[] not null default '{}';
alter table public.calendar_items add column if not exists person_ids uuid[] not null default '{}';
alter table public.calendar_feeds add column if not exists assigned_person_id uuid;
alter table public.calendar_feeds add column if not exists last_import_count integer;
alter table public.calendar_feeds add column if not exists import_token uuid;
alter table public.calendar_feeds add column if not exists import_started_at timestamptz;

create unique index if not exists household_people_household_id_id on public.household_people(household_id,id);
create index if not exists household_members_user_household on public.household_members(user_id,household_id);
create index if not exists calendar_items_household_date on public.calendar_items(household_id,date);
create index if not exists calendar_items_household_calendar on public.calendar_items(household_id,calendar_id);
create index if not exists calendar_items_person_ids on public.calendar_items using gin(person_ids);
create index if not exists calendar_feeds_assigned_person on public.calendar_feeds(household_id,assigned_person_id);
create index if not exists households_created_by on public.households(created_by);
create index if not exists calendar_items_created_by on public.calendar_items(created_by);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='calendar_feeds_person_household_fk' and conrelid='public.calendar_feeds'::regclass) then
    alter table public.calendar_feeds add constraint calendar_feeds_person_household_fk
      foreign key (household_id,assigned_person_id) references public.household_people(household_id,id);
  end if;
end $$;

create or replace function private.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.household_members m where m.household_id=hid and m.user_id=(select auth.uid())
  );
$$;
create or replace function private.is_household_admin(hid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.household_members m
    where m.household_id=hid and m.user_id=(select auth.uid()) and m.role in ('owner','admin')
  );
$$;
revoke all on function private.is_household_member(uuid),private.is_household_admin(uuid) from public,anon;
grant execute on function private.is_household_member(uuid),private.is_household_admin(uuid) to authenticated,service_role;

-- Preserve old RPC signatures without allowing arbitrary-user membership probes.
create or replace function public.is_household_member(hid uuid, uid uuid)
returns boolean language sql stable set search_path = '' as $$
  select uid=(select auth.uid()) and private.is_household_member(hid);
$$;
create or replace function public.is_household_admin(hid uuid, uid uuid)
returns boolean language sql stable set search_path = '' as $$
  select uid=(select auth.uid()) and private.is_household_admin(hid);
$$;
revoke all on function public.is_household_member(uuid,uuid),public.is_household_admin(uuid,uuid) from public,anon;
grant execute on function public.is_household_member(uuid,uuid),public.is_household_admin(uuid,uuid) to authenticated;

-- Replace policies on these six owned application tables, avoiding permissive-policy OR bypass.
do $$ declare p record; t text; begin
  for p in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename in ('profiles','households','household_members','household_people','calendar_items','calendar_feeds')
  loop execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
  foreach t in array array['profiles','households','household_members','household_people','calendar_items','calendar_feeds'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;
grant select,insert,update on public.profiles to authenticated;
grant select on public.households,public.household_members to authenticated;
grant update(name) on public.households to authenticated;
grant select,insert,update,delete on public.household_people,public.calendar_items to authenticated;
grant select,delete on public.calendar_feeds to authenticated;
grant insert(household_id,source,name,feed_url,assigned_person_name,assigned_person_id,is_active),
 update(source,name,feed_url,assigned_person_name,assigned_person_id,is_active)
 on public.calendar_feeds to authenticated;

create policy profiles_select on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check(id=(select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy households_select on public.households for select to authenticated using(private.is_household_member(id));
create policy households_update on public.households for update to authenticated using(private.is_household_admin(id)) with check(private.is_household_admin(id));
create policy members_select on public.household_members for select to authenticated using(private.is_household_member(household_id));
create policy people_select on public.household_people for select to authenticated using(private.is_household_member(household_id));
create policy people_insert on public.household_people for insert to authenticated with check(private.is_household_member(household_id));
create policy people_update on public.household_people for update to authenticated using(private.is_household_member(household_id)) with check(private.is_household_member(household_id));
create policy people_delete on public.household_people for delete to authenticated using(private.is_household_member(household_id));
create policy items_select on public.calendar_items for select to authenticated using(private.is_household_member(household_id));
create policy items_insert on public.calendar_items for insert to authenticated with check(private.is_household_member(household_id) and created_by=(select auth.uid()));
create policy items_update on public.calendar_items for update to authenticated using(private.is_household_member(household_id)) with check(private.is_household_member(household_id));
create policy items_delete on public.calendar_items for delete to authenticated using(private.is_household_member(household_id));
create policy feeds_select on public.calendar_feeds for select to authenticated using(private.is_household_admin(household_id));
create policy feeds_insert on public.calendar_feeds for insert to authenticated with check(private.is_household_admin(household_id));
create policy feeds_update on public.calendar_feeds for update to authenticated using(private.is_household_admin(household_id)) with check(private.is_household_admin(household_id));
create policy feeds_delete on public.calendar_feeds for delete to authenticated using(private.is_household_admin(household_id));

create or replace function private.create_household(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'Invalid household name'; end if;
  insert into public.profiles(id) values(uid) on conflict(id) do nothing;
  insert into public.households(name,created_by) values(btrim(p_name),uid) returning id into hid;
  insert into public.household_members(household_id,user_id,role) values(hid,uid,'owner');
  return hid;
end $$;
create or replace function public.create_household(p_name text)
returns uuid language sql security invoker set search_path = '' as $$ select private.create_household(p_name); $$;
revoke all on function private.create_household(text),public.create_household(text) from public,anon;
grant execute on function private.create_household(text),public.create_household(text) to authenticated;

create or replace function private.guard_tenant_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.household_id is distinct from old.household_id then raise exception 'Household cannot be changed'; end if;
  if new.id is distinct from old.id then raise exception 'Row identity cannot be changed'; end if;
  if tg_table_name='calendar_items' then
    if new.created_by is distinct from old.created_by then raise exception 'Creator cannot be changed'; end if;
  end if;
  return new;
end $$;
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['household_people','calendar_items','calendar_feeds'] loop
    execute format('drop trigger if exists guard_tenant on public.%I',t);
    execute format('create trigger guard_tenant before update on public.%I for each row execute function private.guard_tenant_row()',t);
  end loop;
  foreach t in array array['profiles','household_people','calendar_items','calendar_feeds'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I',t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
  end loop;
end $$;

create or replace function private.keep_person_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if length(btrim(new.name)) not between 1 and 100 then raise exception 'Invalid person name'; end if;
  if tg_op='UPDATE' and new.name is distinct from old.name then
    new.name_aliases=array(select distinct unnest(old.name_aliases || new.name_aliases || array[old.name]));
  end if;
  if new.avatar_path is not null and (
    split_part(new.avatar_path,'/',1)<>new.household_id::text or
    split_part(new.avatar_path,'/',2)<>new.id::text or
    array_length(string_to_array(new.avatar_path,'/'),1)<>3
  ) then raise exception 'Avatar path belongs to another person'; end if;
  return new;
end $$;
drop trigger if exists keep_person_identity on public.household_people;
create trigger keep_person_identity before insert or update on public.household_people for each row execute function private.keep_person_identity();

create or replace function private.validate_item_people()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Lock referenced people until commit, so a concurrent delete cannot orphan an ID.
  perform 1 from public.household_people p where p.household_id=new.household_id and p.id=any(new.person_ids) for key share;
  if exists(select 1 from unnest(new.person_ids) pid where not exists(
    select 1 from public.household_people p where p.id=pid and p.household_id=new.household_id
  )) then raise exception 'Person belongs to another household'; end if;
  -- JSON is a compatibility mirror. Explicit columns are authoritative.
  new.data=jsonb_set(new.data,'{personIds}',to_jsonb(new.person_ids),true);
  return new;
end $$;
drop trigger if exists validate_item_people on public.calendar_items;
create trigger validate_item_people before insert or update on public.calendar_items for each row execute function private.validate_item_people();

create or replace function private.protect_person_references()
returns trigger language plpgsql set search_path='' as $$
begin
  -- A deliberate household deletion may cascade all of its people and items.
  if exists(select 1 from public.households where id=old.household_id)
    and exists(select 1 from public.calendar_items where household_id=old.household_id and person_ids @> array[old.id]) then
    raise exception 'Person is used by calendar items; deactivate instead' using errcode='23503';
  end if;
  return old;
end $$;
revoke all on function private.protect_person_references() from public,anon,authenticated;
drop trigger if exists protect_person_references on public.household_people;
create trigger protect_person_references before delete on public.household_people for each row execute function private.protect_person_references();

create or replace function private.validate_feed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.feed_url !~* '^(https|webcal)://[^/[:space:]@]+(/|$)' or length(new.feed_url)>4096 then raise exception 'Invalid feed URL'; end if;
  if tg_op='UPDATE' and (new.source,new.feed_url,new.assigned_person_id,new.assigned_person_name,new.is_active)
    is distinct from (old.source,old.feed_url,old.assigned_person_id,old.assigned_person_name,old.is_active) then
    new.import_token=null; new.import_started_at=null;
    new.last_sync_status='pending'; new.last_sync_message=null;
  end if;
  return new;
end $$;
drop trigger if exists validate_feed on public.calendar_feeds;
create trigger validate_feed before insert or update on public.calendar_feeds for each row execute function private.validate_feed();

-- Family people are independent of Auth users. Invitations only create login memberships.
create table if not exists public.household_invitations(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role text not null check(role in ('admin','adult','child')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invitations_household on public.household_invitations(household_id);
create index if not exists invitations_invited_by on public.household_invitations(invited_by);
alter table public.household_invitations enable row level security;
revoke all on public.household_invitations from public,anon,authenticated;
grant select,delete on public.household_invitations to authenticated;
grant all on public.household_invitations to service_role;
drop policy if exists invitations_admin on public.household_invitations;
create policy invitations_admin on public.household_invitations for all to authenticated
using(private.is_household_admin(household_id)) with check(private.is_household_admin(household_id));

create or replace function private.invite_household_member(p_household_id uuid,p_email text,p_role text default 'adult')
returns text language plpgsql security definer set search_path = '' as $$
declare token text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  if not private.is_household_admin(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_role not in ('admin','adult','child') or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid invitation'; end if;
  if p_role='admin' and not exists(select 1 from public.household_members where household_id=p_household_id and user_id=auth.uid() and role='owner') then raise exception 'Only owners may invite admins'; end if;
  insert into public.household_invitations(household_id,email,role,token_hash,invited_by)
    values(p_household_id,lower(btrim(p_email)),p_role,encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid());
  return token;
end $$;
create or replace function public.invite_household_member(p_household_id uuid,p_email text,p_role text default 'adult')
returns text language sql security invoker set search_path='' as $$ select private.invite_household_member(p_household_id,p_email,p_role); $$;
create or replace function private.accept_household_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.household_invitations; verified_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select * into inv from public.household_invitations
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if inv.id is null or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at<=now()
    or verified_email is null or verified_email<>inv.email then raise exception 'Invalid or expired invitation'; end if;
  insert into public.profiles(id) values(auth.uid()) on conflict do nothing;
  insert into public.household_members(household_id,user_id,role) values(inv.household_id,auth.uid(),inv.role) on conflict do nothing;
  update public.household_invitations set accepted_at=now() where id=inv.id;
  return inv.household_id;
end $$;
create or replace function public.accept_household_invitation(p_token text)
returns uuid language sql security invoker set search_path='' as $$ select private.accept_household_invitation(p_token); $$;
revoke all on function private.invite_household_member(uuid,text,text),public.invite_household_member(uuid,text,text),private.accept_household_invitation(text),public.accept_household_invitation(text) from public,anon;
grant execute on function private.invite_household_member(uuid,text,text),public.invite_household_member(uuid,text,text),private.accept_household_invitation(text),public.accept_household_invitation(text) to authenticated;

-- Private avatar bucket. Paths: household UUID/person UUID/random UUID.extension.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('household-avatars','household-avatars',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.can_access_avatar(object_name text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
begin
  if array_length(string_to_array(object_name,'/'),1)<>3 then return false; end if;
  perform split_part(object_name,'/',2)::uuid;
  return private.is_household_member(split_part(object_name,'/',1)::uuid);
exception when invalid_text_representation then return false;
end $$;
revoke all on function private.can_access_avatar(text) from public,anon;
grant execute on function private.can_access_avatar(text) to authenticated;
drop policy if exists household_avatars_select on storage.objects;
drop policy if exists household_avatars_insert on storage.objects;
drop policy if exists household_avatars_update on storage.objects;
drop policy if exists household_avatars_delete on storage.objects;
create policy household_avatars_select on storage.objects for select to authenticated using(bucket_id='household-avatars' and private.can_access_avatar(name));
create policy household_avatars_insert on storage.objects for insert to authenticated with check(bucket_id='household-avatars' and private.can_access_avatar(name));
create policy household_avatars_update on storage.objects for update to authenticated using(bucket_id='household-avatars' and private.can_access_avatar(name)) with check(bucket_id='household-avatars' and private.can_access_avatar(name));
create policy household_avatars_delete on storage.objects for delete to authenticated using(bucket_id='household-avatars' and private.can_access_avatar(name));

-- Trigger functions are not application RPCs.
revoke all on function private.guard_tenant_row(),private.touch_updated_at(),private.keep_person_identity(),private.validate_item_people(),private.validate_feed() from public,anon,authenticated;
commit;
