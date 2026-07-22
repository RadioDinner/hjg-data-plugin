-- Report financial event + dashboard notifications (2026-07-22).
--
-- (1) financial_events — staff-reported transactions: when it happened, the
--     vendor, what it was, the payment method, and an optional uploaded
--     receipt (stored in the private `receipts` storage bucket; the row keeps
--     the storage path).
-- (2) app_notifications — the in-app notification feed behind the topbar bell
--     (§907): submitting a financial event inserts one so org support staff
--     see it. read_by collects the auth uids who dismissed it.
-- (3) `receipts` storage bucket + policies (authenticated read/upload).
--
-- Depends on set_updated_at() from 9999_init. Apply via the Supabase SQL
-- Editor; re-runnable. NOTE: the storage bucket/policy statements need the SQL
-- Editor's postgres role (they touch the storage schema); if your project
-- restricts that, create the private bucket named `receipts` in the dashboard
-- (Storage → New bucket) instead and skip those statements.

create table if not exists financial_events (
  id               uuid primary key default gen_random_uuid(),
  happened_on      date not null,          -- when the transaction happened
  vendor           text not null,
  description      text,                   -- what it was
  payment_method   text,                   -- card / check / cash / ach / melio / other…
  receipt_path     text,                   -- storage path in the receipts bucket (null = none)
  created_by       uuid references auth.users (id),
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_financial_events_updated on financial_events;
create trigger trg_financial_events_updated before update on financial_events
  for each row execute function set_updated_at();

alter table financial_events enable row level security;
drop policy if exists financial_events_read on financial_events;
create policy financial_events_read on financial_events for select to authenticated using (true);
drop policy if exists financial_events_ins on financial_events;
create policy financial_events_ins  on financial_events for insert to authenticated with check (true);
drop policy if exists financial_events_upd on financial_events;
create policy financial_events_upd  on financial_events for update to authenticated using (true);
drop policy if exists financial_events_del on financial_events;
create policy financial_events_del  on financial_events for delete to authenticated
  using (created_by = auth.uid());

create table if not exists app_notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'info',   -- 'financial_event' | 'info' | …
  title       text not null,
  body        text,
  link_tab    text,                            -- app tab key to jump to (optional)
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  read_by     uuid[] not null default '{}'     -- auth uids who dismissed it
);
create index if not exists idx_app_notifications_created on app_notifications (created_at desc);

alter table app_notifications enable row level security;
drop policy if exists app_notifications_read on app_notifications;
create policy app_notifications_read on app_notifications for select to authenticated using (true);
drop policy if exists app_notifications_ins on app_notifications;
create policy app_notifications_ins  on app_notifications for insert to authenticated with check (true);
drop policy if exists app_notifications_upd on app_notifications;
create policy app_notifications_upd  on app_notifications for update to authenticated using (true);
drop policy if exists app_notifications_del on app_notifications;
create policy app_notifications_del  on app_notifications for delete to authenticated
  using (created_by = auth.uid());

-- Private receipts bucket + storage policies (authenticated read/upload).
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;
drop policy if exists receipts_read on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts');
drop policy if exists receipts_ins on storage.objects;
create policy receipts_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts');
