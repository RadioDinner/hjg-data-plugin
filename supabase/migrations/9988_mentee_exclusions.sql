-- Staff-managed mentee exclusions: hide a test/placeholder mentee (e.g. Arthur
-- Nisly) from the dashboard. A reversible, persisted UI sibling of the
-- compile-time `ca_clients.is_excluded` flag + `EXCLUDE_CLIENT_NAMES` list — but
-- staff-owned, so excluding/including is a click, not a code change or a re-sync
-- risk (the sync owns `is_excluded` and could flip it back).
--
-- Dashboard-wide: an excluded client is dropped from Metrics range appointments
-- and from the Journeys pipeline-timing aggregates (the mentee still appears in
-- the Journeys list, greyed, with an "Include" toggle so it's reversible).
--
-- One row per mentee (client_id). Mirrors the mentee_outcomes ownership + RLS
-- shape. Apply via the Supabase SQL Editor; re-runnable.
-- Depends on set_updated_at() from 9999_init.

create table if not exists mentee_exclusions (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null,            -- soft ref to ca_clients.id
  reason      text,                       -- why this mentee is excluded (optional)
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_mentee_exclusion_client on mentee_exclusions (client_id);
drop trigger if exists trg_mentee_exclusions_updated on mentee_exclusions;
create trigger trg_mentee_exclusions_updated before update on mentee_exclusions
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything and read/write entries (same shape as the
-- other HJG-owned tables). A reviewer may delete only their own rows.
-- drop-if-exists keeps this script re-runnable.
alter table mentee_exclusions enable row level security;
drop policy if exists mentee_exclusions_read on mentee_exclusions;
create policy mentee_exclusions_read on mentee_exclusions for select to authenticated using (true);
drop policy if exists mentee_exclusions_ins on mentee_exclusions;
create policy mentee_exclusions_ins  on mentee_exclusions for insert to authenticated with check (true);
drop policy if exists mentee_exclusions_upd on mentee_exclusions;
create policy mentee_exclusions_upd  on mentee_exclusions for update to authenticated using (true);
drop policy if exists mentee_exclusions_del on mentee_exclusions;
create policy mentee_exclusions_del  on mentee_exclusions for delete to authenticated using (created_by = auth.uid());
