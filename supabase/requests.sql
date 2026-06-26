-- Portal Tracker — figure requests, community voting, feedback, and admin.
-- Additive migration: safe to run AFTER schema.sql, in the SQL Editor
-- (Dashboard → SQL → New query). Idempotent — re-running is harmless.
--
-- Change ADMIN_EMAIL below if a different account should hold admin rights.

-- ---- admin check -----------------------------------------------------------
-- True when the signed-in account is the site admin. SECURITY DEFINER so it can
-- read the email out of auth.users (the anon/authenticated roles cannot).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select lower(email) from auth.users where id = auth.uid()) = 'ajoines03@gmail.com',
    false
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---- requests + feedback ---------------------------------------------------
-- One table holds both "please add this figure" requests (kind='figure', shown
-- publicly and votable) and private "report a bug / give feedback" messages
-- (kind='feedback', visible only to the sender and the admin).
create table if not exists public.figure_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  kind        text not null default 'figure' check (kind in ('figure', 'feedback')),
  name        text not null check (char_length(name) between 1 and 120),
  section     text not null default '',
  notes       text not null default '' check (char_length(notes) <= 1000),
  status      text not null default 'pending'
              check (status in ('pending', 'planned', 'added', 'rejected', 'duplicate')),
  admin_notes text not null default '',
  vote_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.figure_requests enable row level security;

-- Figure requests are public (so the community can see + dedupe what's wanted);
-- feedback is visible only to its author and the admin.
drop policy if exists "requests readable" on public.figure_requests;
create policy "requests readable" on public.figure_requests
  for select
  using (kind = 'figure' or user_id = auth.uid() or public.is_admin());

-- Any signed-in user may submit, but only as themselves.
drop policy if exists "insert own request" on public.figure_requests;
create policy "insert own request" on public.figure_requests
  for insert
  with check (auth.uid() = user_id);

-- Only the admin triages (status / admin_notes).
drop policy if exists "admin updates request" on public.figure_requests;
create policy "admin updates request" on public.figure_requests
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- The admin can remove anything; a user can withdraw their own pending request.
drop policy if exists "delete own or admin" on public.figure_requests;
create policy "delete own or admin" on public.figure_requests
  for delete
  using (public.is_admin() or (user_id = auth.uid() and status = 'pending'));

create index if not exists figure_requests_kind_votes_idx
  on public.figure_requests (kind, vote_count desc);

-- ---- votes -----------------------------------------------------------------
create table if not exists public.request_votes (
  request_id uuid not null references public.figure_requests (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table public.request_votes enable row level security;

drop policy if exists "votes readable" on public.request_votes;
create policy "votes readable" on public.request_votes for select using (true);

drop policy if exists "insert own vote" on public.request_votes;
create policy "insert own vote" on public.request_votes
  for insert with check (auth.uid() = user_id);

drop policy if exists "delete own vote" on public.request_votes;
create policy "delete own vote" on public.request_votes
  for delete using (auth.uid() = user_id);

-- Keep figure_requests.vote_count in sync so the list sorts without an
-- aggregate query. SECURITY DEFINER so the count updates regardless of who
-- casts the vote (RLS on figure_requests would otherwise block the write).
create or replace function public.sync_vote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.figure_requests set vote_count = vote_count + 1 where id = new.request_id;
  elsif tg_op = 'DELETE' then
    update public.figure_requests set vote_count = greatest(0, vote_count - 1) where id = old.request_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_vote_count on public.request_votes;
create trigger trg_sync_vote_count
  after insert or delete on public.request_votes
  for each row execute function public.sync_vote_count();

-- ---- updated_at touch ------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_requests on public.figure_requests;
create trigger trg_touch_requests
  before update on public.figure_requests
  for each row execute function public.touch_updated_at();

-- ---- admin stats -----------------------------------------------------------
-- Cross-user totals for the admin dashboard. SECURITY DEFINER to see past RLS,
-- but guarded so only the admin can call it.
create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return json_build_object(
    'users',            (select count(*) from auth.users),
    'collectors',       (select count(distinct user_id) from public.owned),
    'owned_rows',       (select count(*) from public.owned),
    'figures_tracked',  (select coalesce(sum(jsonb_array_length(copies)), 0) from public.owned),
    'wishlist_rows',    (select count(*) from public.wishlist),
    'requests_pending', (select count(*) from public.figure_requests where kind = 'figure' and status = 'pending'),
    'requests_total',   (select count(*) from public.figure_requests where kind = 'figure'),
    'feedback_open',    (select count(*) from public.figure_requests where kind = 'feedback' and status = 'pending')
  );
end;
$$;

grant execute on function public.admin_stats() to authenticated;
