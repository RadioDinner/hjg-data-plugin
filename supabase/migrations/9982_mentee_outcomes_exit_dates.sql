-- Per-exit DATE columns on mentee_outcomes (quit / no mentoring / fired).
-- Mirrors what the user applied directly in the Supabase SQL Editor (session 009),
-- captured here so the migrations folder stays the source of truth for the schema.
-- Each records WHEN that specific exit happened; the app writes the one matching the
-- chosen exit status (mirroring status_date). The status NOT-NULL drop is already in
-- 9985 — kept here, idempotent — so this file stands alone re-runnably.
-- Apply via the Supabase SQL Editor; re-runnable.

alter table mentee_outcomes alter column status drop not null;

alter table mentee_outcomes add column if not exists quit_date         date;
alter table mentee_outcomes add column if not exists no_mentoring_date date;
alter table mentee_outcomes add column if not exists fired_date        date;
