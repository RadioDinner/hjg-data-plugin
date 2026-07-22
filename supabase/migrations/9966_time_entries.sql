-- Time clock (2026-07-22): staff/mentor clock-in/out entries, tracked in the new
-- Time clock tab and later submitted for payroll (and mined for metrics). One
-- row per work interval; clock_out NULL = currently clocked in. Rows are
-- matched to people by the signed-in auth email (same convention as app_users,
-- 9968). submitted_at locks an entry (it went to payroll). Depends on
-- set_updated_at() from 9999_init. Apply via the Supabase SQL Editor;
-- re-runnable.

create table if not exists time_entries (
  id            uuid primary key default gen_random_uuid(),
  user_email    text not null,
  clock_in      timestamptz not null,
  clock_out     timestamptz,           -- null = still on the clock
  note          text,
  submitted_at  timestamptz,           -- set when submitted for payroll (locks the row)
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (clock_out is null or clock_out >= clock_in)
);
create index if not exists idx_time_entries_email on time_entries (user_email, clock_in desc);
drop trigger if exists trg_time_entries_updated on time_entries;
create trigger trg_time_entries_updated before update on time_entries
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything (totals/metrics), write entries; a
-- person may delete only their own unsubmitted entries.
alter table time_entries enable row level security;
drop policy if exists time_entries_read on time_entries;
create policy time_entries_read on time_entries for select to authenticated using (true);
drop policy if exists time_entries_ins on time_entries;
create policy time_entries_ins  on time_entries for insert to authenticated with check (true);
drop policy if exists time_entries_upd on time_entries;
create policy time_entries_upd  on time_entries for update to authenticated using (true);
drop policy if exists time_entries_del on time_entries;
create policy time_entries_del  on time_entries for delete to authenticated
  using (created_by = auth.uid() and submitted_at is null);
