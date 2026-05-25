-- HJG Data Hub - initial schema
-- Model: CoachAccountable (CA) is synced INTO these "ca_*" mirror tables by a
-- server-side job (service role). HJG-owned tables hold data CA cannot store and
-- are edited by signed-in staff. The dashboard reads from here, never from CA
-- directly.
--
-- Apply via Supabase Studio (SQL Editor) or `supabase db push`.

-- gen_random_uuid() is available in Supabase by default (pgcrypto).

-- ---------------------------------------------------------------------------
-- Shared: keep updated_at fresh on HJG-owned tables.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- CA MIRROR TABLES  (written only by the sync job / service role)
-- ===========================================================================

create table if not exists ca_coaches (
  id          bigint primary key,           -- CA Coach.ID
  name        text,
  first_name  text,
  last_name   text,
  email       text,
  is_active   boolean,
  synced_at   timestamptz not null default now()
);

create table if not exists ca_clients (
  id          bigint primary key,           -- CA Client.ID
  name        text,
  first_name  text,
  last_name   text,
  email       text,
  is_active   boolean,
  is_excluded boolean not null default false, -- placeholder/group "clients" (see lib/config.ts)
  synced_at   timestamptz not null default now()
);

create table if not exists ca_appointments (
  id            bigint primary key,         -- CA Appointment.ID
  coach_id      bigint,
  client_id     bigint,
  engagement_id bigint,
  name          text not null,
  category      text not null,              -- categorized at sync time: mentoring/discoveryPhone/discoveryZoom/excluded/other
  status        text not null,              -- A/C/P/D
  start_raw     text,                       -- exact CA string, kept for audit
  start_date    date,                       -- account-local calendar date (timezone-safe bucketing)
  start_year    int,
  start_month   int,                        -- 1..12
  synced_at     timestamptz not null default now()
);
create index if not exists idx_ca_appt_client on ca_appointments (client_id);
create index if not exists idx_ca_appt_period on ca_appointments (start_year, start_month);
create index if not exists idx_ca_appt_category on ca_appointments (category);

create table if not exists ca_offerings (
  id         bigint primary key,            -- CA Offering.ID
  name       text not null,
  synced_at  timestamptz not null default now()
);

create table if not exists ca_offering_submissions (
  id                bigint primary key,     -- CA submission ID
  offering_id       bigint,
  client_id         bigint,
  client_invoice_id bigint,
  offering_name     text,
  client_name       text,
  client_email      text,
  amount_paid       numeric(12,2) not null default 0,
  tracking_data     text,
  date_added_raw    text,
  date_added        date,                   -- account-local calendar date
  date_year         int,
  date_month        int,
  synced_at         timestamptz not null default now()
);
create index if not exists idx_ca_sub_period on ca_offering_submissions (date_year, date_month);

-- ===========================================================================
-- HJG-OWNED TABLES  (edited by signed-in staff)
-- ===========================================================================

-- Graduations: fills the funnel stage CA has no field for.
create table if not exists graduations (
  id            uuid primary key default gen_random_uuid(),
  client_id     bigint not null,            -- soft ref to ca_clients.id
  graduated_on  date not null,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_graduation_client on graduations (client_id);
create trigger trg_graduations_updated before update on graduations
  for each row execute function set_updated_at();

-- Discovery outcomes: the result of a discovery call. Links to the CA
-- appointment when it came from one; appointment_id null = manually logged.
create table if not exists discovery_outcomes (
  id             uuid primary key default gen_random_uuid(),
  client_id      bigint not null,
  appointment_id bigint,                    -- soft ref to ca_appointments.id
  outcome        text not null check (outcome in ('converted','not_converted','pending','no_show')),
  follow_up_on   date,
  notes          text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_discovery_appt on discovery_outcomes (appointment_id)
  where appointment_id is not null;
create index if not exists idx_discovery_client on discovery_outcomes (client_id);
create trigger trg_discovery_updated before update on discovery_outcomes
  for each row execute function set_updated_at();

-- Cadence/status tier as an append-only history log. "Current" tier = the row
-- with the latest effective_from per client (see view below). Gives you the
-- 4x -> 2x -> 1x -> graduated timeline for trends.
create table if not exists cadence_status_log (
  id             uuid primary key default gen_random_uuid(),
  client_id      bigint not null,
  tier           text not null check (tier in ('4x','2x','1x','graduated')),
  effective_from date not null default current_date,
  notes          text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_cadence_client on cadence_status_log (client_id, effective_from desc);

create or replace view v_current_cadence as
select distinct on (client_id)
  client_id, tier, effective_from, notes
from cadence_status_log
order by client_id, effective_from desc, created_at desc;

-- ===========================================================================
-- OPERATIONS: sync audit log + app settings
-- ===========================================================================

create table if not exists sync_runs (
  id              uuid primary key default gen_random_uuid(),
  trigger         text not null check (trigger in ('manual','scheduled')),
  status          text not null check (status in ('running','success','error')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  calls_made      int not null default 0,
  records_synced  int not null default 0,
  error           text
);
create index if not exists idx_sync_runs_started on sync_runs (started_at desc);

-- Key/value app settings, e.g. {"key":"sync_interval_hours","value":null}.
-- null interval = manual only; the cron stays dormant until a number is set.
create table if not exists app_settings (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz not null default now()
);
insert into app_settings (key, value) values
  ('sync_interval_hours', 'null'::jsonb),
  ('ca_plan_daily_limit', '600'::jsonb),
  ('daily_cap_pct', '5'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- ROW-LEVEL SECURITY
--   * service role (sync job) bypasses RLS automatically.
--   * signed-in staff: read everything; write only the HJG-owned tables.
-- ===========================================================================
alter table ca_coaches              enable row level security;
alter table ca_clients              enable row level security;
alter table ca_appointments         enable row level security;
alter table ca_offerings            enable row level security;
alter table ca_offering_submissions enable row level security;
alter table graduations             enable row level security;
alter table discovery_outcomes      enable row level security;
alter table cadence_status_log      enable row level security;
alter table sync_runs               enable row level security;
alter table app_settings            enable row level security;

-- Read-only for authenticated users on CA mirrors + sync log.
do $$
declare t text;
begin
  foreach t in array array[
    'ca_coaches','ca_clients','ca_appointments','ca_offerings',
    'ca_offering_submissions','sync_runs'
  ] loop
    execute format(
      'create policy %I on %I for select to authenticated using (true);',
      t || '_read', t
    );
  end loop;
end $$;

-- Full read/write for authenticated staff on HJG-owned tables.
do $$
declare t text;
begin
  foreach t in array array['graduations','discovery_outcomes','cadence_status_log'] loop
    execute format('create policy %I on %I for select to authenticated using (true);', t || '_read', t);
    execute format('create policy %I on %I for insert to authenticated with check (true);', t || '_ins', t);
    execute format('create policy %I on %I for update to authenticated using (true);', t || '_upd', t);
    execute format('create policy %I on %I for delete to authenticated using (created_by = auth.uid());', t || '_del', t);
  end loop;
end $$;

-- Settings: staff can read and adjust (e.g. turn on scheduled sync).
create policy app_settings_read on app_settings for select to authenticated using (true);
create policy app_settings_upd  on app_settings for update to authenticated using (true);
