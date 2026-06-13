-- Portal Tracker — Supabase schema.
-- Run this once in your project's SQL Editor (Dashboard → SQL → New query).
-- It creates the per-user collection tables with row-level security so each
-- account can only read/write its own rows, plus a public image bucket.

-- ---- owned figures ---------------------------------------------------------
create table if not exists public.owned (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,                 -- "charId:variantId"
  char_id    integer not null,
  variant_id integer not null,
  name       text not null,
  section    text not null default '',
  unknown    boolean not null default false,
  copies     jsonb not null default '[]'::jsonb,  -- [{uid, firstSeen, lastSeen, scans}]
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.owned enable row level security;

drop policy if exists "owned is private" on public.owned;
create policy "owned is private" on public.owned
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---- wishlist --------------------------------------------------------------
create table if not exists public.wishlist (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  char_id    integer not null,
  variant_id integer not null,
  name       text not null,
  section    text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.wishlist enable row level security;

drop policy if exists "wishlist is private" on public.wishlist;
create policy "wishlist is private" on public.wishlist
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---- figure image bucket (public read) -------------------------------------
insert into storage.buckets (id, name, public)
values ('figure-images', 'figure-images', true)
on conflict (id) do nothing;
