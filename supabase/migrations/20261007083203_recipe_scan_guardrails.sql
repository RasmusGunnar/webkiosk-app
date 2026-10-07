begin;
-- No images, credentials or provider output are stored in the rate-limit ledger.
create table private.recipe_scan_requests (
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 requested_at timestamptz not null default clock_timestamp()
);
create index recipe_scan_requests_window on private.recipe_scan_requests(household_id,requested_at);
revoke all on private.recipe_scan_requests from public,anon,authenticated;
create or replace function public.claim_recipe_scan(p_household_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare per_user_limit constant integer=6; per_household_limit constant integer=12; moment timestamptz=clock_timestamp();
begin
 if auth.uid() is null or not private.is_household_member(p_household_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household_id::text,4040));
 delete from private.recipe_scan_requests where household_id=p_household_id and requested_at<moment-interval '2 minutes';
 if (select count(*) from private.recipe_scan_requests where household_id=p_household_id and requested_at>moment-interval '1 minute')>=per_household_limit
 or (select count(*) from private.recipe_scan_requests where household_id=p_household_id and user_id=auth.uid() and requested_at>moment-interval '1 minute')>=per_user_limit then return false; end if;
 insert into private.recipe_scan_requests(household_id,user_id,requested_at) values(p_household_id,auth.uid(),moment);
 return true;
end $$;
revoke all on function public.claim_recipe_scan(uuid) from public,anon;
grant execute on function public.claim_recipe_scan(uuid) to authenticated;

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
  if jsonb_typeof(line) not in ('string','object') then raise exception 'Invalid ingredient'; end if;
  if jsonb_typeof(line)='object' and (length(line::text)>6000 or jsonb_typeof(line->'raw_text') is distinct from 'string') then raise exception 'Invalid ingredient'; end if;
  insert into public.recipe_ingredients(recipe_id,position,raw_text,ingredient_name,quantity,unit,note)
  values(p_id,pos,case when jsonb_typeof(line)='string' then line#>>'{}' else line->>'raw_text' end,line->>'ingredient_name',(line->>'quantity')::numeric,line->>'unit',line->>'note');pos=pos+1;
 end loop;
 pos=0;delete from public.recipe_instructions where recipe_id=p_id;
 for line in select value from jsonb_array_elements(p_recipe->'instructions') loop
  if jsonb_typeof(line)<>'string' then raise exception 'Invalid instruction'; end if;
  insert into public.recipe_instructions(recipe_id,position,text) values(p_id,pos,line#>>'{}');pos=pos+1;
 end loop;return p_id;
end $$;
revoke all on function public.save_recipe(uuid,uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_recipe(uuid,uuid,jsonb,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
