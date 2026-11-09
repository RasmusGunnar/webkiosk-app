begin;
-- Preserve the installed function (including i18n, pairing and entitlement guards).
-- Only avatar display fields and typed, non-private Aula provenance are added.
do $$
declare definition text; old_people text := '''color'',color,''is_active'',is_active';
 old_filter text := 'where k=any(array[';
begin
 definition:=pg_get_functiondef('private.wall_snapshot()'::regprocedure);
 if position(old_people in definition)=0 or position(old_filter in definition)=0 then
  raise exception 'Wall projection changed; review wall_avatar_projection migration';
 end if;
 definition:=replace(definition,old_people,'''color'',color,''avatar_url'',avatar_url,''avatar_path'',avatar_path,''is_active'',is_active');
 -- Match the normal household_people query, including overflow ordering.
 if position('''reward_enabled'',reward_enabled)) from public.household_people' in definition)=0 then raise exception 'Wall people ordering changed';end if;
 definition:=replace(definition,'''reward_enabled'',reward_enabled)) from public.household_people','''reward_enabled'',reward_enabled) order by sort_order,name,id) from public.household_people');
 definition:=replace(definition,old_filter,
  'where (k=''aulaAssisted'' and v=''true''::jsonb) or (k=''aulaSourceKind'' and i.data->''aulaAssisted''=''true''::jsonb and v in (''"calendar"''::jsonb,''"message"''::jsonb,''"meebook"''::jsonb,''"post"''::jsonb,''"notification"''::jsonb)) or k=any(array[');
 execute definition;
end $$;

-- New uploads use the private avatar bucket, not avatar_url. A paired wall may
-- sign/read only an exact avatar object currently referenced by its own family.
-- Do not extend the existing member helper: it also authorizes writes/deletes.
create function private.wall_can_view_avatar(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from public.household_people p
  where p.household_id=(private.wall_device()).household_id
    and p.avatar_path=object_name and private.wall_can_access(p.household_id)
 );
$$;
revoke all on function private.wall_can_view_avatar(text) from public,anon;
grant execute on function private.wall_can_view_avatar(text) to authenticated,service_role;
create policy wall_avatars_select on storage.objects for select to authenticated
 using (bucket_id='household-avatars' and private.wall_can_view_avatar(name));
commit;
