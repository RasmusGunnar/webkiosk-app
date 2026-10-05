-- Recipes 3.0: additive household library. Local review only.
begin;
create table public.recipes (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 160), description text check(length(description)<=4000),
 source_type text not null default 'manual' check(source_type in ('manual','url','photo')),
 source_url text check(length(source_url)<=4096), source_name text check(length(source_name)<=200),
 image_path text, original_image_url text check(length(original_image_url)<=4096),
 servings numeric check(servings>0 and servings<=10000), prep_minutes numeric check(prep_minutes>0 and prep_minutes<=10000),
 cook_minutes numeric check(cook_minutes>0 and cook_minutes<=10000), total_minutes numeric check(total_minutes>0 and total_minutes<=10000),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(), archived_at timestamptz,
 unique(household_id,id),
 check(image_path is null or (split_part(image_path,'/',1)=household_id::text and split_part(image_path,'/',2)=id::text and image_path not like '%..%'))
);
create index recipes_household on public.recipes(household_id,archived_at,title);
create index recipes_source on public.recipes(household_id,source_url);
create index recipes_creator on public.recipes(created_by);
create table public.recipe_ingredients (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id) on delete cascade,
 position integer not null check(position between 0 and 99), raw_text text not null check(length(raw_text) between 1 and 1000),
 ingredient_name text, quantity numeric, unit text, note text, category text, unique(recipe_id,position)
);
create table public.recipe_instructions (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.recipes(id) on delete cascade,
 position integer not null check(position between 0 and 99), text text not null check(length(text) between 1 and 10000), unique(recipe_id,position)
);
create table public.recipe_ratings (
 recipe_id uuid not null references public.recipes(id) on delete cascade,
 person_id uuid not null references public.household_people(id) on delete cascade,
 rating text not null check(rating in ('love','like','okay','dislike')), updated_at timestamptz not null default clock_timestamp(),
 primary key(recipe_id,person_id)
);
create index recipe_ratings_person on public.recipe_ratings(person_id);
-- Projection preserves the calendar mutation and offline payload format.
alter table public.calendar_items add column recipe_id uuid generated always as (nullif(data->>'recipe_id','')::uuid) stored;
alter table public.calendar_items add constraint calendar_recipe_household foreign key(household_id,recipe_id) references public.recipes(household_id,id);
create index calendar_items_recipe on public.calendar_items(household_id,recipe_id,date) where recipe_id is not null;
-- servings_override and ingredient/meal origin remain in data; note reuses existing note.
create or replace function private.recipe_row_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='recipes' then
  if tg_op='UPDATE' and (new.id<>old.id or new.household_id<>old.household_id) then raise exception 'Recipe identity is immutable'; end if;
  new.updated_at=clock_timestamp();
 else
  if not exists(select 1 from public.recipes r join public.household_people p on p.household_id=r.household_id where r.id=new.recipe_id and p.id=new.person_id) then raise exception 'Person and recipe must belong to the same household' using errcode='23514'; end if;
  new.updated_at=clock_timestamp();
 end if;return new;
