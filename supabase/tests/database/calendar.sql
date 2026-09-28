-- Local/isolated acceptance. No fixture survives this transaction.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.expect_error(statement text,label text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
   if sqlstate not in ('42501','23503','23514','23505','P0001') then raise; end if;
   raise notice 'PASS: %',label; return; end;
 raise exception 'FAIL: % (statement succeeded)',label;
end $$;
create function pg_temp.item(i uuid,t text) returns jsonb language sql as $$
 select jsonb_build_object('id',i,'title',t,'date','2026-09-28','time','','person','Alle','person_ids','[]'::jsonb,
   'type','Opgave','done',false,'note','','duration_min',null,'location','','data','{"repeatWeekly":true}'::jsonb);
$$;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','calendar-a@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','calendar-b@example.invalid',now());
insert into public.households(id,name,created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B','22222222-2222-4222-8222-222222222222');
insert into public.household_members(household_id,user_id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','adult'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner');
insert into public.household_people(id,household_id,name,role) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B person','child');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',jsonb_build_array(
 pg_temp.item('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Base'),
 pg_temp.item('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Override')),'{}');
select pg_temp.assert_true((select count(*)=2 from public.calendar_items),'Member creates batch through RLS');
select pg_temp.assert_true((select items_version=2 from public.calendar_revisions where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Insert events increment revision');
select pg_temp.assert_true((select count(*)=1 from public.calendar_revisions),'Other household revision invisible');
select pg_temp.expect_error($q$update public.calendar_revisions set items_version=0$q$,'Members cannot forge revisions');
select pg_temp.expect_error($q$select public.mutate_calendar('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','[]','[]','{}')$q$,'Cross-household batch denied');
select pg_temp.expect_error($q$select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","updated_at":"2000-01-01"}]','[]',array['cccccccc-cccc-4ccc-8ccc-cccccccccccc']::uuid[])$q$,'Stale editor rejects deletion');
select pg_temp.expect_error($q$select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]','[]',
 array['cccccccc-cccc-4ccc-8ccc-cccccccccccc']::uuid[])$q$,'Expected version required on delete');
select pg_temp.expect_error($q$select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',
 jsonb_build_array(pg_temp.item('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Collision')),'{}')$q$,'Insert collision never overwrites existing row');
select pg_temp.expect_error($q$select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',
 jsonb_build_array(pg_temp.item('99999999-9999-4999-8999-999999999999','Should roll back'),
 pg_temp.item('88888888-8888-4888-8888-888888888888','Bad person') || '{"person_ids":["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]}'::jsonb),'{}')$q$,'Person validation fails entire batch');
select pg_temp.assert_true((select count(*)=2 from public.calendar_items),'Failed create batch leaves no partial rows');
select pg_temp.assert_true((select items_version=2 from public.calendar_revisions where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Failed batch rolls back revision counters too');
select pg_temp.expect_error($q$select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 (select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at)) from public.calendar_items),
 jsonb_build_array(pg_temp.item('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Bad update') || '{"person_ids":["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]}'::jsonb),
 array['cccccccc-cccc-4ccc-8ccc-cccccccccccc']::uuid[])$q$,'Failure after delete rolls back all base/override operations');
select pg_temp.assert_true((select count(*)=2 from public.calendar_items),'Failed mixed batch restores deleted base');
select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 (select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at)) from public.calendar_items),
 jsonb_build_array(pg_temp.item('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Updated') || '{"data":{"repeatWeekly":true,"exceptions":["2026-10-05"],"custom":{"keep":true}}}'::jsonb),
 array['dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[]);
select pg_temp.assert_true((select count(*)=1 and bool_and(title='Updated') from public.calendar_items),'Atomic update+delete succeeds');
select pg_temp.assert_true((select data->'exceptions'='["2026-10-05"]'::jsonb and data->'custom'='{"keep":true}'::jsonb from public.calendar_items),'Series JSON survives transaction');
select pg_temp.assert_true((select items_version=4 from public.calendar_revisions where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Update and delete both signal realtime');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.calendar_revisions$q$,'Anonymous revision access denied');
select pg_temp.expect_error($q$select public.mutate_calendar('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]','[]','{}')$q$,'Anonymous calendar RPC denied');
reset role;
select pg_temp.assert_true(exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='calendar_revisions'),'Realtime publication includes scoped revision table');
delete from public.households where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.assert_true(not exists(select 1 from public.calendar_revisions where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Household cascade cannot resurrect revision');
rollback;
