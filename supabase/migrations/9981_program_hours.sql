-- Program hours (Margins tab): staff hours entered per program per month, to be
-- compared against delivered meeting hours (computed from CoachAccountable). One
-- row per (program, month). Dollar figures come later — this is the hours "bones".
-- HJG-owned, staff RLS — same shape as manual_metrics. Depends on set_updated_at()
-- from 9999_init. Apply via the Supabase SQL Editor; re-runnable.

create table if not exists program_hours (
  id           uuid primary key default gen_random_uuid(),
  program      text not null,                          -- 'jyf' | 'mentoring' (see lib/margins.ts PROGRAMS)
  month        text not null check (month ~ '^\d{4}-\d{2}$'), -- 'YYYY-MM'
  staff_hours  numeric,                                -- hours staff spent on this program that month
  notes        text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_program_hours on program_hours (program, month);

drop trigger if exists trg_program_hours_updated on program_hours;
create trigger trg_program_hours_updated before update on program_hours
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything, read/write entries, delete their own.
alter table program_hours enable row level security;
drop policy if exists program_hours_read on program_hours;
create policy program_hours_read on program_hours for select to authenticated using (true);
drop policy if exists program_hours_ins on program_hours;
create policy program_hours_ins  on program_hours for insert to authenticated with check (true);
drop policy if exists program_hours_upd on program_hours;
create policy program_hours_upd  on program_hours for update to authenticated using (true);
drop policy if exists program_hours_del on program_hours;
create policy program_hours_del  on program_hours for delete to authenticated using (created_by = auth.uid());
