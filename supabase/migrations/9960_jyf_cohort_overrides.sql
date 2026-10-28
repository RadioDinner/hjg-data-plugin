-- §005 "JYF vs Active Mentoring" cohort settings (2026-10-28).
-- Seeds the `jyf_cohort_overrides` key: which CoachAccountable engagement NAMES
-- count as JumpStart (JYF) / 4x / 2x / 1x / not counted on the Metrics card,
-- overriding the name-based auto detection (lib/config.ts engagementTier). For
-- example an "IMN Subscription" engagement that reads as JYF by its wording can
-- be switched off here. Edited from the ⚙ in the corner of the card itself.
--
-- The value is a JSON STRING {"byName":{"<normalized name>":"jyf|4x|2x|1x|off"}}
-- (stored via to_jsonb(...::text)) so it rides the string-valued Company-options
-- plumbing (setCompanyOption). Staff can UPDATE app_settings (RLS) but cannot
-- INSERT, so the key must be seeded here. Pure logic: lib/cohort.ts
-- (parseJyfCohortOverrides / resolveJyfCohort).
--
-- Apply via the Supabase SQL Editor; re-runnable — on conflict do nothing keeps
-- any value already set. Until it is applied the card works with no overrides
-- and the dialog says saving needs this migration.

insert into app_settings (key, value) values
  ('jyf_cohort_overrides', to_jsonb('{"byName":{}}'::text))
on conflict (key) do nothing;
