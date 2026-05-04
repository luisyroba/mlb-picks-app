alter table if exists public.picks
  add column if not exists closing_odds numeric,
  add column if not exists closing_line numeric,
  add column if not exists closing_market text,
  add column if not exists closing_selection text,
  add column if not exists closing_source text,
  add column if not exists closing_snapshot_id uuid,
  add column if not exists closing_captured_at timestamptz,
  add column if not exists clv_decimal numeric,
  add column if not exists clv_percent numeric,
  add column if not exists clv_status text,
  add column if not exists clv_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'picks_clv_status_check'
      and conrelid = 'public.picks'::regclass
  ) then
    alter table public.picks
      add constraint picks_clv_status_check
      check (
        clv_status is null
        or clv_status in ('positive', 'negative', 'neutral', 'unavailable')
      );
  end if;
end $$;
