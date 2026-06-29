-- Manual pipeline STAGE-DATE overrides on mentee_outcomes.
-- The Journeys "Edit graduation status" editor can now correct each milestone
-- date (Discovery, JumpStart, 4x, 2x, 1x, Graduation) per mentee, on top of the
-- status override that already lives here. Each is nullable = "use the synced
-- CoachAccountable date". Applied in fetchMenteeJourneys (override ?? synced).
--
-- Because a mentee may now have ONLY date overrides (no status override), the
-- status column is relaxed to nullable (a null status falls back to the inferred
-- active/inactive/graduated). The existing CHECK already permits null.
-- Apply via the Supabase SQL Editor; re-runnable.

alter table mentee_outcomes alter column status drop not null;

alter table mentee_outcomes add column if not exists discovery_date  date;
alter table mentee_outcomes add column if not exists jumpstart_date  date;
alter table mentee_outcomes add column if not exists tier_4x_date    date;
alter table mentee_outcomes add column if not exists tier_2x_date    date;
alter table mentee_outcomes add column if not exists tier_1x_date    date;
alter table mentee_outcomes add column if not exists graduation_date date;
