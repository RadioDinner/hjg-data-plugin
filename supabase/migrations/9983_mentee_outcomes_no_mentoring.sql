-- Add 'no_mentoring' as a journey EXIT status alongside quit/fired.
-- The Journeys path can now end in an "alternative" exit at any stage — Quit,
-- Fired, or No mentoring — instead of Graduation (decided with the user, session
-- 009). 'no_mentoring' = a mentee who left the pipeline without ongoing mentoring.
--
-- mentee_outcomes.status had a CHECK pinned to ('active','graduated','quit','fired')
-- (9995) and was relaxed to nullable (9985). We widen the CHECK to allow the new
-- value. Drop-then-add keeps this re-runnable. Apply via the Supabase SQL Editor.

alter table mentee_outcomes drop constraint if exists mentee_outcomes_status_check;
alter table mentee_outcomes
  add constraint mentee_outcomes_status_check
  check (status in ('active','graduated','quit','fired','no_mentoring'));
