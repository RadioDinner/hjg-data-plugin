-- Build-payout (§204): record that an approved month's payout was actually PAID
-- (the "Payment sent" button) — when it was marked and the Melio payment number
-- entered as the reference. Drives the "paid ✓" month markers, the
-- Print→Reprint pay-stub labeling, the §203 payment-progress strip, and the
-- default-to-last-paid service month. Un-marking a payment nulls both columns.
-- Apply via the Supabase SQL Editor; re-runnable.

alter table payout_builds add column if not exists payment_sent_at timestamptz;
alter table payout_builds add column if not exists payment_ref text;
