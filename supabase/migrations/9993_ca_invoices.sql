-- CA Invoice mirror. CoachAccountable issues an Invoice per Client (or Company)
-- for a billing period — for HJG, typically one per mentee per month for their
-- subscription tier (4x / 2x / 1x …). Each invoice carries the billed `amount`,
-- the `amount_paid` so far, the invoice `date_of` (the service month it covers),
-- and nested line items + payments. This is the revenue source behind the
-- staff/mentor payment tool (pay a coach a % of a mentee's monthly revenue).
--
-- READ-ONLY mirror: the sync calls Invoice.getAll only — nothing is written back
-- to CoachAccountable. Written only by the sync job (service role); read by all
-- authenticated. Apply via the Supabase SQL Editor; re-runnable.

create table if not exists ca_invoices (
  id              bigint primary key,   -- CA Invoice.ID
  invoice_number  text,
  client_id       bigint,
  company_id      bigint,
  first_name      text,
  last_name       text,
  client_name     text,                 -- convenience: first + last
  email           text,
  company_name    text,
  currency        text,
  amount          numeric,              -- total billed
  amount_paid      numeric,             -- collected so far
  tax_rate        numeric,
  date_added_raw  text,
  date_added      date,
  date_of_raw     text,
  date_of         date,                 -- the invoice's service date (revenue month)
  date_of_year    int,                  -- denormalized for cheap month grouping
  date_of_month   int,                  -- 1-indexed
  date_due_raw    text,
  date_due        date,
  line_items      jsonb,                -- [{ item, amount }]
  payments        jsonb,                -- [{ datePaid, amount, method, checkNumber }]
  synced_at       timestamptz not null default now()
);
create index if not exists idx_ca_invoice_client on ca_invoices (client_id);
create index if not exists idx_ca_invoice_company on ca_invoices (company_id);
create index if not exists idx_ca_invoice_month on ca_invoices (date_of_year, date_of_month);

-- Read-only for authenticated users (same as the other ca_* mirrors). Service
-- role bypasses RLS for the sync upserts. drop-if-exists keeps this re-runnable.
alter table ca_invoices enable row level security;
drop policy if exists ca_invoices_read on ca_invoices;
create policy ca_invoices_read on ca_invoices for select to authenticated using (true);
