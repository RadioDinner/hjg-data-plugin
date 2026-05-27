-- Manually-entered board metrics that have no CoachAccountable source. Staff key
-- in one count per metric per month on the Admin tab; the Metrics dashboard sums
-- them over its date range. First users: "Identify Your Triggers" PDF downloads
-- (from the website) and SAST worksheets completed.
--
-- Generic on purpose: a new manual metric needs only a frontend key
-- (src/db.ts MANUAL_METRICS), not another migration. When automatic tracking
-- arrives (e.g. the Squarespace download button), it can upsert into this same
-- table keyed by (metric, period_month).
--
-- Apply via the Supabase SQL Editor. Depends on set_updated_at() from 9999_init.

create table if not exists manual_metrics (
  id           uuid primary key default gen_random_uuid(),
  metric       text not null,             -- frontend metric key (see src/db.ts)
  period_month date not null,             -- first day of the month it counts toward
  value        integer not null default 0 check (value >= 0),
  notes        text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint manual_metrics_month_is_first check (extract(day from period_month) = 1)
);
create unique index if not exists uq_manual_metric_period on manual_metrics (metric, period_month);
create index if not exists idx_manual_metric_period on manual_metrics (period_month);
create trigger trg_manual_metrics_updated before update on manual_metrics
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything and read/write their own entries (same
-- shape as the other HJG-owned tables).
alter table manual_metrics enable row level security;
create policy manual_metrics_read on manual_metrics for select to authenticated using (true);
create policy manual_metrics_ins  on manual_metrics for insert to authenticated with check (true);
create policy manual_metrics_upd  on manual_metrics for update to authenticated using (true);
create policy manual_metrics_del  on manual_metrics for delete to authenticated using (created_by = auth.uid());
