-- Pay stubs by EMAIL (2026-09-25, session 021) + the hourly "Payment sent" step.
--
-- (1) coach_settings.pay_email — optional override of where a mentor's pay stubs
--     are emailed. Blank = their CoachAccountable email (ca_coaches.email, which
--     the sync mirrors from Coach.getAll). Edited in Admin -> Mentor capacity.
-- (2) staff_pay_profiles.email — where an hourly staff member's stubs go. Blank =
--     the linked coach's email (coach_id), if any. Edited on Hourly staff.
-- (3) staff_pay_builds.payment_sent_at / payment_ref — the hourly "Payment sent"
--     mark + Melio reference, mirroring 9969 for mentor builds.
-- (4) paystubs.profile_id — links an hourly stub to its staff profile (mentor
--     stubs already carry coach_id); paystubs.pdf_base64 — the exact PDF that was
--     emailed; has_pdf — a generated flag so History can list stubs without
--     downloading every PDF.
-- (5) paystub_emails — the send log (who, to which address, when, delivered to
--     the email service or failed). Written ONLY by the server endpoint
--     /api/send-paystub with the service role: there is deliberately no insert /
--     update / delete policy for signed-in users, so the log can't be forged or
--     erased from the browser. Signed-in staff can read it.
--
-- All HJG-owned, read-only toward CoachAccountable. Apply via the Supabase SQL
-- Editor; re-runnable. Depends on 9996 (coach_settings), 9970 (staff pay +
-- paystubs).

alter table coach_settings     add column if not exists pay_email text;
alter table staff_pay_profiles add column if not exists email text;

alter table staff_pay_builds add column if not exists payment_sent_at timestamptz;
alter table staff_pay_builds add column if not exists payment_ref text;

alter table paystubs add column if not exists profile_id uuid
  references staff_pay_profiles (id) on delete set null;
alter table paystubs add column if not exists pdf_base64 text;
alter table paystubs add column if not exists has_pdf boolean
  generated always as (pdf_base64 is not null) stored;

create table if not exists paystub_emails (
  id            uuid primary key default gen_random_uuid(),
  paystub_id    uuid references paystubs (id) on delete set null,
  kind          text not null check (kind in ('mentor','hourly')),
  coach_id      bigint,                     -- mentor stubs: ca_coaches.id
  profile_id    uuid,                       -- hourly stubs: staff_pay_profiles.id
  staff_name    text not null,
  period_month  text not null,              -- 'YYYY-MM'
  to_email      text not null,
  status        text not null check (status in ('sent','failed')),
  provider_id   text,                       -- the email service's message id
  error         text,
  sent_by       uuid references auth.users (id),
  sent_by_email text,
  created_at    timestamptz not null default now()
);
create index if not exists ix_paystub_emails_created on paystub_emails (created_at desc);
create index if not exists ix_paystub_emails_paystub on paystub_emails (paystub_id);

alter table paystub_emails enable row level security;
drop policy if exists paystub_emails_read on paystub_emails;
create policy paystub_emails_read on paystub_emails for select to authenticated using (true);
-- No insert/update/delete policies on purpose: only the service role writes.
