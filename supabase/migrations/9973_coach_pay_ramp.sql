-- Per-mentor revenue-share ramp. The pay ramp is normally 35% → 50% → 60% by the
-- mentor's tenure month (see lib/pay.ts PAY_RAMP), but some mentors are fast-tracked
-- to a different ramp. This column stores a mentor's own ramp as a compact percent
-- string ("50/60/60" = 50% first month, 60% second, 60% thereafter). Null = use the
-- default 35/50/60.
--
-- Read by: Pay staff tab (lib/pay.ts rampOverride, via fetchPayData).
-- Editing UI: Admin tab → "Mentor capacity" card → "Pay ramp" column.
--
-- Apply via the Supabase SQL Editor. Re-runnable. Depends on coach_settings (9996).

alter table coach_settings
  add column if not exists pay_ramp text;  -- e.g. '50/60/60' or '35/50/60'; null = default 35/50/60

-- Seed Caleb Otto (ca_coaches.id = 40711): fast-tracked ramp 50/60/60, anchored to
-- his first month of mentoring (March 2026). Decided with the user 2026-07-09. Uses
-- insert-or-update so it's safe to re-run and won't clobber a hand-set capacity/notes.
insert into coach_settings (coach_id, is_mentor, pay_ramp, pay_start_month)
  values (40711, true, '50/60/60', '2026-03')
on conflict (coach_id) do update
  set is_mentor       = true,
      pay_ramp        = excluded.pay_ramp,
      -- keep a hand-set pay_start_month if one already exists
      pay_start_month = coalesce(coach_settings.pay_start_month, excluded.pay_start_month);
