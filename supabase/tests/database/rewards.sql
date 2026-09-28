-- Isolated fixtures; this entire acceptance suite rolls back.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.expect_error(statement text,label text) returns void language plpgsql as $$
begin begin execute statement; exception when others then
 if sqlstate not in ('42501','23503','23514','23505','P0001') then raise; end if;
 raise notice 'PASS: %',label; return; end; raise exception 'FAIL: % (succeeded)',label; end $$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Europe/Copenhagen')::date$$;
create function pg_temp.task(i uuid,d boolean,pids jsonb default '["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]') returns jsonb language sql as $$
 select jsonb_build_object('id',i,'title','Lektier','date',pg_temp.today(),'time','','person','Alle','person_ids',pids,
 'type','Opgave','done',d,'note','','location','','duration_min',null,'data','{}'::jsonb)
$$;
create function pg_temp.expected(i uuid) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('id',id,'updated_at',updated_at)) from public.calendar_items where id=i
$$;
create function pg_temp.complete(n integer) returns jsonb language plpgsql as $$
declare result jsonb; begin
 select public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',
 (select jsonb_agg(pg_temp.task(gen_random_uuid(),true)) from generate_series(1,n)),'{}') into result; return result; end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','reward-a@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','reward-b@example.invalid',now());
insert into public.households(id,name,created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B','22222222-2222-4222-8222-222222222222');
insert into public.household_members(household_id,user_id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','adult'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner');
insert into public.household_people(id,household_id,name,role) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ida','child'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Carl','child'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Adult','adult'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B child','child');
select pg_temp.assert_true((select reward_enabled from public.household_people where name='Ida'),'Existing/new child reward default true');
select pg_temp.assert_true((select not reward_enabled from public.household_people where name='Adult'),'Adult reward default false');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true(jsonb_array_length(pg_temp.complete(6)->'celebrations')=0,'Six single-person tasks no threshold');
select pg_temp.assert_true(jsonb_array_length(public.sync_calendar_mutation('99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',
 jsonb_build_array(pg_temp.task('77777777-7777-4777-8777-777777777777',true)),'{}')->'celebrations')=1,'Seventh task atomically claims threshold 7');
select pg_temp.assert_true((select count(*)=1 and min(threshold)=7 and min(completed_count)=7 and min(jsonb_array_length(tasks))=6 from public.reward_celebrations),'Claim stores week, count and at most six task titles');
select pg_temp.assert_true((public.sync_calendar_mutation('99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]','[]','{}')->>'already_applied')::boolean,'Response-loss retry is idempotent');
select pg_temp.assert_true((select count(*)=7 from public.calendar_items),'Idempotent retry never duplicates rows');
select public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',pg_temp.expected('77777777-7777-4777-8777-777777777777'),
 jsonb_build_array(pg_temp.task('77777777-7777-4777-8777-777777777777',false)),'{}');
select pg_temp.assert_true(jsonb_array_length(public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',pg_temp.expected('77777777-7777-4777-8777-777777777777'),
 jsonb_build_array(pg_temp.task('77777777-7777-4777-8777-777777777777',true)),'{}')->'celebrations')=0,'Undo/redo does not repeat celebration');
select pg_temp.assert_true((pg_temp.complete(2)->'celebrations'->0->>'threshold')::int=9,'Threshold 9');
select pg_temp.assert_true((pg_temp.complete(3)->'celebrations'->0->>'threshold')::int=12,'Threshold 12');
select pg_temp.assert_true((select count(*)=3 and count(distinct (person_id,iso_year,iso_week,threshold))=3 from public.reward_celebrations),'Persistent unique crossing per person ISO week');
select public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',jsonb_build_array(
 pg_temp.task(gen_random_uuid(),true,'["cccccccc-cccc-4ccc-8ccc-cccccccccccc","dddddddd-dddd-4ddd-8ddd-dddddddddddd"]'),
 pg_temp.task(gen_random_uuid(),true,'[]')),'{}');
