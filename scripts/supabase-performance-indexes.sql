-- Run these in Supabase SQL editor during a low-traffic window.
-- They target the access patterns used by slate, picks, stats, auditing, and market snapshots.

create index if not exists idx_market_snapshots_game_created_at
  on public.market_snapshots (game_id, created_at desc);

create index if not exists idx_market_snapshots_event_created_at
  on public.market_snapshots (event_id, created_at desc)
  where event_id is not null;

create index if not exists idx_picks_sport_updated_at
  on public.picks (sport, updated_at desc);

create index if not exists idx_picks_pending_updated_at
  on public.picks (updated_at desc)
  where sport = 'MLB' and status = 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'game_snapshots'
      and indexdef ilike '%(game_id, snapshot_stage)%'
  ) then
    execute 'create unique index idx_game_snapshots_game_stage on public.game_snapshots (game_id, snapshot_stage)';
  end if;
end $$;
