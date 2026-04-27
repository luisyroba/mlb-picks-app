alter table if exists public.picks
  add column if not exists p_raw double precision,
  add column if not exists p_calibrated double precision,
  add column if not exists edge_raw double precision,
  add column if not exists edge_calibrated double precision,
  add column if not exists ev_raw double precision,
  add column if not exists ev_calibrated double precision;
