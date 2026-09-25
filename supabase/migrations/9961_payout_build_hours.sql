-- Build payout (§204): HOURLY WORK on a mentor's payout. Hand-entered hours ×
-- rate, paid 100% to the mentor (the Split % never touches it), printed on the
-- same pay stub as the revenue share and piece work. Counted as a cost on the
-- Margins tab (§608) together with piece work.
--
--   hour_items      — the lines: [{date|null, label, hours, rate|null}]. Same
--                     shape as staff_pay_builds.entries (Hourly staff), so a
--                     future Time-clock import can fill either. rate null = the
--                     build's default hourly_rate.
--   hourly_rate     — the default $/h used this month (the builder pre-fills it
--                     from the mentor's most recent build that has one).
--   hours_pay_total — cached Σ hours × rate. Included in built_total, never in
--                     computed_total (the engine knows nothing about hourly work).
--
-- HJG-owned, read-only toward CoachAccountable. Re-runnable; apply via the
-- Supabase SQL Editor. Depends on 9989_payout_builds.sql.

alter table payout_builds
  add column if not exists hour_items      jsonb   not null default '[]'::jsonb,
  add column if not exists hourly_rate     numeric check (hourly_rate is null or hourly_rate >= 0),
  add column if not exists hours_pay_total numeric not null default 0;

comment on column payout_builds.hour_items is
  'Hourly-work lines: [{date|null, label, hours, rate|null}] — paid 100% to the mentor on top of the revenue share. rate null = hourly_rate.';
comment on column payout_builds.hourly_rate is
  'Default $/h for this build''s hour_items (a line may carry its own rate).';
comment on column payout_builds.hours_pay_total is
  'Cached Σ hours × rate over hour_items. Included in built_total, never in computed_total. The app recomputes from the jsonb.';
