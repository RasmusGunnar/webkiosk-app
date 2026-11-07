-- Stars 1.0: keep the existing ledger, catalogue, goals and redemption snapshots.
-- No allowance calculations, native subscriptions or production data are changed.
begin;
alter table public.household_members add column person_id uuid;
alter table public.household_members add constraint member_person_household_fk
 foreign key(household_id,person_id) references public.household_people(household_id,id);
create unique index member_person_identity on public.household_members(household_id,person_id) where person_id is not null;
comment on column public.household_members.person_id is 'Adult-assigned identity for a child account. Never inferred from names or claimed by a child.';
-- Existing member table grants are SELECT only for authenticated users. Identity
-- changes go through the existing validated adult reward RPC below.
create trigger reward_member_revision after update of person_id on public.household_members
 for each row execute function private.bump_reward_revision();

do $migration$
declare body text; patch text[];
begin
 body:=replace(pg_get_functiondef('private.reward_action(uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 foreach patch slice 1 in array array[
  array[$old$'approve','reject','excuse','unexcuse','config','catalog',$old$,$new$'link_person','catalog_delete','approve','reject','excuse','unexcuse','config','catalog',$new$],
  array[$old$ if p_action in ('allowance_save','allowance_payout','allowance_resolve') then$old$,$new$
 if p_action in ('goal','redeem') and not is_adult and not exists(
  select 1 from public.household_members m where m.household_id=hid and m.user_id=uid and m.role='child' and m.person_id=pid
 ) then raise exception 'Vælg din egen tilknyttede person' using errcode='42501';end if;
 if p_action='link_person' then
  if pid is null or not person.is_active or person.role<>'child' then raise exception 'Vælg et barn i familien';end if;
  if nullif(p_payload->>'user_id','') is not null and not exists(select 1 from public.household_members where household_id=hid and user_id=(p_payload->>'user_id')::uuid and role='child') then
   raise exception 'Vælg barnets medlemskonto' using errcode='42501';end if;
  update public.household_members set person_id=null where household_id=hid and person_id=pid;
  update public.household_members set person_id=pid where household_id=hid and user_id=nullif(p_payload->>'user_id','')::uuid and role='child';
 elsif p_action='catalog_delete' then
  rid=(p_payload->>'id')::uuid;
  if not exists(select 1 from public.reward_catalog where id=rid and household_id=hid) then raise exception 'Belønningen findes ikke' using errcode='42501';end if;
  if exists(select 1 from public.reward_redemptions where household_id=hid and reward_id=rid)
   or exists(select 1 from public.reward_goals where household_id=hid and reward_id=rid) then raise exception 'Deaktiver belønningen for at bevare mål og historik' using errcode='P1004';end if;
  delete from public.reward_catalog where id=rid and household_id=hid;
 elsif p_action in ('allowance_save','allowance_payout','allowance_resolve') then$new$],
  array[$old$  if p_payload->>'active'='false' then delete from public.reward_goals where household_id=hid and reward_id=rid; end if;$old$,
        $new$  -- Keep inactive goals visible so the child can choose a replacement.$new$],
  array[$old$if not found then raise exception 'Belønningen er ikke tilgængelig'; end if;$old$,
        $new$if not found then raise exception 'Belønningen er ikke tilgængelig' using errcode='P1003'; end if;$new$],
  array[$old$if balance<catalog.star_cost then raise exception 'Mangler % ⭐',catalog.star_cost-balance; end if;$old$,
        $new$if balance<catalog.star_cost then raise exception 'Der er ikke stjerner nok' using errcode='P1002'; end if;$new$],
  array[$old$if balance<redemption.star_cost then raise exception 'Der er ikke stjerner nok længere'; end if;$old$,
        $new$if balance<redemption.star_cost then raise exception 'Der er ikke stjerner nok længere' using errcode='P1002'; end if;$new$],
  array[$old$   if exists(select 1 from public.reward_redemptions where household_id=hid and person_id=pid and reward_id=catalog.id and status='pending') then raise exception 'Belønningen afventer allerede godkendelse'; end if;
   insert into public.reward_redemptions(household_id,person_id,reward_id,title,emoji,star_cost,created_by) values(hid,pid,catalog.id,catalog.title,catalog.emoji,catalog.star_cost,uid) returning id into rid;$old$,
        $new$   select id into rid from public.reward_redemptions where household_id=hid and person_id=pid and reward_id=catalog.id and status='pending';
   if rid is null then
    insert into public.reward_redemptions(household_id,person_id,reward_id,title,emoji,star_cost,created_by) values(hid,pid,catalog.id,catalog.title,catalog.emoji,catalog.star_cost,uid) returning id into rid;
   end if;$new$],
  array[$old$update public.reward_redemptions set status='approved',approved_by=uid,updated_at=now() where id=redemption.id;$old$,
        $new$update public.reward_redemptions set status='approved',approved_by=uid,updated_at=now() where id=redemption.id;
    delete from public.reward_goals where household_id=hid and person_id=redemption.person_id and reward_id=redemption.reward_id;$new$]
 ] loop
  if strpos(body,patch[1])=0 then raise exception 'Unexpected reward_action version: missing %',left(patch[1],100);end if;
  body:=replace(body,patch[1],patch[2]);
 end loop;
 execute body;
 body:=pg_get_functiondef('private.reward_state(uuid)'::regprocedure);
 if strpos(body,$old$'configs',coalesce$old$)=0 then raise exception 'Unexpected reward_state version';end if;
 body:=replace(body,$old$'configs',coalesce$old$,$new$
 'person_members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'person_id',m.person_id,'email',u.email) order by m.created_at)
  from public.household_members m join auth.users u on u.id=m.user_id
  where m.household_id=hid and m.role='child' and (private.is_reward_adult(hid) or m.user_id=auth.uid())),'[]'),
 'configs',coalesce$new$);
 execute body;
end $migration$;
notify pgrst,'reload schema';
commit;
