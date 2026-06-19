-- Anchor the staff-payment ramp (35% → 50% → 60%) to each MENTOR's actual first
-- month of work. The ramp is built on the MENTOR's tenure (not each mentee's
-- timeline): a mentor's 1st month of work pays 35% of revenue across ALL their
-- assigned mentees, 2nd month 50%, 3rd month onward 60%.
--
-- By default the engine infers a mentor's start from their earliest synced
-- engagement, which is wrong for a veteran whose history predates the sync window
-- (they'd look "new" and be underpaid). This column lets staff pin the true start
-- month. Format 'YYYY-MM'; null = fall back to the derived earliest engagement.
--
-- Editing UI: Admin tab → "Mentor capacity" card → "Pay start" column.
-- Read by: Pay staff tab (lib/pay.ts startMonthOverride).
--
-- Apply via the Supabase SQL Editor. Re-runnable.

alter table coach_settings
  add column if not exists pay_start_month text;  -- 'YYYY-MM' or null
