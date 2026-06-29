-- Company option: Journeys per-stage colors (Discovery → JumpStart → 4x → 2x →
-- 1x → Graduation). Org-wide, editable from the "Company options" tab.
--
-- Stored in app_settings as a JSON *string* (a serialized config object), so it
-- rides the existing string-valued Company-options plumbing (fetchCompanyOptions
-- only surfaces string values). to_jsonb('...'::text) yields a jsonb string.
--
-- Staff can UPDATE app_settings (RLS) but there is no staff INSERT policy, so the
-- key must be seeded here. Re-runnable: `on conflict do nothing` preserves any
-- value already set. Registry entry lives in src/companyOptions.ts; pure color
-- logic + the default in lib/stageColors.ts.
--
-- Default = "custom" mode with a curated red → green palette (red, orange,
-- yellow, lime, green, dark-green). Gradient mode (blend two endpoints) is
-- available in the editor.

insert into app_settings (key, value) values
  (
    'journeys_stage_colors',
    to_jsonb('{"mode":"custom","from":"#e11d48","to":"#15803d","colors":["#e11d48","#f97316","#eab308","#84cc16","#22c55e","#15803d"]}'::text)
  )
on conflict (key) do nothing;
