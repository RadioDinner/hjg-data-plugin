-- Add CoachAccountable's `countsInEngagement` flag (from Appointment.getAll) to
-- the appointment mirror. This is CA's closest signal to "the session actually
-- happened": it records whether an appointment has been credited against its
-- Engagement's allocation — i.e. counted toward the sessions the mentee paid for.
--
--    1 = DOES count (a delivered session)
--   -1 = does NOT count
--    0 = no judgement applied yet
-- null = not yet synced (existing rows until the next sync backfills them)
--
-- Lets us verify delivery — e.g. "a 4x mentee's 4 paid-for sessions were all
-- credited, and all with the same coach" — rather than paying purely on billed/
-- collected revenue. See docs/coachaccountable-api.md (Appointment.getAll).
--
-- Apply via the Supabase SQL Editor, then run a sync so existing rows backfill.

alter table ca_appointments
  add column if not exists counts_in_engagement smallint;

-- Verification queries filter delivered sessions within an engagement, so index
-- on (engagement_id, counts_in_engagement).
create index if not exists idx_ca_appt_counts
  on ca_appointments (engagement_id, counts_in_engagement);
