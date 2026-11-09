-- Aula 1.0 is opt-in. No feeds, calendar rows, schedules or production secrets
-- are modified by this additive migration. Raw provider content is never stored.
create table public.aula_connections (
 household_id uuid primary key references public.households(id) on delete cascade,
 status text not null default 'disconnected' check(status in ('disconnected','connecting','connected','reauth_required','error')),
 created_by uuid not null references auth.users(id),
 identity_label text check(length(identity_label)<=120), api_version integer,
 connected_at timestamptz, last_scan_at timestamptz, last_success_at timestamptz,
 last_error_code text check(last_error_code is null or last_error_code ~ '^AULA_[A-Z_]+$'),
 scan_counts jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table private.aula_credentials (
 household_id uuid primary key references public.aula_connections(household_id) on delete cascade,
 encrypted_session jsonb not null check(encrypted_session->>'version'='1'),
 generation uuid not null default gen_random_uuid(), updated_at timestamptz not null default now()
);
create table private.aula_login_flows (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id), status text not null default 'waiting' check(status in ('waiting','identity')),
 identity_count integer not null default 0, selected_identity integer,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '5 minutes',
 unique(household_id)
);
create table private.aula_login_attempts (
 id bigint generated always as identity primary key, household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id), attempted_at timestamptz not null default now()
);
create index on private.aula_login_attempts(household_id,attempted_at);
create index on private.aula_login_attempts(user_id,attempted_at);
create table private.aula_scan_locks (
 household_id uuid primary key references public.aula_connections(household_id) on delete cascade,
 lease uuid not null default gen_random_uuid(), generation uuid not null, expires_at timestamptz not null default now()+interval '5 minutes'
);
create table public.aula_child_mappings (
 household_id uuid not null references public.aula_connections(household_id) on delete cascade,
 provider_child_key text not null check(provider_child_key ~ '^[a-f0-9]{64}$'),
 person_id uuid, display_name text not null check(length(display_name)<=120),
 school text not null default '' check(length(school)<=200), class_name text not null default '' check(length(class_name)<=80),
 group_names text[] not null default '{}', updated_at timestamptz not null default now(),
 primary key(household_id,provider_child_key),
 foreign key(household_id,person_id) references public.household_people(household_id,id)
);
create table public.aula_findings (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.aula_connections(household_id) on delete cascade,
 person_id uuid, person_ids uuid[] not null default '{}' check(cardinality(person_ids)<=30),
 source_kind text not null check(source_kind in ('calendar','message','meebook','post','notification')),
 source_key text not null check(source_key ~ '^[a-f0-9]{64}$'),
 type text not null check(type in ('CALENDAR_EVENT','HOMEWORK','REMINDER','TRIP','DEADLINE','GENERAL_INFO')),
 title text not null check(length(title) between 1 and 160), date date, time text check(time is null or time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 end_date date, end_time text check(end_time is null or end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 location text not null default '' check(length(location)<=200),
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
 reason text not null check(length(reason)<=300), summary text not null check(length(summary)<=500),
 proposed_action text not null check(proposed_action in ('CREATE_ACTIVITY','NO_ACTION','MATCH_EXISTING')),
 status text not null default 'new' check(status in ('new','accepted','ignored','stale')),
 matched_calendar_item_id uuid references public.calendar_items(id) on delete set null,
 created_calendar_item_id uuid references public.calendar_items(id) on delete set null,
 source_updated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(household_id,source_key), foreign key(household_id,person_id) references public.household_people(household_id,id)
);
create index on public.aula_findings(household_id,status,date);

create function private.aula_adult(hid uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.household_members m join auth.users u on u.id=m.user_id
 where m.household_id=hid and m.user_id=uid and m.role in ('owner','admin','adult') and not coalesce(u.is_anonymous,false));
$$;
revoke all on function private.aula_adult(uuid,uuid) from public,anon;
grant execute on function private.aula_adult(uuid,uuid) to authenticated,service_role;
alter table public.aula_connections enable row level security;
alter table public.aula_child_mappings enable row level security;
alter table public.aula_findings enable row level security;
alter table private.aula_credentials enable row level security;
alter table private.aula_login_flows enable row level security;
alter table private.aula_login_attempts enable row level security;
alter table private.aula_scan_locks enable row level security;
revoke all on public.aula_connections,public.aula_child_mappings,public.aula_findings from public,anon,authenticated;
grant select on public.aula_connections,public.aula_child_mappings,public.aula_findings to authenticated;
grant all on public.aula_connections,public.aula_child_mappings,public.aula_findings to service_role;
revoke all on private.aula_credentials,private.aula_login_flows,private.aula_login_attempts,private.aula_scan_locks from public,anon,authenticated,service_role;
create policy aula_connection_read on public.aula_connections for select to authenticated using(private.aula_adult(household_id));
create policy aula_mapping_read on public.aula_child_mappings for select to authenticated using(private.aula_adult(household_id));
create policy aula_finding_read on public.aula_findings for select to authenticated using(private.is_household_member(household_id));

-- Service-only gateway. All writes are transactional, scoped and fenced by
-- flow/lease IDs. Possession of a public Supabase key grants no access here.
create function private.aula_server(action text,hid uuid,uid uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f private.aula_login_flows; c private.aula_credentials; l private.aula_scan_locks;
 x jsonb; result jsonb; fid uuid; code text; saved_status text; people uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('aula:'||hid::text,0));
 if action not in ('scan_claim','scan_credentials','scan_save_session','scan_finish','scan_fail') and not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 if uid is not null and not private.aula_adult(hid,uid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 if action='begin' then
  delete from private.aula_login_attempts where attempted_at<now()-interval '1 day';
  if (select count(*) from private.aula_login_attempts where (household_id=hid or user_id=uid) and attempted_at>now()-interval '15 minutes')>=4 then raise exception 'AULA_RATE_LIMIT'; end if;
  if exists(select 1 from private.aula_login_flows where household_id=hid and expires_at>now()) or exists(select 1 from private.aula_scan_locks where household_id=hid and expires_at>now()) then raise exception 'AULA_BUSY'; end if;
  insert into private.aula_login_attempts(household_id,user_id) values(hid,uid);
  delete from private.aula_login_flows where household_id=hid;
  insert into public.aula_connections(household_id,created_by,status) values(hid,uid,'connecting') on conflict(household_id) do update set status='connecting',last_error_code=null,updated_at=now();
  insert into private.aula_login_flows(household_id,user_id) values(hid,uid) returning id into fid;
  return jsonb_build_object('flow_id',fid);
 elsif action in ('flow','identity_wait','identity_choose','finish','cancel') then
  select * into f from private.aula_login_flows where id=(p->>'flow_id')::uuid and household_id=hid and user_id=uid;
  if f.id is null or f.expires_at<=now() then raise exception 'AULA_FLOW_EXPIRED'; end if;
  if action='flow' then return jsonb_build_object('selected_identity',f.selected_identity); end if;
  if action='identity_wait' then
   if (p->>'count')::int not between 1 and 30 then raise exception 'AULA_INVALID_IDENTITY'; end if;
   update private.aula_login_flows set status='identity',identity_count=(p->>'count')::int where id=f.id; return '{}';
  elsif action='identity_choose' then
   if f.status<>'identity' or (p->>'index')::int not between 1 and f.identity_count or p->>'index' is null then raise exception 'AULA_INVALID_IDENTITY'; end if;
   update private.aula_login_flows set selected_identity=(p->>'index')::int where id=f.id and selected_identity is null; return '{}';
  elsif action='finish' then
   insert into private.aula_credentials(household_id,encrypted_session) values(hid,p->'encrypted_session') on conflict(household_id) do update set encrypted_session=excluded.encrypted_session,generation=gen_random_uuid(),updated_at=now();
   update public.aula_connections set status='connected',identity_label=left(p->>'identity_label',120),connected_at=now(),last_error_code=null,updated_at=now() where household_id=hid;
  else
   code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else null end;
   update public.aula_connections set status=case when exists(select 1 from private.aula_credentials where household_id=hid) then 'connected' else 'disconnected' end,last_error_code=code,updated_at=now() where household_id=hid;
  end if;
  delete from private.aula_login_flows where id=f.id; return '{}';
 elsif action='status' then
  delete from private.aula_login_flows where household_id=hid and expires_at<=now();
  update public.aula_connections set status=case when exists(select 1 from private.aula_credentials where household_id=hid) then 'connected' else 'disconnected' end,last_error_code='AULA_TIMEOUT',updated_at=now() where household_id=hid and status='connecting' and not exists(select 1 from private.aula_login_flows where household_id=hid);
  return jsonb_build_object('connection',(select to_jsonb(a) from public.aula_connections a where household_id=hid),'mappings',coalesce((select jsonb_agg(to_jsonb(m)) from public.aula_child_mappings m where household_id=hid),'[]'::jsonb),'findings',coalesce((select jsonb_agg(to_jsonb(v) order by v.date nulls last,v.created_at desc) from public.aula_findings v where household_id=hid and (v.status='new' or v.updated_at>now()-interval '14 days')),'[]'::jsonb),'scanning',exists(select 1 from private.aula_scan_locks where household_id=hid and expires_at>now()));
 elsif action='disconnect' then
  delete from private.aula_credentials where household_id=hid;
  delete from private.aula_login_flows where household_id=hid;
  delete from private.aula_scan_locks where household_id=hid;
  update public.aula_connections set status='disconnected',identity_label=null,last_error_code=null,updated_at=now() where household_id=hid;
  return '{}';
 elsif action='scan_claim' then
  if exists(select 1 from private.aula_login_flows where household_id=hid and expires_at>now()) then raise exception 'AULA_BUSY'; end if;
  select * into c from private.aula_credentials where household_id=hid;
  if c.household_id is null then raise exception 'AULA_REAUTH_REQUIRED'; end if;
  delete from private.aula_scan_locks where household_id=hid and expires_at<=now();
  if exists(select 1 from private.aula_scan_locks where household_id=hid) then raise exception 'AULA_BUSY'; end if;
  insert into private.aula_scan_locks(household_id,generation) values(hid,c.generation) returning * into l;
  select last_success_at::text into saved_status from public.aula_connections where household_id=hid;
  update public.aula_connections set last_scan_at=now(),updated_at=now() where household_id=hid;
  return jsonb_build_object('lease',l.lease,'encrypted_session',c.encrypted_session,'last_success_at',saved_status,'mappings',coalesce((select jsonb_agg(to_jsonb(m)) from public.aula_child_mappings m where household_id=hid),'[]'::jsonb));
 elsif action in ('scan_credentials','scan_save_session','scan_finish','scan_fail') then
  select * into l from private.aula_scan_locks where household_id=hid and lease=(p->>'lease')::uuid and expires_at>now();
  select * into c from private.aula_credentials where household_id=hid;
  if l.lease is null or c.generation is distinct from l.generation then raise exception 'AULA_LEASE_EXPIRED'; end if;
  if action='scan_credentials' then return c.encrypted_session;
  elsif action='scan_save_session' then update private.aula_credentials set encrypted_session=p->'encrypted_session',updated_at=now() where household_id=hid; return '{}';
  elsif action='scan_finish' then
   for x in select value from jsonb_array_elements(coalesce(p->'children','[]')) loop
    insert into public.aula_child_mappings(household_id,provider_child_key,display_name,school,class_name,group_names)
    values(hid,x->>'provider_child_key',left(x->>'display_name',120),left(coalesce(x->>'school',''),200),left(coalesce(x->>'class_name',''),80),array(select jsonb_array_elements_text(coalesce(x->'group_names','[]'))))
    on conflict(household_id,provider_child_key) do update set display_name=excluded.display_name,school=excluded.school,class_name=excluded.class_name,group_names=excluded.group_names,updated_at=now();
   end loop;
   for x in select value from jsonb_array_elements(coalesce(p->'findings','[]')) loop
    people=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(x->'person_ids',case when nullif(x->>'person_id','') is null then '[]'::jsonb else jsonb_build_array(x->>'person_id') end)));
    if cardinality(people)>30 or exists(select 1 from unnest(people) pid where not exists(select 1 from public.aula_child_mappings where household_id=hid and person_id=pid)) then raise exception 'AULA_UNMAPPED_PERSON'; end if;
    insert into public.aula_findings(household_id,person_id,person_ids,source_kind,source_key,type,title,date,time,end_date,end_time,location,confidence,reason,summary,proposed_action,source_updated_at)
    values(hid,case when cardinality(people)=1 then people[1] end,people,x->>'source_kind',x->>'source_key',x->>'type',x->>'title',nullif(x->>'date','')::date,nullif(x->>'time',''),nullif(x->>'end_date','')::date,nullif(x->>'end_time',''),coalesce(x->>'location',''),x->>'confidence',x->>'reason',x->>'summary',x->>'proposed_action',nullif(x->>'source_updated_at','')::timestamptz)
    on conflict(household_id,source_key) do update set person_id=excluded.person_id,person_ids=excluded.person_ids,title=excluded.title,date=excluded.date,time=excluded.time,end_date=excluded.end_date,end_time=excluded.end_time,location=excluded.location,confidence=excluded.confidence,reason=excluded.reason,summary=excluded.summary,proposed_action=excluded.proposed_action,source_updated_at=excluded.source_updated_at,updated_at=now() where aula_findings.status='new';
   end loop;
   update public.aula_findings set status='stale',updated_at=now() where household_id=hid and status='new' and date<current_date-7;
   update public.aula_connections set status='connected',api_version=(p->>'api_version')::int,last_success_at=now(),last_error_code=null,scan_counts=coalesce(p->'counts','{}'),updated_at=now() where household_id=hid;
  else
   code=case when p->>'error' ~ '^AULA_[A-Z_]+$' then p->>'error' else 'AULA_TEMPORARY_ERROR' end;
   update public.aula_connections set status=case when code in ('AULA_REAUTH_REQUIRED','AULA_SESSION_INVALID') then 'reauth_required' else 'connected' end,last_error_code=code,updated_at=now() where household_id=hid;
  end if;
  delete from private.aula_scan_locks where household_id=hid and lease=l.lease; return '{}';
 end if;
 raise exception 'AULA_INVALID_ACTION';
end $$;
revoke all on function private.aula_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.aula_server(text,uuid,uuid,jsonb) to service_role;
create function public.aula_server(p_action text,p_household_id uuid,p_user_id uuid,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.aula_server(p_action,p_household_id,p_user_id,p_payload)$$;
revoke all on function public.aula_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.aula_server(text,uuid,uuid,jsonb) to service_role;

create function private.aula_map(hid uuid, mappings jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare m jsonb;
begin
 if not private.aula_adult(hid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(mappings)<>'array' or jsonb_array_length(mappings)>30 then raise exception 'AULA_INVALID_MAPPING'; end if;
 for m in select value from jsonb_array_elements(mappings) loop
  if nullif(m->>'person_id','') is not null and not exists(select 1 from public.household_people where household_id=hid and id=(m->>'person_id')::uuid and is_active) then raise exception 'AULA_INVALID_MAPPING'; end if;
  update public.aula_child_mappings set person_id=nullif(m->>'person_id','')::uuid,updated_at=now() where household_id=hid and provider_child_key=m->>'provider_child_key';
  if not found then raise exception 'AULA_INVALID_MAPPING'; end if;
 end loop;
end $$;
revoke all on function private.aula_map(uuid,jsonb) from public,anon;
grant execute on function private.aula_map(uuid,jsonb) to authenticated;
create function public.aula_set_child_mappings(p_household_id uuid,p_mappings jsonb) returns void language sql security invoker set search_path='' as $$select private.aula_map(p_household_id,p_mappings)$$;
revoke all on function public.aula_set_child_mappings(uuid,jsonb) from public,anon;
grant execute on function public.aula_set_child_mappings(uuid,jsonb) to authenticated;

create function private.aula_review(hid uuid,fid uuid,action text,selected_people uuid[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.aula_findings; item_id uuid; payload jsonb; people uuid[]; names jsonb;
begin
 if not private.aula_adult(hid) then raise exception 'AULA_FORBIDDEN' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(hid::text,0));
 select * into f from public.aula_findings where household_id=hid and id=fid for update;
 if f.id is null or action not in ('accept','ignore','review') then raise exception 'AULA_INVALID_FINDING'; end if;
 if f.status<>'new' then return jsonb_build_object('status',f.status,'item_id',f.created_calendar_item_id); end if;
 if action='ignore' then update public.aula_findings set status='ignored',updated_at=now() where id=fid; return '{"status":"ignored"}'; end if;
 if f.type='GENERAL_INFO' or f.proposed_action='NO_ACTION' then
  update public.aula_findings set status='accepted',updated_at=now() where id=fid; return '{"status":"accepted"}';
 end if;
 if action<>'accept' or f.date is null or f.confidence='LOW' or f.proposed_action not in ('CREATE_ACTIVITY','MATCH_EXISTING') then raise exception 'AULA_REVIEW_REQUIRED'; end if;
 people=array(select distinct pid from unnest(coalesce(selected_people,case when cardinality(f.person_ids)>0 then f.person_ids else array_remove(array[f.person_id],null) end)) pid order by pid);
 if cardinality(people) not between 1 and 30 or exists(select 1 from unnest(people) pid where not exists(select 1 from public.household_people where household_id=hid and id=pid and is_active)) then raise exception 'AULA_INVALID_MAPPING'; end if;
 select jsonb_agg(p.name order by p.id) into names from public.household_people p where p.household_id=hid and p.id=any(people);
 -- School semantics NEVER choose a family chore. Match only the exact people set.
 select id into item_id from public.calendar_items i where i.household_id=hid and i.type='Aktivitet' and i.person_ids @> people and i.person_ids <@ people and
  (i.data->>'aulaSourceKey'=f.source_key or
   (i.date=f.date and coalesce(i.time,'')=coalesce(f.time,'') and
    regexp_replace(lower(i.title),'[^[:alnum:]]','','g')=regexp_replace(lower(f.title),'[^[:alnum:]]','','g') and
    (coalesce(i.location,'')='' or f.location='' or lower(i.location)=lower(f.location)))) limit 1;
 if item_id is null then
  item_id=gen_random_uuid();
  payload=jsonb_build_object('id',item_id,'title',f.title,'date',f.date,'time',f.time,'type','Aktivitet','person',names->>0,'person_ids',to_jsonb(people),'note',f.summary,'location',f.location,'done',false,'data',jsonb_build_object('aulaFindingId',f.id,'aulaSourceKey',f.source_key,'aulaAssisted',true,'aulaSourceKind',f.source_kind,'people',names,'endDate',f.end_date,'endTime',f.end_time,'allDay',f.time is null));
  perform public.mutate_calendar(hid,'[]'::jsonb,jsonb_build_array(payload),'{}'::uuid[]);
 else
  update public.aula_findings set matched_calendar_item_id=item_id where id=fid;
 end if;
 update public.aula_findings set status='accepted',person_id=case when cardinality(people)=1 then people[1] end,person_ids=people,created_calendar_item_id=item_id,updated_at=now() where id=fid;
 return jsonb_build_object('status','accepted','item_id',item_id);
end $$;
revoke all on function private.aula_review(uuid,uuid,text,uuid[]) from public,anon;
grant execute on function private.aula_review(uuid,uuid,text,uuid[]) to authenticated;
create function public.aula_review(p_household_id uuid,p_finding_id uuid,p_action text,p_person_ids uuid[] default null) returns jsonb language sql security invoker set search_path='' as $$select private.aula_review(p_household_id,p_finding_id,p_action,p_person_ids)$$;
revoke all on function public.aula_review(uuid,uuid,text,uuid[]) from public,anon;
grant execute on function public.aula_review(uuid,uuid,text,uuid[]) to authenticated;