end $$;
create trigger recipe_guard before insert or update on public.recipes for each row execute function private.recipe_row_guard();
create trigger recipe_rating_guard before insert or update on public.recipe_ratings for each row execute function private.recipe_row_guard();
do $$ declare t text; begin
 foreach t in array array['recipes','recipe_ingredients','recipe_instructions','recipe_ratings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('grant select,insert,update on public.%I to authenticated',t);
 end loop;
end $$;
-- Shared household identity/edit rights follow the established meals/people policies.
create policy recipes_read on public.recipes for select to authenticated using(private.is_household_member(household_id));
create policy recipes_insert on public.recipes for insert to authenticated with check(private.is_household_member(household_id) and created_by=auth.uid());
create policy recipes_edit on public.recipes for update to authenticated using(private.is_household_member(household_id)) with check(private.is_household_member(household_id));
do $$ declare t text; begin
 foreach t in array array['recipe_ingredients','recipe_instructions','recipe_ratings'] loop
  execute format('grant delete on public.%I to authenticated',t);
  execute format('create policy recipe_children on public.%I for all to authenticated using(exists(select 1 from public.recipes r where r.id=recipe_id and private.is_household_member(r.household_id))) with check(exists(select 1 from public.recipes r where r.id=recipe_id and private.is_household_member(r.household_id)))',t);
 end loop;
end $$;
create or replace function public.save_recipe(p_household_id uuid,p_id uuid,p_recipe jsonb,p_expected timestamptz default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare old public.recipes; line jsonb; pos integer=0;
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Household access denied' using errcode='42501'; end if;
 select * into old from public.recipes where id=p_id for update;
 if found then
  if old.household_id<>p_household_id or p_expected is null or old.updated_at<>p_expected then raise exception 'Opskriften er ændret på en anden enhed. Åbn den igen.'; end if;
 else
  if p_expected is not null then raise exception 'Recipe no longer available'; end if;
  insert into public.recipes(id,household_id,title) values(p_id,p_household_id,p_recipe->>'title');
 end if;
 if jsonb_typeof(p_recipe->'ingredients') is distinct from 'array' or jsonb_typeof(p_recipe->'instructions') is distinct from 'array' or jsonb_array_length(p_recipe->'ingredients')>100 or jsonb_array_length(p_recipe->'instructions')>100 or length((p_recipe->'instructions')::text)>40000 then raise exception 'Invalid recipe lines'; end if;
 update public.recipes set title=p_recipe->>'title',description=p_recipe->>'description',source_type=coalesce(p_recipe->>'source_type','manual'),source_url=p_recipe->>'source_url',source_name=p_recipe->>'source_name',image_path=p_recipe->>'image_path',original_image_url=p_recipe->>'original_image_url',servings=(p_recipe->>'servings')::numeric,prep_minutes=(p_recipe->>'prep_minutes')::numeric,cook_minutes=(p_recipe->>'cook_minutes')::numeric,total_minutes=(p_recipe->>'total_minutes')::numeric where id=p_id;
 delete from public.recipe_ingredients where recipe_id=p_id;
 for line in select value from jsonb_array_elements(p_recipe->'ingredients') loop
  if jsonb_typeof(line)<>'string' then raise exception 'Invalid ingredient'; end if;
  insert into public.recipe_ingredients(recipe_id,position,raw_text) values(p_id,pos,line#>>'{}');pos=pos+1;
 end loop;
 pos=0;delete from public.recipe_instructions where recipe_id=p_id;
 for line in select value from jsonb_array_elements(p_recipe->'instructions') loop
  if jsonb_typeof(line)<>'string' then raise exception 'Invalid instruction'; end if;
  insert into public.recipe_instructions(recipe_id,position,text) values(p_id,pos,line#>>'{}');pos=pos+1;
 end loop;return p_id;
end $$;
revoke all on function public.save_recipe(uuid,uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_recipe(uuid,uuid,jsonb,timestamptz) to authenticated;
create or replace function private.bump_recipe_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare hid uuid; rid uuid;
begin
 if tg_table_name='recipes' then hid=coalesce(new.household_id,old.household_id);
 else rid=coalesce(new.recipe_id,old.recipe_id); select household_id into hid from public.recipes where id=rid; end if;
 if hid is not null and exists(select 1 from public.households where id=hid) then
  insert into public.calendar_revisions(household_id,items_version) values(hid,1) on conflict(household_id) do update set items_version=calendar_revisions.items_version+1;
 end if;return null;
end $$;
revoke all on function private.bump_recipe_revision() from public,anon,authenticated;
do $$ declare t text; begin foreach t in array array['recipes','recipe_ingredients','recipe_instructions','recipe_ratings'] loop
 execute format('create trigger recipe_revision after insert or update or delete on public.%I for each row execute function private.bump_recipe_revision()',t);
end loop;end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('recipe-images','recipe-images',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy recipe_images_read on storage.objects for select to authenticated using(bucket_id='recipe-images' and private.can_access_avatar(name));
create policy recipe_images_insert on storage.objects for insert to authenticated with check(bucket_id='recipe-images' and private.can_access_avatar(name) and array_length(storage.foldername(name),1)=2);
create policy recipe_images_delete on storage.objects for delete to authenticated using(bucket_id='recipe-images' and private.can_access_avatar(name));

-- Preserve existing export/deletion behavior while including the new private household data.
create or replace function private.begin_account_deletion(p_user_id uuid,p_delete_households uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare required uuid[]; job public.account_deletion_jobs; uid_email text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,5));
 perform 1 from auth.users where id=p_user_id for update;
 if not found then raise exception 'Account not found'; end if;
 select * into job from public.account_deletion_jobs where user_id=p_user_id;
 if found then return jsonb_build_object('household_ids',job.household_ids,'pending',true); end if;
 -- Lock the family parents before counting members; concurrent invitations/deletions serialize.
 perform 1 from public.households h where exists(select 1 from public.household_members m where m.household_id=h.id and m.user_id=p_user_id) order by h.id for update;
 select coalesce(array_agg(m.household_id order by m.household_id),'{}') into required
 from public.household_members m where m.user_id=p_user_id and m.role='owner'
 and not exists(select 1 from public.household_members n where n.household_id=m.household_id and n.role='owner' and n.user_id<>p_user_id);
 if required<>array(select distinct x from unnest(coalesce(p_delete_households,'{}')) x order by x) then
  raise exception 'Confirm each family where you are the only owner, or transfer ownership first' using errcode='23514';
 end if;
 if exists(select 1 from storage.objects where (owner_id=p_user_id::text or owner=p_user_id) and bucket_id not in ('household-avatars','recipe-images')) then
  raise exception 'Account owns unsupported storage objects' using errcode='23514';
 end if;
 insert into public.account_deletion_jobs(user_id,household_ids) values(p_user_id,required);
 -- Keep family-owned images for remaining members. Ownership metadata is not the access rule:
 -- the private bucket uses household membership. No files are deleted via SQL.
 update storage.objects set owner=null,owner_id=null where bucket_id in ('household-avatars','recipe-images') and (owner_id=p_user_id::text or owner=p_user_id);
 select lower(email) into uid_email from auth.users where id=p_user_id;
 delete from public.household_invitations where invited_by=p_user_id or lower(email)=uid_email;
 delete from public.calendar_feeds where household_id=any(required);
 delete from public.households where id=any(required);
 update public.households set created_by=null where created_by=p_user_id;
 update public.calendar_items set created_by=null where created_by=p_user_id;
 delete from public.native_devices where user_id=p_user_id;
 delete from public.calendar_mutation_receipts where user_id=p_user_id;
 delete from public.household_members where user_id=p_user_id;
 delete from public.profiles where id=p_user_id;
 return jsonb_build_object('household_ids',required,'pending',true);
end $$;

create or replace function private.export_family_data(p_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('format_version',1,'exported_at',now(),
 'household',(select jsonb_build_object('id',id,'name',name,'created_at',created_at) from public.households where id=p_household_id),
 'people',coalesce((select jsonb_agg(to_jsonb(p)-'avatar_url') from public.household_people p where household_id=p_household_id),'[]'),
 'calendar_and_tasks',coalesce((select jsonb_agg(to_jsonb(i)-'data'||jsonb_build_object('data',
  (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(i.data) where key=any(array['title','date','time','person','people','personIds','type','note','done','location','durationMin','repeatWeekly','repeatYearly','repeatUntil','birthYear','seriesId','overrideOf','overrideBaseId','exceptions','weekdays','originalDate','previousSeriesId','emoji','taskEmoji','rewardMode','starValue','requiresApproval','bonusPool','rewardOriginId','rewardRules','recipe_id','servings_override','meal_id','ingredient_id','ingredient_raw_text','recipe_action_id','recipe']))))
  from public.calendar_items i where household_id=p_household_id),'[]'),
 'reward_state',coalesce((select jsonb_agg(to_jsonb(r)) from public.reward_celebrations r where household_id=p_household_id),'[]'),
 'monthly_milestones',coalesce((select jsonb_agg(to_jsonb(m)) from public.reward_monthly_milestones m where household_id=p_household_id),'[]'),
 'rewards_v2',private.reward_state(p_household_id)||jsonb_build_object(
 'ledger',coalesce((select jsonb_agg(to_jsonb(l)) from public.reward_star_ledger l where household_id=p_household_id),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.reward_occurrence_events e where household_id=p_household_id),'[]')),
 'feed_metadata',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',source,'name',name,'assigned_person_id',assigned_person_id,'assigned_person_name',assigned_person_name,'is_active',is_active,'last_sync_at',last_sync_at,'last_sync_status',last_sync_status)) from public.calendar_feeds where household_id=p_household_id),'[]'),
 'recipes',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('ingredients',(select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]') from public.recipe_ingredients i where i.recipe_id=r.id),'instructions',(select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]') from public.recipe_instructions i where i.recipe_id=r.id),'ratings',(select coalesce(jsonb_agg(to_jsonb(v)),'[]') from public.recipe_ratings v where v.recipe_id=r.id))) from public.recipes r where household_id=p_household_id),'[]'),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.list_household_members(p_household_id) m),'[]'));
end $$;

create or replace function private.recipe_deletion_objects(p_user_id uuid)
returns table(name text) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 return query select o.name from storage.objects o join public.account_deletion_jobs j on j.user_id=p_user_id
 where o.bucket_id='recipe-images' and split_part(o.name,'/',1)=any(array(select unnest(j.household_ids)::text)) order by o.name limit 100;
end $$;
create or replace function public.recipe_deletion_objects(p_user_id uuid)
returns table(name text) language sql stable security invoker set search_path='' as $$select * from private.recipe_deletion_objects(p_user_id);$$;
revoke all on function private.recipe_deletion_objects(uuid),public.recipe_deletion_objects(uuid) from public,anon,authenticated;
grant execute on function private.recipe_deletion_objects(uuid),public.recipe_deletion_objects(uuid) to service_role;
create unique index calendar_recipe_shopping_action on public.calendar_items(household_id,(data->>'recipe_action_id'),(data->>'ingredient_id')) where type='Indkøb' and data->>'recipe_action_id' is not null and data->>'ingredient_id' is not null;

notify pgrst,'reload schema';
commit;
