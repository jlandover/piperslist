-- ============================================================
-- PipersList: Flip Season game leaderboard + play counter
-- Run this once in the Supabase SQL Editor (Project: brezapyroueqvznuiatb).
-- Mirrors the public-insert / RLS pattern used elsewhere.
--
-- After this runs, play.html will start saving scores and counting
-- plays automatically. No app code changes needed beyond uploading
-- play.html itself.
-- ============================================================

-- ---- Scores ----------------------------------------------------------
create table if not exists public.piperslist_scores (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) <= 20),
  score       integer not null,
  hustler     text,                  -- 'The Thrifter' | 'The Sneakerhead' | etc.
  created_at  timestamptz not null default now()
);

create index if not exists piperslist_scores_top_idx
  on public.piperslist_scores (score desc);

alter table public.piperslist_scores enable row level security;

drop policy if exists "Anyone can read scores"   on public.piperslist_scores;
drop policy if exists "Anyone can insert scores" on public.piperslist_scores;
drop policy if exists "Authenticated can delete scores" on public.piperslist_scores;

create policy "Anyone can read scores"
  on public.piperslist_scores for select
  using (true);

create policy "Anyone can insert scores"
  on public.piperslist_scores for insert
  with check (true);

-- Admin can clean up bad/abusive scores from admin.html
create policy "Authenticated can delete scores"
  on public.piperslist_scores for delete
  using (auth.role() = 'authenticated');

-- ---- Play counter ----------------------------------------------------
-- Single-row table holding the global "games started" counter.
create table if not exists public.piperslist_stats (
  id     text primary key,
  plays  bigint not null default 0
);

insert into public.piperslist_stats (id, plays) values ('global', 0)
  on conflict (id) do nothing;

alter table public.piperslist_stats enable row level security;

drop policy if exists "Anyone can read stats" on public.piperslist_stats;
create policy "Anyone can read stats"
  on public.piperslist_stats for select
  using (true);

-- NOTE: no public update/insert policy — the counter is bumped only via
-- the increment_plays() function below, which runs as the table owner.
-- That stops a curious player from setting plays to 999999 in DevTools.

create or replace function public.increment_plays()
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.piperslist_stats
     set plays = plays + 1
   where id = 'global'
  returning plays;
$$;

grant execute on function public.increment_plays() to anon;
