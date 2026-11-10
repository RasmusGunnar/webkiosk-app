-- Correct review values atomically, then reuse the existing activity-only,
-- household-scoped, idempotent acceptance path. No existing rows are migrated.
create function private.aula_review_corrected(hid uuid,fid uuid,action text,selected_people uuid[],date_value text,time_value text,title_value text,override_time boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.aula_findings; chosen_date date; chosen_time text; chosen_title text; chosen_end date; chosen_end_time text; duration interval; finish timestamp;
begin
 if not private.aula_adult(hid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 select * into f from public.aula_findings where household_id=hid and id=fid for update;
 if f.id is null then raise exception 'AULA_INVALID_FINDING'; end if;
 if date_value is null and time_value is null and title_value is null and not coalesce(override_time,false) then return private.aula_review(hid,fid,action,selected_people); end if;
 if f.status<>'new' or action is distinct from 'accept' or f.type='GENERAL_INFO' or f.proposed_action='NO_ACTION' then
  return private.aula_review(hid,fid,action,selected_people);
 end if;
 chosen_date=f.date;
 if date_value is not null then
  if date_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'AULA_INVALID_DATE'; end if;
  begin chosen_date=date_value::date; exception when datetime_field_overflow or invalid_datetime_format then raise exception 'AULA_INVALID_DATE'; end;
  if to_char(chosen_date,'YYYY-MM-DD')<>date_value then raise exception 'AULA_INVALID_DATE'; end if;
 end if;
 if chosen_date is null then raise exception 'AULA_INVALID_DATE'; end if;
 if time_value is not null and time_value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'AULA_INVALID_TIME'; end if;
 chosen_time=case when coalesce(override_time,false) or time_value is not null then time_value else f.time end;
 chosen_title=btrim(coalesce(title_value,f.title));
 if length(chosen_title) not between 1 and 160 then raise exception 'AULA_INVALID_TITLE'; end if;
 chosen_end=f.end_date; chosen_end_time=f.end_time;
 if f.date is not null and chosen_end is not null then chosen_end=chosen_end+(chosen_date-f.date); end if;
 if chosen_time is null then chosen_end_time=null;
 elsif f.date is not null and f.time is not null and f.end_time is not null and (chosen_date is distinct from f.date or chosen_time is distinct from f.time) then
  duration=(coalesce(f.end_date,f.date)+f.end_time::time)-(f.date+f.time::time);
  if duration>=interval '0 seconds' then finish=chosen_date+chosen_time::time+duration; chosen_end=finish::date; chosen_end_time=to_char(finish,'HH24:MI'); else chosen_end_time=null; end if;
 end if;
 if chosen_end<chosen_date then chosen_end=null; chosen_end_time=null; end if;
 update public.aula_findings set date=chosen_date,time=chosen_time,title=chosen_title,end_date=chosen_end,end_time=chosen_end_time where household_id=hid and id=fid;
 -- A rejected person selection rolls back the correction in the same transaction.
 return private.aula_review(hid,fid,action,selected_people);
end $$;
revoke all on function private.aula_review_corrected(uuid,uuid,text,uuid[],text,text,text,boolean) from public,anon;
grant execute on function private.aula_review_corrected(uuid,uuid,text,uuid[],text,text,text,boolean) to authenticated;

-- One RPC signature, compatible with old clients omitting the new arguments.
-- p_override_time distinguishes clearing a time from an old client's omission.
drop function public.aula_review(uuid,uuid,text,uuid[]);
create function public.aula_review(p_household_id uuid,p_finding_id uuid,p_action text,p_person_ids uuid[] default null,p_date text default null,p_time text default null,p_title text default null,p_override_time boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select private.aula_review_corrected(p_household_id,p_finding_id,p_action,p_person_ids,p_date,p_time,p_title,p_override_time)$$;
revoke all on function public.aula_review(uuid,uuid,text,uuid[],text,text,text,boolean) from public,anon;
grant execute on function public.aula_review(uuid,uuid,text,uuid[],text,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
