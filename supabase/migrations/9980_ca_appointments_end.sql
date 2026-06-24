-- Appointment END time on ca_appointments, so the Margins tab can compute REAL
-- delivered meeting hours (duration = end − start) instead of a flat per-session
-- stand-in. CA's Appointment.getAll returns endDate; the sync now mirrors it to
-- end_raw (parallel to start_raw, the exact account-local datetime string).
-- Needs a RE-SYNC to populate; until then end_raw is null and delivered hours fall
-- back to the per-session stand-in. Apply via the Supabase SQL Editor; re-runnable.

alter table ca_appointments add column if not exists end_raw text;  -- CA Appointment.endDate (exact string)
