create table if not exists public.alpha_scout_signal_snapshots (
  id uuid primary key default gen_random_uuid(),
  signal_date date not null,
  created_at timestamptz not null default now(),
  snapshot_created_at timestamptz,
  mode text,
  source_bucket text,
  rank int,
  ticker text not null,
  company_name text,
  pool text,
  price numeric,
  market_cap numeric,
  composite_score numeric,
  capital_flow_score numeric,
  normalized_flow_score numeric,
  margin_score numeric,
  fcf_score numeric,
  signal text,
  data_status text,
  change_label text,
  change_type text,
  rank_change int,
  capital_flow_3d numeric,
  capital_flow_5d numeric,
  capital_flow_9d numeric,
  capital_flow_3w numeric,
  capital_flow_5w numeric,
  capital_flow_change_ratio numeric,
  margin_change numeric,
  fcf numeric,
  fcf_qoq_change numeric,
  cash_flow_change_ratio numeric,
  financial_data_source text,
  financial_updated_at text,
  flow_calculation_version text,
  capital_flow_data_source text,
  capital_flow_quality text,
  provider_used text,
  provider_endpoint_type text,
  archive_status text,
  archive_hit_provider text,
  flow_data_updated_at text,
  flow_data_quality_score numeric,
  flow_data_quality_grade text,
  flow_data_quality_reasons jsonb,
  flow_data_quality_inputs jsonb,
  provider_errors jsonb,
  raw_item jsonb,
  forward_1d_return_pct numeric,
  forward_3d_return_pct numeric,
  forward_5d_return_pct numeric,
  forward_10d_return_pct numeric,
  forward_20d_return_pct numeric,
  forward_returns_updated_at timestamptz
);

create unique index if not exists idx_alpha_scout_signal_snapshots_unique
on public.alpha_scout_signal_snapshots (signal_date, mode, ticker, source_bucket);

create index if not exists idx_alpha_scout_signal_snapshots_signal_date
on public.alpha_scout_signal_snapshots (signal_date desc);

create index if not exists idx_alpha_scout_signal_snapshots_ticker
on public.alpha_scout_signal_snapshots (ticker);

create index if not exists idx_alpha_scout_signal_snapshots_signal
on public.alpha_scout_signal_snapshots (signal);

create index if not exists idx_alpha_scout_signal_snapshots_quality_grade
on public.alpha_scout_signal_snapshots (flow_data_quality_grade);

create index if not exists idx_alpha_scout_signal_snapshots_source_bucket
on public.alpha_scout_signal_snapshots (source_bucket);

create index if not exists idx_alpha_scout_signal_snapshots_mode
on public.alpha_scout_signal_snapshots (mode);
