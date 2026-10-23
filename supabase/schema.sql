-- Windmill leaderboard: run this once in the Supabase SQL editor.
--
-- Every finished streak is a row. Anyone with the site's public key can add rows
-- and read them; nobody can edit or delete them except you from the dashboard.
-- It's an honor system: names aren't verified and scores aren't checked.

create table if not exists public.streaks (
  id         bigint generated always as identity primary key,
  coach      text        not null check (char_length(coach) between 1 and 20),
  streak     integer     not null check (streak between 1 and 1000),
  clock      integer     not null check (clock in (0, 3, 5, 8, 12)),  -- seconds; 0 = clock off
  device     text        not null check (char_length(device) between 8 and 40),
  created_at timestamptz not null default now()
);

create index if not exists streaks_best on public.streaks (streak desc, created_at);

alter table public.streaks enable row level security;

drop policy if exists "add a streak" on public.streaks;
create policy "add a streak" on public.streaks for insert to anon with check (true);

drop policy if exists "read streaks" on public.streaks;
create policy "read streaks" on public.streaks for select to anon using (true);

grant insert, select on public.streaks to anon;

-- Each coach's best streak. Names are matched without regard to case, so "Jake"
-- and "jake" are the same coach. Ties go to whoever got there first.
create or replace view public.board_all_time with (security_invoker = true) as
select distinct on (lower(coach)) coach, streak, clock, created_at
from public.streaks
order by lower(coach), streak desc, created_at;

create or replace view public.board_week with (security_invoker = true) as
select distinct on (lower(coach)) coach, streak, clock, created_at
from public.streaks
where created_at > now() - interval '7 days'
order by lower(coach), streak desc, created_at;

grant select on public.board_all_time, public.board_week to anon;
