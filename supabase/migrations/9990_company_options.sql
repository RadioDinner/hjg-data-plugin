-- Company options: org-wide dashboard settings, editable from the "Company
-- options" tab. Stored in app_settings (jsonb value). Staff can UPDATE app_settings
-- (RLS), but there is no staff INSERT policy, so each option's key must be SEEDED
-- here. Re-runnable: `on conflict do nothing` preserves any value already set.
--
-- Registry of options lives in src/companyOptions.ts — when you add an option
-- there, add its seed row here too (and re-run this in the Supabase SQL Editor).

insert into app_settings (key, value) values
  -- Journeys: how each pipeline stage is dated.
  --   "engagement_start" = CoachAccountable engagement start date (default)
  --   "first_meeting"    = first 1-on-1 mentoring meeting under that engagement
  ('journeys_stage_basis', '"engagement_start"'::jsonb)
on conflict (key) do nothing;
