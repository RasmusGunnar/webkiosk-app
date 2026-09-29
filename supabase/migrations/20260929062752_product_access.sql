-- Additive Mega 4 access UI. No existing rows are rewritten.
begin;
create or replace function private.list_household_members(p_household_id uuid)
returns table(user_id uuid,email text,role text,joined_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501'; end if;
 return query select m.user_id,u.email::text,m.role,m.created_at from public.household_members m join auth.users u on u.id=m.user_id
 where m.household_id=p_household_id order by m.created_at,m.user_id;
end $$;
create or replace function public.list_household_members(p_household_id uuid)
returns table(user_id uuid,email text,role text,joined_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.list_household_members(p_household_id); $$;
create or replace function private.revoke_household_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare inv public.household_invitations;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into inv from public.household_invitations where id=p_invitation_id for update;
 if not found or not private.is_household_admin(inv.household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if inv.accepted_at is not null then raise exception 'Invitation already accepted'; end if;
 update public.household_invitations set revoked_at=coalesce(revoked_at,now()) where id=inv.id;
end $$;
create or replace function public.revoke_household_invitation(p_invitation_id uuid)
returns void language sql security invoker set search_path='' as $$select private.revoke_household_invitation(p_invitation_id);$$;
revoke all on function private.list_household_members(uuid),public.list_household_members(uuid),private.revoke_household_invitation(uuid),public.revoke_household_invitation(uuid) from public,anon;
grant execute on function private.list_household_members(uuid),public.list_household_members(uuid),private.revoke_household_invitation(uuid),public.revoke_household_invitation(uuid) to authenticated;
commit;
