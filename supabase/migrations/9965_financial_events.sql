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
-- Editor; re-runnable. NOTE: the storage bucket/policy block at the END is
-- wrapped so a project where the SQL editor's role doesn't own the storage
-- schema (newer Supabase projects) just prints a NOTICE instead of rolling the
-- whole script back — the tables above still apply. In that case create the
-- private bucket named `receipts` in the dashboard (Storage → New bucket) and
-- add two policies on it there (authenticated SELECT + INSERT).

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

-- Atomic dismiss: append the caller's uid to read_by in ONE update, so two
-- users (or two tabs) dismissing concurrently can't overwrite each other's
-- read marks (the client-side read-modify-write fallback could). Security
-- definer so the append works regardless of future RLS tightening; the WHERE
-- makes it idempotent.
create or replace function mark_notification_read(nid uuid) returns void
language sql security definer set search_path = public as $$
  update app_notifications
     set read_by = array_append(read_by, auth.uid())
   where id = nid
     and auth.uid() is not null
     and not (read_by @> array[auth.uid()]);
$$;
grant execute on function mark_notification_read(uuid) to authenticated;

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
-- Wrapped: on projects where the SQL editor's role doesn't own storage.objects
-- (insufficient_privilege), this prints a NOTICE and moves on instead of
-- aborting the transaction and rolling back the tables above. Fallback in the
-- header comment.
do $$
begin
  insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
  drop policy if exists receipts_read on storage.objects;
  create policy receipts_read on storage.objects for select to authenticated
    using (bucket_id = 'receipts');
  drop policy if exists receipts_ins on storage.objects;
  create policy receipts_ins on storage.objects for insert to authenticated
    with check (bucket_id = 'receipts');
exception when insufficient_privilege then
  raise notice 'receipts bucket/policies skipped (no storage-schema privilege) — create the private bucket "receipts" + authenticated SELECT/INSERT policies in the Supabase dashboard instead.';
end $$;
