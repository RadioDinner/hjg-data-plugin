-- Pay staff: HOURLY (timesheet) staff pay + a paystub HISTORY archive.
--
-- (1) staff_pay_profiles — the people paid by the hour (not the CA-invoice
--     engine): name, hourly rate, optional soft link to ca_coaches. Staff-owned.
-- (2) staff_pay_builds — one row per profile + period month: the timesheet
--     entries (jsonb), the rate USED that period (copied from the profile,
--     editable), an adjustment, paystub notes, the logged total, draft/approved.
-- (3) paystubs — the history archive: every printed pay stub (mentor engine
--     stubs AND hourly stubs) saved as the exact self-contained HTML document
--     that was generated, so past statements can be reloaded and reviewed
--     verbatim, not re-derived from data that may have changed since.
--
-- All HJG-owned, read-only toward CoachAccountable. RLS mirrors payout_builds
-- (signed-in staff read/write; delete own). Apply via the Supabase SQL Editor;
-- re-runnable. Depends on set_updated_at() from 9999_init.

create table if not exists staff_pay_profiles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  coach_id     bigint,                    -- soft ref to ca_coaches.id (optional)
  hourly_rate  numeric not null default 0 check (hourly_rate >= 0),
  active       boolean not null default true,
  notes        text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_staff_pay_profile_name on staff_pay_profiles (lower(name));
drop trigger if exists trg_staff_pay_profiles_updated on staff_pay_profiles;
create trigger trg_staff_pay_profiles_updated before update on staff_pay_profiles
  for each row execute function set_updated_at();

create table if not exists staff_pay_builds (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references staff_pay_profiles (id) on delete cascade,
  period_month    text not null,             -- 'YYYY-MM'
  rate            numeric not null default 0 check (rate >= 0),
  entries         jsonb not null default '[]'::jsonb, -- [{date|null, label, hours}]
  hours_total     numeric not null default 0,
  adjustment      numeric not null default 0, -- bonus / correction (+/-)
  adjustment_note text,
  notes           text,                      -- note printed on the pay stub
  total           numeric not null default 0, -- logged payout = hours×rate + adjustment
  status          text not null default 'draft' check (status in ('draft','approved')),
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_staff_pay_build on staff_pay_builds (profile_id, period_month);
drop trigger if exists trg_staff_pay_builds_updated on staff_pay_builds;
create trigger trg_staff_pay_builds_updated before update on staff_pay_builds
  for each row execute function set_updated_at();

create table if not exists paystubs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('mentor','hourly')),
  staff_name   text not null,
  coach_id     bigint,                      -- mentor stubs: ca_coaches.id
  period_month text not null,               -- 'YYYY-MM'
  status       text not null check (status in ('draft','approved')),
  total        numeric not null default 0,
  html         text not null,               -- the exact printable document
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create index if not exists ix_paystubs_period on paystubs (period_month desc, created_at desc);

alter table staff_pay_profiles enable row level security;
alter table staff_pay_builds   enable row level security;
alter table paystubs           enable row level security;

drop policy if exists staff_pay_profiles_read on staff_pay_profiles;
create policy staff_pay_profiles_read on staff_pay_profiles for select to authenticated using (true);
drop policy if exists staff_pay_profiles_ins on staff_pay_profiles;
create policy staff_pay_profiles_ins  on staff_pay_profiles for insert to authenticated with check (true);
drop policy if exists staff_pay_profiles_upd on staff_pay_profiles;
create policy staff_pay_profiles_upd  on staff_pay_profiles for update to authenticated using (true);
drop policy if exists staff_pay_profiles_del on staff_pay_profiles;
create policy staff_pay_profiles_del  on staff_pay_profiles for delete to authenticated using (created_by = auth.uid());

drop policy if exists staff_pay_builds_read on staff_pay_builds;
create policy staff_pay_builds_read on staff_pay_builds for select to authenticated using (true);
drop policy if exists staff_pay_builds_ins on staff_pay_builds;
create policy staff_pay_builds_ins  on staff_pay_builds for insert to authenticated with check (true);
drop policy if exists staff_pay_builds_upd on staff_pay_builds;
create policy staff_pay_builds_upd  on staff_pay_builds for update to authenticated using (true);
drop policy if exists staff_pay_builds_del on staff_pay_builds;
create policy staff_pay_builds_del  on staff_pay_builds for delete to authenticated using (created_by = auth.uid());

drop policy if exists paystubs_read on paystubs;
create policy paystubs_read on paystubs for select to authenticated using (true);
drop policy if exists paystubs_ins on paystubs;
create policy paystubs_ins  on paystubs for insert to authenticated with check (true);
drop policy if exists paystubs_del on paystubs;
create policy paystubs_del  on paystubs for delete to authenticated using (created_by = auth.uid());
