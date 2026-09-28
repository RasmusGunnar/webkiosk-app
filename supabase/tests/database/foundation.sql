-- Isolated/local database only. All fixtures roll back.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.expect_error(statement text,label text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate not in ('42501','23503','23514','P0001') then raise; end if;
    raise notice 'PASS: %',label; return; end;
  raise exception 'FAIL: % (statement succeeded)',label;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','owner-a@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','owner-b@example.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','member-a@example.invalid',now()),
 ('44444444-4444-4444-8444-444444444444','invitee@example.invalid',now());
insert into public.households(id,name,created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Family A','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Family B','22222222-2222-4222-8222-222222222222');
insert into public.household_members(household_id,user_id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','adult'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner');
insert into public.household_people(id,household_id,name,role) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Child A','child'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Adult A','adult'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Child B','child');
insert into public.calendar_feeds(id,household_id,source,name,feed_url,assigned_person_id) values
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aula','Test feed','https://kalenderlink.aula.dk/?feed=TEST_ONLY','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.calendar_items(household_id,title,created_by) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Private B','22222222-2222-4222-8222-222222222222');

update public.calendar_items set person='Child B',data='{"people":["Child B"],"repeatWeekly":true,"exceptions":["2026-10-01"]}' where title='Private B';
update public.household_people set avatar_url='data:image/png;base64,AA==' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
-- REAPPLY_MIGRATIONS_WITH_EXISTING_DATA
select pg_temp.assert_true((select person='Child B' and data->>'repeatWeekly'='true' and data->'exceptions'='["2026-10-01"]'::jsonb from public.calendar_items where title='Private B'),'Migration reapply preserves existing names and recurrence JSON');
select pg_temp.assert_true((select avatar_url='data:image/png;base64,AA==' from public.household_people where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'Migration reapply preserves existing DataURL avatar');

set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.assert_true((select count(*) from public.households)=1,'Household B invisible to A');
select pg_temp.assert_true((select count(*) from public.household_members)=2,'Members read without RLS recursion');
select pg_temp.assert_true((select count(*) from public.household_people)=2,'People isolated by household');
select pg_temp.assert_true((select count(*) from public.calendar_items)=0,'B calendar invisible');
select pg_temp.assert_true((select count(*) from public.calendar_feeds)=0,'Private feeds restricted to admins');
select pg_temp.expect_error($q$insert into public.calendar_items(household_id,title,created_by) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','attack','33333333-3333-4333-8333-333333333333')$q$,'Cross-household calendar insert denied');
select pg_temp.expect_error($q$update public.household_members set role='owner'$q$,'Direct role escalation denied');
select pg_temp.expect_error($q$select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')$q$,'Service import RPC unavailable to authenticated');
insert into public.calendar_items(id,household_id,title,created_by,person_ids,data) values
 ('99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Own item','33333333-3333-4333-8333-333333333333',
 array['cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd']::uuid[],'{"people":["Child A","Adult A"],"repeatWeekly":true}');
update public.calendar_items set title='Updated' where id='99999999-9999-4999-8999-999999999999';
select pg_temp.assert_true((select title='Updated' and cardinality(person_ids)=2 and data->>'repeatWeekly'='true' from public.calendar_items where id='99999999-9999-4999-8999-999999999999'),'Member calendar CRUD/multi-person/JSON preserved');
select pg_temp.expect_error($q$update public.calendar_items set person_ids=array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']::uuid[]$q$,'Cross-household person assignment denied');
select pg_temp.expect_error($q$delete from public.household_people where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'$q$,'Referenced person cannot be deleted');
insert into public.household_people(household_id,name,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','No login child','child');
update public.household_people set name='Renamed child' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select pg_temp.assert_true((select 'Child A'=any(name_aliases) from public.household_people where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),'Person rename retains legacy alias');
select pg_temp.assert_true((select person_ids[1]='cccccccc-cccc-4ccc-8ccc-cccccccccccc' from public.calendar_items where id='99999999-9999-4999-8999-999999999999'),'Rename leaves ID assignments intact');
delete from public.household_people where name='No login child';
delete from public.calendar_items where id='99999999-9999-4999-8999-999999999999';
select pg_temp.assert_true((select count(*) from public.calendar_items)=0,'Member can delete own calendar item');
select pg_temp.expect_error($q$select public.invite_household_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitee@example.invalid','admin')$q$,'Member cannot invite administrators');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true((select assigned_person_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' from public.calendar_feeds),'Feed assignment survives rename');
select pg_temp.expect_error($q$update public.calendar_feeds set assigned_person_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$q$,'Feed person must belong to same household');
select pg_temp.expect_error($q$update public.calendar_feeds set import_token=gen_random_uuid()$q$,'Browser cannot change import lease');
select pg_temp.assert_true(public.create_household('Created by RPC') is not null,'Authenticated household creation succeeds');
select pg_temp.assert_true((select count(*) from public.household_members where user_id=auth.uid() and role='owner')=2,'Household creation includes owner membership');
select public.invite_household_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitee@example.invalid','adult') as invite_token \gset
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error(format('select public.accept_household_invitation(%L)',:'invite_token'),'Wrong verified email cannot accept invitation');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select pg_temp.assert_true(public.accept_household_invitation(:'invite_token')='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Verified invitee joins correct household');
select pg_temp.expect_error(format('select public.accept_household_invitation(%L)',:'invite_token'),'Invitation replay denied');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into storage.objects(bucket_id,name) values('household-avatars','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc/test.png');
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id='household-avatars')=1,'Member can create/read avatar object');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id='household-avatars')=0,'Other household cannot read avatar');
select pg_temp.expect_error($q$insert into storage.objects(bucket_id,name) values('household-avatars','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc/attack.png')$q$,'Cross-household avatar upload denied');
reset role;
select pg_temp.assert_true((select not public and file_size_limit=2097152 and allowed_mime_types=array['image/jpeg','image/png','image/webp'] from storage.buckets where id='household-avatars'),'Avatar bucket privacy, MIME and size limits');

set local role service_role;
select pg_temp.expect_error($q$select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','22222222-2222-4222-8222-222222222222')$q$,'Privileged import still checks actor membership');
update public.calendar_feeds set is_active=false where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
select pg_temp.expect_error($q$select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')$q$,'Inactive feed cannot begin import');
update public.calendar_feeds set is_active=true where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
select pg_temp.expect_error($q$select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')$q$,'Concurrent import lease is exclusive');
select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',:'import_token',
 '[{"externalKey":"event-1","payload":{"title":"First","date":"2026-09-28","time":"10:00","data":{"uid":"uid-1","occurrenceDate":"2026-09-28","durationMin":30}}}]','2026-09-01','2026-10-01') as result \gset
select pg_temp.assert_true((:'result'::jsonb->>'insertedCount')::int=1,'Atomic import insert count');
select pg_temp.assert_true((select person='Renamed child' and person_ids[1]='cccccccc-cccc-4ccc-8ccc-cccccccccccc' from public.calendar_items where external_id='event-1'),'Importer resolves stable person ID to current name');
select pg_temp.assert_true((select last_sync_status='success' and last_sync_at is not null from public.calendar_feeds where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'Success status persisted');
update public.calendar_items set detached_from_feed=true where external_id='event-1';
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',:'import_token','[]','2026-09-01','2026-10-01');
select pg_temp.assert_true((select count(*) from public.calendar_items where external_id='event-1')=1,'Cleanup preserves detached edits');
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
select public.fail_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff',:'import_token','FETCH_FAILED');
select pg_temp.assert_true((select last_sync_status='error' and last_sync_message='FETCH_FAILED' and import_token is null from public.calendar_feeds where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'Failure status persisted without private URL');

-- Missing/malformed data must roll back every write and must never trigger cleanup.
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
select pg_temp.expect_error(format($q$select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',%L,null,'2026-09-01','2026-10-01')$q$,:'import_token'),'Null batch rejected before cleanup');
select pg_temp.expect_error(format($q$select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',%L,
 '[{"externalKey":"rollback-1","payload":{"title":"Should roll back","date":"2026-09-28","data":{}}},{"externalKey":"bad","payload":{}}]',
 '2026-09-01','2026-10-01')$q$,:'import_token'),'Malformed later row rolls back whole import');
select pg_temp.assert_true((select count(*) from public.calendar_items where external_id='rollback-1')=0,'Earlier insert rolled back on import error');
select pg_temp.assert_true((select import_token=:'import_token'::uuid from public.calendar_feeds where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'Failed batch retains lease for safe failure status');
select public.fail_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff',:'import_token','IMPORT_FAILED');

-- Updating configuration invalidates an in-flight import rather than applying stale data.
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
update public.calendar_feeds set assigned_person_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
select pg_temp.expect_error(format($q$select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',%L,'[]','2026-09-01','2026-10-01')$q$,:'import_token'),'Feed edit rejects old import lease');
select pg_temp.assert_true((select last_sync_status='pending' and import_token is null from public.calendar_feeds where id='ffffffff-ffff-4fff-8fff-ffffffffffff'),'Configuration change leaves pending status');

insert into public.calendar_items(household_id,title,date,created_by,source,external_id,calendar_id,done) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Stale','2026-09-28','11111111-1111-4111-8111-111111111111','aula','stale','ffffffff-ffff-4fff-8fff-ffffffffffff',false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Out of range','2020-01-01','11111111-1111-4111-8111-111111111111','aula','historic','ffffffff-ffff-4fff-8fff-ffffffffffff',false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Other feed','2026-09-28','11111111-1111-4111-8111-111111111111','aula','other-feed','88888888-8888-4888-8888-888888888888',false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Before','2026-09-28','11111111-1111-4111-8111-111111111111','aula','update-me','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',:'import_token',
 '[{"externalKey":"update-me","payload":{"title":"After","date":"2026-09-28","data":{}}},{"externalKey":"event-1-renamed","payload":{"title":"Remote change","date":"2026-09-28","data":{"uid":"uid-1","occurrenceDate":"2026-09-28"}}}]',
 '2026-09-01','2026-10-01') as result \gset
select pg_temp.assert_true((:'result'::jsonb->>'updatedCount')::int=1 and (:'result'::jsonb->>'deletedCount')::int=1 and (:'result'::jsonb->>'skippedCount')::int=1,'Scoped update/cleanup counts and detached key changes');
select pg_temp.assert_true((select title='After' and done and data->>'done'='true' from public.calendar_items where external_id='update-me'),'Upsert retains task completion state');
select pg_temp.assert_true((select count(*) from public.calendar_items where external_id in ('historic','other-feed','event-1'))=3,'Cleanup preserves out-of-window, other-feed and detached records');


-- Safe release smoke mode upserts normally but never deletes existing rows.
select public.begin_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111')->>'import_token' as import_token \gset
select public.apply_calendar_feed_import('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',:'import_token',
 '[]','2026-09-01','2026-10-01',false) as result \gset
select pg_temp.assert_true((:'result'::jsonb->>'deletedCount')::int=0 and (select count(*) from public.calendar_items where external_id='update-me')=1,'Preserve-existing import never deletes rows');

reset role;
set local role anon;
select pg_temp.expect_error('select * from public.calendar_items','Anonymous calendar access denied');
select pg_temp.expect_error($q$select public.create_household('Unauthorized')$q$,'Anonymous household creation denied');
rollback;
