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

select pg_temp.assert_true((select person='Child B' and data->>'repeatWeekly'='true' and data->'exceptions'='["2026-10-01"]'::jsonb from public.calendar_items where title='Private B'),'Migration reapply preserves existing names and recurrence JSON');
select pg_temp.assert_true((select avatar_url='data:image/png;base64,AA==' from public.household_people where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'Migration reapply preserves existing DataURL avatar');


set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.assert_true((select count(*) from public.list_household_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))=2,'Member can list only own family emails and roles');
select pg_temp.expect_error($q$select * from public.list_household_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,'Member cannot list another family');
select pg_temp.expect_error($q$select * from private.list_household_members('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,'Private member helper also checks caller');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.invite_household_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitee@example.invalid','adult') as invite_token \gset
select id as invite_id from public.household_invitations where email='invitee@example.invalid' \gset
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select pg_temp.expect_error(format('select public.revoke_household_invitation(%L)',:'invite_id'),'Adult cannot revoke invitations');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select pg_temp.expect_error(format('select public.revoke_household_invitation(%L)',:'invite_id'),'Other family owner cannot revoke');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.revoke_household_invitation(:'invite_id');
select public.revoke_household_invitation(:'invite_id');
select pg_temp.assert_true((select revoked_at is not null from public.household_invitations where id=:'invite_id'),'Owner revocation is durable and idempotent');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select pg_temp.expect_error(format('select public.accept_household_invitation(%L)',:'invite_token'),'Revoked link cannot be accepted');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
update public.household_people set is_active=false,reward_enabled=false where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select pg_temp.assert_true((select count(*) from public.household_people where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')=1,'Archive preserves person identity and history');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.list_household_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'Anonymous member list denied');
select pg_temp.expect_error(format('select public.revoke_household_invitation(%L)',:'invite_id'),'Anonymous revoke denied');
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_error($q$select * from private.list_household_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'Member helper without Auth UID denied');
select pg_temp.expect_error(format('select private.revoke_household_invitation(%L)',:'invite_id'),'Revoke helper without Auth UID denied');
rollback;
