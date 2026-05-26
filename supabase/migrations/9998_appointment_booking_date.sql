-- Add CoachAccountable's appointment booking date (the API's `dateAdded`) to the
-- mirror. This lets the dashboard count discovery calls by SIGNUP date (when the
-- prospect booked) rather than the scheduled call date — the board-relevant
-- top-of-funnel metric. Mentee-meeting metrics keep using the scheduled date.
--
-- Apply via the Supabase SQL Editor, then run a sync so existing rows backfill.

alter table ca_appointments
  add column if not exists date_added_raw   text,
  add column if not exists date_added       date,   -- account-local calendar date
  add column if not exists date_added_year  int,
  add column if not exists date_added_month int;     -- 1..12

create index if not exists idx_ca_appt_added on ca_appointments (date_added_year, date_added_month);
