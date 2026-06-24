-- ============================================================================
-- 9975 — MENTEE MANAGEMENT REBUILD (2026-06-24, major rework, Phase 1)
-- ============================================================================
-- Throws out the old mentee/journey data model and replaces it with ONE
-- source-of-truth `mentees` table built as two layers:
--
--   * CA LAYER  (ca_* columns) — derived from CoachAccountable history and
--     REFRESHED on every sync (the materialize step in lib/sync.ts) + the manual
--     "Rebuild from CA". The sync OWNS these columns and overwrites them freely.
--
--   * HAND LAYER (status / status_stage / status_date / *_override / Notion info /
--     notes / is_test) — entered by staff. This is the SOURCE OF TRUTH and is
--     NEVER written by a sync (the materialize upsert only touches ca_* columns).
--
-- The app reads the EFFECTIVE value: hand override ?? ca value; status ?? ca_status.
-- This reconciles "our system is the source of truth" with "a CA sync refreshes
-- the facts" — CA refreshes its own layer; your hand edits always win.
--
-- ⚠ DESTRUCTIVE: this drops the old `mentees` (Notion seed), `mentee_outcomes`
-- (status/stage overrides) and `mentee_exclusions` (test flags). Apply ONCE at the
-- Phase-2 cutover (when the new Mentees page + code ship), then re-sync to fill the
-- CA layer and re-enter the Notion data by hand. The "excluded/test" flag now lives
-- on `mentees.is_test` (mentee_exclusions is gone).
--
-- RE-RUNNABLE: the old `mentees` is dropped ONLY while it still has the old schema
-- (detected via the `notion_key` column), so re-pasting this AFTER the cutover will
-- NOT wipe your hand-entered data. Apply via the Supabase SQL Editor.
-- Depends on set_updated_at() from 9999_init.
-- ============================================================================

-- Old override/exclusion tables are gone for good.
drop table if exists mentee_outcomes cascade;
drop table if exists mentee_exclusions cascade;

-- Replace the OLD `mentees` only (identified by its `notion_key` column). After the
-- cutover the new table has no `notion_key`, so this guard makes the script a no-op
-- on re-run instead of nuking populated data.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mentees' and column_name = 'notion_key'
  ) then
    drop table mentees cascade;
  end if;
end $$;

create table if not exists mentees (
  id            uuid primary key default gen_random_uuid(),
  -- CA client id. UNIQUE (Postgres treats NULLs as distinct, so many hand-added
  -- prospects with a null client_id are fine) and the onConflict target for the
  -- CA-layer upsert.
  client_id     bigint unique,

  -- ── CA layer (sync owns; refreshed every sync) ────────────────────────────
  ca_name              text,
  ca_owner_coach_id    bigint,
  ca_owner_coach_name  text,
  ca_discovery_date    date,
  ca_jumpstart_date    date,
  ca_tier_4x_date      date,
  ca_tier_2x_date      date,
  ca_tier_1x_date      date,
  ca_graduation_date   date,
  ca_first_meeting     date,
  ca_last_meeting      date,
  ca_meeting_count     integer not null default 0,
  ca_current_tier      text,    -- jumpstart | 4x | 2x | 1x | graduated | null
  ca_jumpstart_end     date,
  ca_jyf_purchase_date date,
  ca_start_date        date,    -- system start (discovery → jumpstart → JYF → first meeting)
  ca_has_open          boolean not null default false,
  ca_status            text,    -- active | graduated | inactive (CA guess)
  ca_synced_at         timestamptz,

  -- ── HAND layer (staff own; SOURCE OF TRUTH; sync never writes) ─────────────
  name_override            text,
  status                   text check (status in ('active','graduated','quit','fired','paused','declined')),
  status_stage             text check (status_stage in ('discovery','jumpstart','4x','2x','1x')),
  status_date              date,
  discovery_date_override  date,
  jumpstart_date_override  date,
  tier_4x_date_override    date,
  tier_2x_date_override    date,
  tier_1x_date_override    date,
  graduation_date_override date,
  owner_coach_id_override  bigint,
  email                    text,
  phone                    text,
  mentor                   text,   -- hand-entered mentor name (Notion)
  notion_status            text,   -- raw Notion pipeline status text
  notes                    text,
  is_test                  boolean not null default false,  -- replaces mentee_exclusions

  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_mentees_client on mentees (client_id);
create index if not exists idx_mentees_status on mentees (status);
drop trigger if exists trg_mentees_updated on mentees;
create trigger trg_mentees_updated before update on mentees
  for each row execute function set_updated_at();

-- RLS: signed-in staff read everything and read/write. A reviewer may delete only
-- their own rows. drop-if-exists keeps this re-runnable.
alter table mentees enable row level security;
drop policy if exists mentees_read on mentees;
create policy mentees_read on mentees for select to authenticated using (true);
drop policy if exists mentees_ins on mentees;
create policy mentees_ins  on mentees for insert to authenticated with check (true);
drop policy if exists mentees_upd on mentees;
create policy mentees_upd  on mentees for update to authenticated using (true);
drop policy if exists mentees_del on mentees;
create policy mentees_del  on mentees for delete to authenticated using (created_by = auth.uid());
