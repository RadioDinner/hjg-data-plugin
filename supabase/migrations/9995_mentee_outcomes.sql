-- Per-mentee pipeline outcome: where a mentee ended up in the HJG journey.
-- Powers the Journeys tab. Status is INFERRED from meeting activity (active vs
-- gone-dormant), but staff can override here with the real outcome — and because
-- a mentee can quit or be fired at ANY stage (not just after graduating), the
-- override carries its own date independent of pipeline stage.
--
-- One row per mentee (client_id). Mirrors the discovery_outcomes / manual_metrics
-- ownership + RLS shape. Apply via the Supabase SQL Editor; re-runnable.
-- Depends on set_updated_at() from 9999_init.

create table if not exists mentee_outcomes (
  id           uuid primary key default gen_random_uuid(),
  client_id    bigint not null,            -- soft ref to ca_clients.id
  status       text not null check (status in ('active','graduated','quit','fired')),
  status_date  date,                       -- when the exit happened (null while active)
  notes        text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_mentee_outcome_client on mentee_outcomes (client_id);
drop trigger if exists trg_mentee_outcomes_updated on mentee_outcomes;
create trigger trg_mentee_outcomes_updated before update on mentee_outcomes
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything and read/write entries (same shape as the
-- other HJG-owned tables). drop-if-exists keeps this script re-runnable.
alter table mentee_outcomes enable row level security;
drop policy if exists mentee_outcomes_read on mentee_outcomes;
create policy mentee_outcomes_read on mentee_outcomes for select to authenticated using (true);
drop policy if exists mentee_outcomes_ins on mentee_outcomes;
create policy mentee_outcomes_ins  on mentee_outcomes for insert to authenticated with check (true);
drop policy if exists mentee_outcomes_upd on mentee_outcomes;
create policy mentee_outcomes_upd  on mentee_outcomes for update to authenticated using (true);
drop policy if exists mentee_outcomes_del on mentee_outcomes;
create policy mentee_outcomes_del  on mentee_outcomes for delete to authenticated using (created_by = auth.uid());
