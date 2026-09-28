-- Observed live model, captured read-only 2026-09-28. No data included.
-- Existing tables are retained. Review schema drift before applying to live.
-- Security is completed by the next migration; never deploy this file alone.
begin;

create table if not exists public.profiles (
  "id" uuid not null,
  "display_name" text,
  "avatar_url" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "profiles_pkey" PRIMARY KEY (id),
  constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.profiles enable row level security;

create table if not exists public.households (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "households_pkey" PRIMARY KEY (id),
  constraint "households_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
alter table public.households enable row level security;

create table if not exists public.household_members (
  "household_id" uuid not null,
  "user_id" uuid not null,
  "role" text not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "household_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'adult'::text, 'child'::text]))),
  constraint "household_members_pkey" PRIMARY KEY (household_id, user_id),
  constraint "household_members_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  constraint "household_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.household_members enable row level security;

create table if not exists public.household_people (
  "id" uuid default gen_random_uuid() not null,
  "household_id" uuid not null,
  "name" text not null,
  "role" text default 'child'::text not null,
  "color" text,
  "avatar_url" text,
  "sort_order" integer default 0 not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "household_people_role_check" CHECK ((role = ANY (ARRAY['adult'::text, 'child'::text, 'other'::text]))),
  constraint "household_people_pkey" PRIMARY KEY (id),
  constraint "household_people_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
alter table public.household_people enable row level security;

create table if not exists public.calendar_items (
  "id" uuid default gen_random_uuid() not null,
  "household_id" uuid not null,
  "title" text not null,
  "date" date,
  "time" text,
  "person" text,
  "type" text,
  "note" text,
  "done" boolean default false not null,
  "data" jsonb default '{}'::jsonb not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "source" text,
  "external_id" text,
  "calendar_id" text,
  "detached_from_feed" boolean default false not null,
  "location" text,
  "duration_min" integer,
  constraint "calendar_items_pkey" PRIMARY KEY (id),
  constraint "calendar_items_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  constraint "calendar_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
alter table public.calendar_items enable row level security;

create table if not exists public.calendar_feeds (
  "id" uuid default gen_random_uuid() not null,
  "household_id" uuid not null,
  "source" text not null,
  "name" text not null,
  "feed_url" text not null,
  "assigned_person_name" text,
  "is_active" boolean default true not null,
  "last_sync_at" timestamp with time zone,
  "last_sync_status" text,
  "last_sync_message" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "calendar_feeds_source_check" CHECK ((source = ANY (ARRAY['aula'::text, 'google'::text, 'ics'::text]))),
  constraint "calendar_feeds_pkey" PRIMARY KEY (id),
  constraint "calendar_feeds_household_id_fkey" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
alter table public.calendar_feeds enable row level security;
CREATE INDEX IF NOT EXISTS household_people_household_idx ON public.household_people USING btree (household_id);
CREATE INDEX IF NOT EXISTS calendar_items_household_idx ON public.calendar_items USING btree (household_id);
CREATE INDEX IF NOT EXISTS calendar_items_date_idx ON public.calendar_items USING btree (date);
CREATE INDEX IF NOT EXISTS calendar_items_source_idx ON public.calendar_items USING btree (household_id, source);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_items_external_unique ON public.calendar_items USING btree (household_id, source, external_id);
CREATE INDEX IF NOT EXISTS calendar_feeds_household_idx ON public.calendar_feeds USING btree (household_id);

commit;
