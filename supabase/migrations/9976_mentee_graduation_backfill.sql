-- Backfill graduation dates for graduated mentees (2026-06-24).
-- For mentees whose Notion status is 'Done (Graduated)' AND who had at least one
-- 1x mentoring meeting, set graduation date = 7 days after their LAST 1x meeting.
-- Graduates who never reached 1x (graduated from 2x/4x) are intentionally left
-- UNSET (the user's choice — strict "last 1x meeting" rule).
--
-- Written to BOTH places (user's choice):
--   - mentees.graduation_date          (new column on the source-of-truth roster)
--   - mentee_outcomes.graduation_date  (the stage-date override that drives the
--                                        Journeys graduation timeline + metrics)
--
-- "1x" engagement = name matching the 1x tier (mirrors engagementTier in
-- lib/config.ts); a "1x meeting" = a mentoring appointment linked to that
-- engagement (ca_appointments.engagement_id). Apply via the Supabase SQL Editor;
-- re-runnable / idempotent.
--
-- Expected result on the 2026-06-24 data — 12 mentees:
--    232530  Anthony Martin        last 1x 2024-12-13 -> 2024-12-20
--    213530  Daniel Strite         last 1x 2025-05-19 -> 2025-05-26
--    237864  Derek Martin          last 1x 2025-11-07 -> 2025-11-14
--    244574  Dwayne Stoltzfus      last 1x 2025-09-11 -> 2025-09-18
--    172846  Jonathan Strubhar     last 1x 2024-10-02 -> 2024-10-09
--    251752  Kevin Knepp           last 1x 2026-03-13 -> 2026-03-20
--    261565  Landin Troyer         last 1x 2025-11-21 -> 2025-11-28
--    202343  Samuel Troyer         last 1x 2024-05-17 -> 2024-05-24
--    238327  Tim Hochstetler       last 1x 2025-06-11 -> 2025-06-18
--    218752  Trenton Hochstetler   last 1x 2025-08-12 -> 2025-08-19
--    228805  Wilbur Miller         last 1x 2025-03-10 -> 2025-03-17
--    221821  William Hoover        last 1x 2024-11-22 -> 2024-11-29

-- 1) mentees gets a graduation_date column (idempotent).
alter table mentees add column if not exists graduation_date date;

-- 2a) Write last-1x + 7 days onto the mentees roster.
with onex as (
  select e.client_id, max(a.start_date) as last_1x
  from ca_engagements e
  join ca_appointments a on a.engagement_id = e.id and a.category = 'mentoring'
  where lower(e.name) like '%(1x%'
     or lower(e.name) like '%one appointment%'
     or lower(e.name) like '%1x month%'
     or lower(e.name) like '%1 hour per month%'
  group by e.client_id
)
update mentees m
   set graduation_date = (o.last_1x + 7)
  from onex o
 where o.client_id = m.client_id
   and o.last_1x is not null
   and m.status = 'Done (Graduated)';

-- 2b) Mirror the same date into mentee_outcomes (the override that drives the
-- Journeys timeline). Insert a row if none exists (status left null = inferred),
-- otherwise just set graduation_date.
insert into mentee_outcomes (client_id, graduation_date)
select m.client_id, (o.last_1x + 7)
from mentees m
join (
  select e.client_id, max(a.start_date) as last_1x
  from ca_engagements e
  join ca_appointments a on a.engagement_id = e.id and a.category = 'mentoring'
  where lower(e.name) like '%(1x%'
     or lower(e.name) like '%one appointment%'
     or lower(e.name) like '%1x month%'
     or lower(e.name) like '%1 hour per month%'
  group by e.client_id
) o on o.client_id = m.client_id
where m.status = 'Done (Graduated)'
  and m.client_id is not null
  and o.last_1x is not null
on conflict (client_id) do update
  set graduation_date = excluded.graduation_date,
      updated_at = now();