select pg_temp.assert_true((select count(*)=2 from private.completed_task_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',date_trunc('week',pg_temp.today())::date,pg_temp.today()) t
 where private.task_assigned_to(t.person_ids,t.people,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','Carl','{}')),'Multi-person and Alle each count once for other child');
select pg_temp.assert_true(not exists(select 1 from public.reward_celebrations where person_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'Disabled adult never celebrated');
select pg_temp.expect_error($q$select public.sync_calendar_mutation(gen_random_uuid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','[]','[]','{}')$q$,'Cross-household RPC denied');
select pg_temp.expect_error($q$insert into public.reward_celebrations(household_id,person_id,iso_year,iso_week,threshold,completed_count)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc',2026,1,7,7)$q$,'Client cannot forge celebration');
select pg_temp.expect_error($q$delete from public.calendar_mutation_receipts$q$,'Client cannot erase receipt');
select pg_temp.expect_error($q$select public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '[{"id":"77777777-7777-4777-8777-777777777777","updated_at":"2000-01-01"}]',jsonb_build_array(pg_temp.task('77777777-7777-4777-8777-777777777777',false)),'{}')$q$,'Stale offline done never overwrites current server state');
select pg_temp.expect_error($q$select public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',
 jsonb_build_array(pg_temp.task(gen_random_uuid(),true,'["ffffffff-ffff-4fff-8fff-ffffffffffff"]')),'{}')$q$,'Definer RPC retains cross-household person validation');
select pg_temp.assert_true((select count(*)=14 from public.calendar_items),'Failed mutation leaves data unchanged');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.assert_true((select count(*)=0 from public.reward_celebrations),'Household B cannot read A celebrations');
select pg_temp.assert_true((select count(*)=0 from public.calendar_mutation_receipts),'Household B cannot read A receipts');
select pg_temp.expect_error($q$select public.sync_calendar_mutation('99999999-9999-4999-8999-999999999999','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','[]','[]','{}')$q$,'Cross-user receipt ID cannot disclose row versions');
reset role;
-- Historic completed data exists before the new UI loads: no load-time popups.
delete from public.calendar_items where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from public.reward_celebrations where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.calendar_items(household_id,created_by,title,date,type,person,person_ids,done,data)
 select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Historic',pg_temp.today(),'Opgave','Ida',array['cccccccc-cccc-4ccc-8ccc-cccccccccccc']::uuid[],true,'{}' from generate_series(1,12);
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true(jsonb_array_length(pg_temp.complete(1)->'celebrations')=0,'Already above threshold on first load never causes historic popup storm');
select pg_temp.assert_true(jsonb_array_length(public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]',
 jsonb_build_array(pg_temp.task(gen_random_uuid(),true)||jsonb_build_object('date',pg_temp.today()+14)),'{}')->'celebrations')=0,'Future completion cannot claim rewards');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.reward_celebrations$q$,'Anonymous reward read denied');
select pg_temp.expect_error($q$select public.sync_calendar_mutation(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]','[]','{}')$q$,'Anonymous sync denied');
reset role;

-- Legacy repeating base + physical override: exactly one concrete completion.
reset role;
delete from public.calendar_items where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.calendar_items(id,household_id,created_by,title,date,type,person,done,data) values
 ('88888888-8888-4888-8888-888888888888','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Base',pg_temp.today(),'Opgave','Alle',true,
 jsonb_build_object('repeatWeekly',true,'exceptions',jsonb_build_array(pg_temp.today()))),
 ('77777777-7777-4777-8777-777777777777','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Override',pg_temp.today(),'Opgave','Alle',true,
 jsonb_build_object('overrideOf','88888888-8888-4888-8888-888888888888','overrideBaseId','88888888-8888-4888-8888-888888888888','originalDate',pg_temp.today()));
select pg_temp.assert_true((select count(*)=1 from private.completed_task_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',date_trunc('week',pg_temp.today())::date,pg_temp.today())),'Base plus completed override counts exactly once');
select pg_temp.assert_true((select count(*)=0 from private.completed_task_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',date_trunc('week',pg_temp.today())::date+7,pg_temp.today()+14)),'Done never propagates to future repeated occurrences');
-- Ambiguous legacy names must agree with the client: no inferred assignment.
insert into public.household_people(household_id,name,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ida','child');
select pg_temp.assert_true(not private.task_assigned_to('{}','["Ida"]','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Ida','{}'),'Ambiguous legacy names never reward two different people');
select pg_temp.assert_true(private.task_assigned_to(array['cccccccc-cccc-4ccc-8ccc-cccccccccccc']::uuid[],'["Ida"]','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Ida','{}'),'Stable person ID wins over ambiguous display name');

rollback;
