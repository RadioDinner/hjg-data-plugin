-- Pay-staff "Build payout" review records: a human review-and-assemble layer on
-- top of the automated payroll engine (lib/pay). For a given coach + service
-- month, staff confirm/drop each computed line (and may override a line's payout
-- with a note), then sign the month off (draft -> approved). The engine stays the
-- source of truth — this table only records the HUMAN decisions + the reviewed
-- total, so there's an auditable record of what was checked before money goes out.
-- Read-only toward CoachAccountable; internal HJG state only.
--
-- One row per (coach_id, service_month) — re-reviewing a month upserts in place;
-- reopening an approved month flips status back to 'draft'. Mirrors the
-- discovery_outcomes / mentee_outcomes / manual_metrics ownership + RLS shape.
-- Apply via the Supabase SQL Editor; re-runnable.
-- Depends on set_updated_at() from 9999_init.

create table if not exists payout_builds (
  id             uuid primary key default gen_random_uuid(),
  coach_id       bigint not null,          -- soft ref to ca_coaches.id
  service_month  text not null,            -- 'YYYY-MM' (the invoice service month)
  status         text not null default 'draft' check (status in ('draft','approved')),
  built_total    numeric not null default 0,  -- signed-off total (included lines, overrides applied)
  computed_total numeric not null default 0,  -- engine total at review time (drift reference)
  line_states    jsonb not null default '{}'::jsonb, -- clientId -> { included, override, note }
  notes          text,                     -- overall review note for the month
  reviewed_by    uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_payout_build_coach_month on payout_builds (coach_id, service_month);
drop trigger if exists trg_payout_builds_updated on payout_builds;
create trigger trg_payout_builds_updated before update on payout_builds
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything and read/write entries (same shape as the
-- other HJG-owned tables). A reviewer may delete only their own records.
-- drop-if-exists keeps this script re-runnable.
alter table payout_builds enable row level security;
drop policy if exists payout_builds_read on payout_builds;
create policy payout_builds_read on payout_builds for select to authenticated using (true);
drop policy if exists payout_builds_ins on payout_builds;
create policy payout_builds_ins  on payout_builds for insert to authenticated with check (true);
drop policy if exists payout_builds_upd on payout_builds;
create policy payout_builds_upd  on payout_builds for update to authenticated using (true);
drop policy if exists payout_builds_del on payout_builds;
create policy payout_builds_del  on payout_builds for delete to authenticated using (reviewed_by = auth.uid());
