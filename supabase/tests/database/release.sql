-- LOCAL fixture transaction only.
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
 ('11111111-1111-4111-8111-111111111111','release-owner@example.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','release-other@example.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','release-member@example.invalid',now()),
 ('44444444-4444-4444-8444-444444444444','release-coowner@example.invalid',now());
insert into public.households(id,name,created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Release A','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Release B','22222222-2222-4222-8222-222222222222');
insert into public.household_members(household_id,user_id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','adult'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','owner'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner');
insert into public.household_people(id,household_id,name) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Child retained');
insert into public.calendar_items(household_id,title,created_by,person_ids,data) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Member task','33333333-3333-4333-8333-333333333333',array['cccccccc-cccc-4ccc-8ccc-cccccccccccc']::uuid[],'{"repeatWeekly":true,"feed_url":"PRIVATE_SENTINEL","token":"PRIVATE_SENTINEL"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Owner task','11111111-1111-4111-8111-111111111111','{}','{}');
insert into public.calendar_feeds(household_id,name,source,feed_url,assigned_person_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Feed','ics','https://example.invalid/PRIVATE_SENTINEL','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into storage.objects(bucket_id,name,owner,owner_id) values
 ('household-avatars','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc/test.png','33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333');

set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.assert_true((public.export_family_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'people'->0->>'name')='Child retained','Adult export includes family profiles');
select pg_temp.assert_true(public.export_family_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text not like '%PRIVATE_SENTINEL%','Export excludes feed links and reserved secret fields');
select pg_temp.assert_true(jsonb_array_length(public.export_family_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'calendar_and_tasks')=2,'Export includes calendar and tasks');
select pg_temp.expect_error($q$select public.export_family_data('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,'Cross-family export blocked');
select pg_temp.expect_error($q$select private.export_family_data('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,'Private export helper cannot bypass membership');
select pg_temp.expect_error($q$select public.begin_account_deletion('22222222-2222-4222-8222-222222222222','{}')$q$,'Client cannot call server deletion RPC');
select pg_temp.expect_error($q$select * from public.account_deletion_jobs$q$,'Deletion outbox private');
select pg_temp.assert_true((public.account_deletion_plan()->'households'->0->>'requires_deletion')='false','Member deletion preserves shared family');
select public.register_device('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','android','1.0.0','TEST_TOKEN_123456789');
select pg_temp.assert_true((select count(*) from public.native_devices)=1,'Device is visible to its owner');
select public.register_device('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','android','1.0.0','TEST_TOKEN_REFRESHED');
select pg_temp.assert_true((select push_token='TEST_TOKEN_REFRESHED' and expires_at>now() from public.native_devices),'Token refresh replaces token and renews expiry');
select pg_temp.expect_error($q$select public.register_device('66666666-6666-4666-8666-666666666666','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ios','1.0.0',null)$q$,'Cross-family device registration denied');
select pg_temp.expect_error($q$update public.calendar_items set created_by=null where title='Member task'$q$,'Client cannot anonymize or rewrite authorship');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select pg_temp.assert_true((select count(*) from public.native_devices)=0,'Another household member cannot read tokens');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.begin_account_deletion('33333333-3333-4333-8333-333333333333','{}');
select pg_temp.assert_true((select count(*) from public.households)=2,'Nonowner deletion preserves all households');
select pg_temp.assert_true((select count(*) from public.household_people)=1,'Child profiles are independent of deleted Auth users');
select pg_temp.assert_true((select created_by is null from public.calendar_items where title='Member task'),'Historical calendar item anonymized and retained');
select pg_temp.assert_true((select count(*) from public.native_devices)=0,'Deletion removes native tokens');
select pg_temp.assert_true((select owner_id is null and owner is null from storage.objects where name like 'aaaaaaaa%'),'Shared avatar remains and uploader ownership is removed');
select pg_temp.assert_true((select count(*) from public.household_members where user_id='33333333-3333-4333-8333-333333333333')=0,'All deleting memberships removed');
select public.begin_account_deletion('33333333-3333-4333-8333-333333333333','{}');
select pg_temp.assert_true((select count(*) from public.account_deletion_jobs)=1,'Deletion retry is idempotent');
select pg_temp.expect_error($q$insert into public.household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','adult')$q$,'Pending deletion cannot regain membership');
select public.begin_account_deletion('11111111-1111-4111-8111-111111111111','{}');
select pg_temp.assert_true((select count(*) from public.households)=2,'Coowner deletion preserves household');
select pg_temp.assert_true((select created_by is null from public.households where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'Household creator reference anonymized');
select pg_temp.expect_error($q$select public.begin_account_deletion('44444444-4444-4444-8444-444444444444','{}')$q$,'Last owner must explicitly confirm household deletion');
select pg_temp.expect_error($q$select public.begin_account_deletion('44444444-4444-4444-8444-444444444444',array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[])$q$,'Cannot delete another owner household');
select pg_temp.assert_true((select count(*) from public.calendar_items)=2,'Rejected deletion is atomic');
select public.begin_account_deletion('44444444-4444-4444-8444-444444444444',array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[]);
select pg_temp.assert_true((select count(*) from public.calendar_items)=0,'Explicit family deletion cascades calendar and tasks');
select pg_temp.assert_true((select count(*) from public.household_people)=0,'Explicit family deletion cascades profiles');
select pg_temp.assert_true((select count(*) from public.calendar_feeds)=0,'Assigned feed removed without FK conflict');
select pg_temp.assert_true((select count(*) from public.account_deletion_objects('44444444-4444-4444-8444-444444444444'))=1,'Storage cleanup returns deleted family object names');
select pg_temp.assert_true((select count(*) from public.households)=1,'Unrelated family remains');
reset role;
delete from auth.users where id in ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
select pg_temp.assert_true((select count(*) from public.account_deletion_jobs)=1,'Auth deletion cascades completed outbox jobs');
set local role anon;
select pg_temp.expect_error($q$select public.account_deletion_plan()$q$,'Anonymous deletion plan denied');
select pg_temp.expect_error($q$select public.export_family_data('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,'Anonymous export denied');
select pg_temp.expect_error($q$select public.register_device('55555555-5555-4555-8555-555555555555','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','android','1.0.0',null)$q$,'Anonymous registration denied');
reset role;
rollback;
