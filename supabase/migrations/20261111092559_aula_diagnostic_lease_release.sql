-- Release a read-only diagnostic lease without claiming a successful scan or
-- changing findings, connection status, child mappings or encrypted credentials.
create function private.aula_diagnostic_release(hid uuid,lease_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
 delete from private.aula_scan_locks l using private.aula_credentials c
 where l.household_id=hid and l.lease=lease_id and l.expires_at>now()
 and c.household_id=l.household_id and c.generation=l.generation;
 if not found then raise exception 'AULA_LEASE_EXPIRED'; end if;
 return '{}'::jsonb;
end $$;
revoke all on function private.aula_diagnostic_release(uuid,uuid) from public,anon,authenticated;
grant execute on function private.aula_diagnostic_release(uuid,uuid) to service_role;
create function public.aula_diagnostic_release(p_household_id uuid,p_lease uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.aula_diagnostic_release(p_household_id,p_lease)$$;
revoke all on function public.aula_diagnostic_release(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aula_diagnostic_release(uuid,uuid) to service_role;
