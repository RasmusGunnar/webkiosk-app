-- Explicit archived cleanup, separate from schema installation.
-- Run only after reviewing immutable-identity groups; conflicts abort atomically.
-- This task applies this operation ONLY to the local Supabase copy.
begin;
select public.reconcile_calendar_imports(id) from public.calendar_feeds order by id;
commit;
