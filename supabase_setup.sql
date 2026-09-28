-- Idempotent setup script for Supabase Realtime sync
-- Run this in the Supabase SQL editor for your project.

-- Calendar items table
create table if not exists public.calendar_items (
  id bigint generated always as identity primary key,
  hid text not null,
  uid text not null,
  data jsonb not null default '{}'::jsonb,
  title text not null default '',
  date date not null,
  time text not null default '',
  person text not null default 'Alle',
  type text not null default 'Aktivitet',
  note text not null default '',
  done boolean not null default false,
  repeat_weekly boolean not null default false,
  inserted_at timestamp with time zone default timezone('utc', now()),
  updated_at timestamp with time zone default timezone('utc', now())
);

create unique index if not exists calendar_items_hid_uid_idx on public.calendar_items (hid, uid);

alter table public.calendar_items enable row level security;

do $$
begin
  alter publication supabase_realtime add table public.calendar_items;
exception
  when duplicate_object then null;
end;
$$;

-- People preferences table
create table if not exists public.people_prefs (
  hid text primary key,
  people jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc', now())
);

alter table public.people_prefs enable row level security;

do $$
begin
  alter publication supabase_realtime add table public.people_prefs;
exception
  when duplicate_object then null;
end;
$$;

-- RLS policies for anon access

do $$
begin
  create policy "Anon read" on public.calendar_items
    for select using (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Anon upsert" on public.calendar_items
    for insert with check (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Anon update" on public.calendar_items
    for update using (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Anon delete" on public.calendar_items
    for delete using (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Anon read prefs" on public.people_prefs
    for select using (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Anon upsert prefs" on public.people_prefs
    for insert with check (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create policy "Anon update prefs" on public.people_prefs
    for update using (auth.role() = 'anon');
exception
  when duplicate_object then null;
end;
$$;
