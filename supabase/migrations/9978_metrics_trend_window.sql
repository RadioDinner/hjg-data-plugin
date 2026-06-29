-- Company option: conversion-rate trend window (2026-06-24).
-- Seeds the `metrics_conversion_trend_window` key for the Company options tab.
-- Staff can UPDATE app_settings (RLS) but cannot INSERT, so the key must be seeded
-- here. The value is a JSON STRING {"n":N,"unit":"weeks|months"} (stored via
-- to_jsonb(...::text)) so it rides the string-valued Company-options plumbing
-- (fetchCompanyOptions only surfaces string values). See src/companyOptions.ts +
-- lib/conversionTrend.ts. Re-runnable: on conflict do nothing preserves any value
-- already set.

insert into app_settings (key, value) values
  ('metrics_conversion_trend_window', to_jsonb('{"n":3,"unit":"months"}'::text))
on conflict (key) do nothing;
