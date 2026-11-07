-- One calendar task, one status per (household, origin, occurrence date, person).
-- Reuse reward occurrences, their RLS, revision invalidation, audit and idempotency.
begin;

-- Legacy shared DONE did not record who completed it. Preserve that visible history
-- for every currently assigned person, including archived people. Only the actual
-- completed date/override is copied, never later repeats or newly added people.
-- No rewards/ledger/snapshots are created or recalculated by this backfill.
insert into public.task_reward_occurrences
 (household_id,person_id,origin_id,occurrence_date,due_date,task_id,title,reward_mode,status,requires_approval,reason)
select i.household_id,p.id,t.origin_id,t.occurrence_date,t.due_date,t.task_id,t.title,'none','completed',false,'legacy_shared_done'
from public.calendar_items i
cross join lateral private.reward_task_instances(i.household_id,i.date,i.date) t
join public.household_people p on p.household_id=i.household_id
where i.type='Opgave' and i.done and t.task_id=i.id and t.legacy_done
 and t.rule->>'mode'='none' and not (t.rule->>'approval')::boolean
 and private.task_assigned_to(t.person_ids,t.people,p.id,p.name,p.name_aliases)
on conflict(household_id,origin_id,occurrence_date,person_id) do nothing;

-- Keep the established money/period implementation and Native wall authorization.
-- Fail atomically if its expected guards have changed, rather than silently patching
-- an unknown version of this security-definer function.
do $migration$
declare body text; before_body text;
begin
 body:=pg_get_functiondef('private.reward_action(uuid,uuid,text,jsonb)'::regprocedure);
 before_body:=body;
 body:=replace(body,$old$  if rule->>'mode'='none' and not (rule->>'approval')::boolean then raise exception 'Brug almindelig udført-markering for denne opgave'; end if;$old$,
 $new$  -- Ordinary tasks use the same assignment state as rewarded tasks.$new$);
 if body=before_body then raise exception 'Missing ordinary task guard';end if;
 before_body:=body;
 body:=replace(body,$old$when s.requires_approval then 'pending'$old$,
 $new$when s.requires_approval and not (is_adult and person.role='adult') then 'pending'$new$);
 if body=before_body then raise exception 'Missing approval transition';end if;
 before_body:=body;
 body:=replace(body,$old$   if p_action='undo' and s.status in ('excused','cancelled')$old$,
 $new$   if p_action='undo' and s.status='approved' and not is_adult then raise exception 'Kun voksne kan genåbne en godkendt opgave' using errcode='42501';end if;
   if p_action='undo' and s.status in ('excused','cancelled')$new$);
 if body=before_body then raise exception 'Missing reopen guard';end if;
 execute body;

 body:=pg_get_functiondef('private.guard_task_rewards()'::regprocedure);
 before_body:=body;
 body:=replace(body,'if managed and new.done and new.date>=private.reward_today() and', 'if new.done and');
 if body=before_body then raise exception 'Missing shared done guard';end if;
 execute body;
end $migration$;

-- Historical shared booleans no longer contribute once materialized per person.
create or replace function private.completed_task_rows(hid uuid,week_start date,through_date date)
returns table(id uuid,occurrence_key text,title text,date date,person_ids uuid[],people jsonb)
language sql stable security invoker set search_path='' as $$
 select s.id,s.origin_id::text||'|'||s.occurrence_date::text,s.title,s.due_date,array[s.person_id],jsonb_build_array(p.name)
 from public.task_reward_occurrences s join public.household_people p on p.id=s.person_id
 where s.household_id=hid and s.status in ('completed','approved') and s.due_date between week_start and through_date;
$$;

-- The restricted wall endpoint uses the same person RPC even for ordinary tasks.
-- Existing pairing/capability/access gates and allowed action set stay intact.
create or replace function private.complete_task_as_device(p_request_id uuid,p_item_id uuid,p_due_date date,p_person_id uuid default null,p_done boolean default true,p_action text default 'complete')
returns jsonb language plpgsql security definer set search_path='' as $$
declare hid uuid:=(private.wall_device()).household_id;t record;begin
 if hid is null or not private.wall_can_complete(hid,p_action) then raise exception 'Device access denied' using errcode='42501';end if;
 if p_due_date is null or p_due_date>private.reward_today() or p_due_date<private.reward_today()-31 then raise exception 'Vælg en aktuel opgave';end if;
 if p_person_id is null then raise exception 'Vælg en person';end if;
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 select * into t from private.reward_task_instances(hid,p_due_date,p_due_date) where task_id=p_item_id and (cardinality(person_ids)=0 or p_person_id=any(person_ids)) limit 1;
 if not found then raise exception 'Opgaven findes ikke';end if;
 return private.reward_action(p_request_id,hid,p_action,jsonb_build_object('person_id',p_person_id,'item_id',p_item_id,'due_date',p_due_date,'occurrence_date',t.occurrence_date));
end $$;
commit;
