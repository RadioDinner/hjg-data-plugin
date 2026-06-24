-- Drop 9 mentee fields from the source-of-truth `mentees` table (2026-06-24).
-- The user asked for these removed from the Mentee-record data and screens; some
-- may be re-added later. This permanently drops the columns (and their data) from
-- existing databases. The 9986 seed + schema were also updated to omit them, so a
-- fresh apply never creates these columns and this drop is a harmless no-op there.
--
-- Notion labels → columns:
--   FF amount              → ff_amount
--   Freedom Fight paid?    → freedom_fight_paid
--   Wants PP?              → wants_pp
--   Date FF paid           → date_ff_paid
--   Current invoice amount → current_invoice_amount
--   JS lesson              → js_lesson
--   MN equivalency         → mn_equivalency
--   dd w a                 → dd_w_a
--   Prayer partner         → mt_prayer_partner
--
-- Apply via the Supabase SQL Editor. Re-runnable (drop column if exists).

alter table mentees drop column if exists ff_amount;
alter table mentees drop column if exists freedom_fight_paid;
alter table mentees drop column if exists wants_pp;
alter table mentees drop column if exists date_ff_paid;
alter table mentees drop column if exists current_invoice_amount;
alter table mentees drop column if exists js_lesson;
alter table mentees drop column if exists mn_equivalency;
alter table mentees drop column if exists dd_w_a;
alter table mentees drop column if exists mt_prayer_partner;
