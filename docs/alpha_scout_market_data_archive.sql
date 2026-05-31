create table if not exists public.alpha_scout_market_data_archive (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  provider text not null,
  data_date date not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_alpha_scout_market_data_archive_unique
on public.alpha_scout_market_data_archive (ticker, provider, data_date);
