-- User permissions "bones" (2026-07-22): per-user tab access, managed on the
-- Admin dashboard (§405). One row per person, matched to the signed-in Supabase
-- auth user by EMAIL (lower-cased unique). `user_id` (hard auth link) and
-- `coach_id` (link a mentor's login to their ca_coaches row) ride along for the
-- future "mentors log in and use the app" phase.
--
-- Resolution (lib/permissions.ts): no row => ALL tabs (today's behavior, so
-- nobody is locked out by applying this); role 'admin' => always all tabs;
-- allowed_tabs NULL => role default (admin/staff all, mentor none yet);
-- explicit list => exactly those tabs; is_active false => no tabs (non-admins).
-- Depends on set_updated_at() from 9999_init. Apply via the Supabase SQL
-- Editor; re-runnable.

create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  display_name  text,
  role          text not null default 'staff' check (role in ('admin','staff','mentor')),
  allowed_tabs  text[],                        -- null = role default; else the exact tab keys
  coach_id      bigint,                        -- soft ref to ca_coaches.id (mentor logins, future)
  user_id       uuid references auth.users (id), -- hard auth link once known (future)
  is_active     boolean not null default true,
  notes         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_app_users_email on app_users (lower(email));
drop trigger if exists trg_app_users_updated on app_users;
create trigger trg_app_users_updated before update on app_users
  for each row execute function set_updated_at();

-- RLS: signed-in staff read/write everything (the app is staff-trusted today;
-- tightening to admin-only management is a follow-up once roles are enforced).
alter table app_users enable row level security;
drop policy if exists app_users_read on app_users;
create policy app_users_read on app_users for select to authenticated using (true);
drop policy if exists app_users_ins on app_users;
create policy app_users_ins  on app_users for insert to authenticated with check (true);
drop policy if exists app_users_upd on app_users;
create policy app_users_upd  on app_users for update to authenticated using (true);
drop policy if exists app_users_del on app_users;
create policy app_users_del  on app_users for delete to authenticated using (true);
