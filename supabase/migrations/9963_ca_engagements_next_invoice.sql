-- Next invoice date on ca_engagements, so the Margins tab ("Margins on Mentoring")
-- can count the invoices CoachAccountable will STILL issue for a mentee's open
-- mentoring engagement — the "scheduled for the future" side of the per-mentee
-- invoice picture (issued / paid / scheduled). CA's Engagement.getAll returns
-- nextInvoiceDate; the sync now mirrors it to next_invoice_raw (the exact CA
-- string) + next_invoice_date (account-local calendar date).
--
-- Needs a RE-SYNC to populate; until then both columns are null and the tab
-- reports "scheduled" as unknown. The sync tolerates this migration being
-- unapplied (it retries the engagement upsert without these columns and notes
-- it in the run). Apply via the Supabase SQL Editor; re-runnable.

alter table ca_engagements
  add column if not exists next_invoice_raw  text,   -- CA Engagement.nextInvoiceDate (exact string)
  add column if not exists next_invoice_date date;   -- account-local calendar date
