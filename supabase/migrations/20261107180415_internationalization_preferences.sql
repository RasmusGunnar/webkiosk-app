begin;
alter table public.profiles add column preferred_locale text check(preferred_locale in ('da-DK','en-GB'));
alter table public.households add column default_locale text not null default 'da-DK' check(default_locale in ('da-DK','en-GB'));
alter table public.households add column currency_code text not null default 'DKK' check(currency_code in ('DKK','EUR','SEK','NOK','GBP','USD'));
alter table public.household_devices add column display_locale text check(display_locale in ('da-DK','en-GB'));
grant update(default_locale,currency_code) on public.households to authenticated;
-- Existing self-profile/admin-household RLS applies. Display preferences require an active device or its administrator.
create function private.set_display_locale(p_device_id uuid,p_locale text) returns void language plpgsql security definer set search_path='' as $$
declare d public.household_devices;begin
 select * into d from public.household_devices where id=p_device_id for update;
 if d.id is null or auth.uid() is null or not (private.is_household_admin(d.household_id) or (d.auth_user_id=auth.uid() and d.revoked_at is null)) then raise exception 'DEVICE_ACCESS_DENIED' using errcode='42501';end if;
 if p_locale is not null and p_locale not in ('da-DK','en-GB') then raise exception 'INVALID_LOCALE' using errcode='22023';end if;
 update public.household_devices set display_locale=p_locale where id=d.id;
end $$;
create function public.set_display_locale(p_device_id uuid,p_locale text) returns void language sql security invoker set search_path='' as $$select private.set_display_locale(p_device_id,p_locale);$$;
revoke all on function private.set_display_locale(uuid,text),public.set_display_locale(uuid,text) from public,anon;
grant execute on function private.set_display_locale(uuid,text),public.set_display_locale(uuid,text) to authenticated,service_role;
-- Extend only the safe display projection. No change to tokens, pairing or household permissions.
do $$ declare definition text; original text := '''name'',name,''memberRole'',''device''';begin
 definition:=pg_get_functiondef('private.wall_snapshot()'::regprocedure);
 if position(original in definition)=0 then raise exception 'Wall projection changed; review i18n migration';end if;
 definition:=replace(definition,original,'''name'',name,''memberRole'',''device'',''default_locale'',default_locale,''currency_code'',currency_code');
 definition:=replace(definition,'jsonb_build_object(''id'',hid)','(select jsonb_build_object(''id'',hid,''default_locale'',default_locale,''currency_code'',currency_code) from public.households where id=hid)');
 execute definition;
end $$;
commit;
