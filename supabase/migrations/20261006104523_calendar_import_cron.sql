-- No secret values in migrations. Job is inert until Vault is configured.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function private.dispatch_calendar_sync()
returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text; request_id bigint;
begin
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='calendar_sync_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='calendar_sync_secret';
 if endpoint is null or secret is null or length(secret)<32 then return null;end if;
 if endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/sync-calendar-feeds$'
  and endpoint<>'http://supabase_kong_familiekalender:8000/functions/v1/sync-calendar-feeds' then raise exception 'Invalid calendar sync endpoint';end if;
 select net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-calendar-sync-secret',secret),
  body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function private.dispatch_calendar_sync() from public,anon,authenticated;
select cron.schedule('calendar-feed-sync','*/5 * * * *','select private.dispatch_calendar_sync();');
commit;
