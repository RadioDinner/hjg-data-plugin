-- Pay staff: PIECE WORK on both pay paths, and PER-LINE hourly rates.
--
-- (1) Piece work — flat per-unit pay ("$25 for every new mentee; he had 8 in
--     June"). Added to BOTH builders because staff get it either way:
--       • staff_pay_builds.piece_items  — hourly staff (Hourly staff, §206)
--       • payout_builds.piece_items     — calculated/mentor staff (Build payout, §204)
--     Shape: [{date|null, label, qty, unitRate}]. The cached *_total columns
--     mirror the jsonb the same way hours_total/built_total already do — the app
--     recomputes from the jsonb, these are for at-a-glance SQL.
--
-- (2) Per-line hourly rate — no schema change needed: staff_pay_builds.entries
--     is jsonb and each entry simply gains an optional `rate` key
--     ([{date|null, label, hours, rate|null}]). `rate: null` (and every row saved
--     before this migration, which has no key at all) means "use the period's
--     default rate", so existing timesheets read back unchanged.
--
-- All HJG-owned, read-only toward CoachAccountable. Re-runnable; apply via the
-- Supabase SQL Editor. Depends on 9970_staff_hourly_pay.sql and
-- 9989_payout_builds.sql.

-- (1a) Hourly staff -----------------------------------------------------------
alter table staff_pay_builds
  add column if not exists piece_items  jsonb   not null default '[]'::jsonb,
  add column if not exists pieces_total numeric not null default 0;

comment on column staff_pay_builds.piece_items is
  'Piece-work lines: [{date|null, label, qty, unitRate}] — flat per-unit pay added on top of the hours.';
comment on column staff_pay_builds.pieces_total is
  'Cached Σ qty × unitRate over piece_items. The app recomputes from the jsonb; this is for SQL readability.';
comment on column staff_pay_builds.entries is
  'Timesheet lines: [{date|null, label, hours, rate|null}]. rate null/absent = the build''s default rate.';

-- (1b) Calculated (mentor) staff ---------------------------------------------
alter table payout_builds
  add column if not exists piece_items  jsonb   not null default '[]'::jsonb,
  add column if not exists pieces_total numeric not null default 0;

comment on column payout_builds.piece_items is
  'Piece-work lines: [{date|null, label, qty, unitRate}] — flat per-unit pay added on top of the engine payout lines.';
comment on column payout_builds.pieces_total is
  'Cached Σ qty × unitRate over piece_items. Included in built_total, never in computed_total (the engine knows nothing about piece work).';
