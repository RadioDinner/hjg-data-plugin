-- ============================================================================
-- 9974 — MENTEE MANAGEMENT REWRITE (2026-06-27, session 010): THREE WRITE ZONES
-- ============================================================================
-- Replaces 9975's two-layer table with a THREE-ZONE model whose writers never
-- touch each other's columns, so each source refreshes independently and nothing
-- clobbers anything:
--
--   * CA zone     (ca_*)      — written ONLY by the sync materialize step
--     (lib/sync.ts) + the manual "Rebuild from CA" (rebuildMenteesFromCa). The
--     objective CoachAccountable facts: owner coach, stage dates, meetings,
--     current tier, jumpstart end, jyf purchase, a coarse status guess. Refreshed
--     every sync. (Columns are byte-for-byte the 9975 ca_* set, so the existing
--     sync upsert keeps working with NO functional change.)
--
--   * NOTION zone (notion_*)  — written ONLY by the in-app CSV importer
--     (db.ts upsertMenteeNotion). The human record hand-copied from Notion:
--     name, the 8-value pipeline Status, the assigned coach (Mentor 1 / Mentor,
--     which should agree → notion_coach_conflict flags when they don't), email,
--     phone, the discovery-call date, and the offering signup. Re-importable.
--
--   * HAND zone   (*_override / status* / notes / is_test) — written ONLY by
--     in-app manual edits. The staff source of truth; NEVER touched by sync or
--     import. "Accept into hand" in the detail panel writes here.
--
-- The app reads the EFFECTIVE value: hand ?? notion ?? ca for shared fields;
-- single-owner fields pass through their zone (lib/menteeView.ts).
--
-- ⚠ DESTRUCTIVE (approved): drops whatever `mentees` exists (9975's two-layer
-- table, or the older Notion-seed table) and recreates it. The old override /
-- exclusion tables stayed gone since 9975.
--
-- RE-RUNNABLE: the table is dropped ONLY while it still LACKS `notion_name`
-- (i.e. it is a pre-9974 shape). After this migration runs once the new table
-- HAS notion_name, so re-pasting is a no-op and never wipes imported/hand data.
-- Apply via the Supabase SQL Editor. Depends on set_updated_at() from 9999_init.
-- ============================================================================

-- Drop the table only if it is an OLD shape (no notion_name). Guarded so a
-- re-paste after cutover does not nuke populated data.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mentees' and column_name = 'notion_name'
  ) then
    drop table if exists mentees cascade;
  end if;
end $$;

create table if not exists mentees (
  id            uuid primary key default gen_random_uuid(),
  -- CA client id. UNIQUE (Postgres treats NULLs as distinct, so many Notion-only
  -- prospects with a null client_id coexist) and the onConflict target for the
  -- CA-layer upsert.
  client_id     bigint unique,

  -- ── CA zone (sync owns; refreshed every sync) ─────────────────────────────
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

  -- ── NOTION zone (importer owns; refreshed each re-import; sync never writes) ─
  notion_name            text,   -- Notion "Mentees Paired" title (also the match-by-name source)
  notion_status          text,   -- Notion "Status" (8-value pipeline; first-class filter)
  notion_coach           text,   -- reconciled Mentor 1 + Mentor
  notion_coach_conflict  boolean not null default false,  -- Mentor 1 ≠ Mentor
  notion_email           text,
  notion_phone           text,
  notion_dc_date         date,   -- Notion "DC Date" (discovery)
  notion_offering_signup text,
  notion_imported_at     timestamptz,

  -- ── HAND zone (staff own; SOURCE OF TRUTH; sync + import never write) ──────
  name_override            text,
  -- New lifecycle taxonomy: drops 'paused', adds 'no_mentoring' + out-of-funnel 'imn'.
  status                   text check (status in ('active','graduated','quit','fired','no_mentoring','declined','imn')),
  status_stage             text check (status_stage in ('pre_waiting','discovery','jumpstart','4x','2x','1x')),
  status_date              date,
  pre_waiting_date_override date,
  discovery_date_override  date,
  jumpstart_date_override  date,
  tier_4x_date_override    date,
  tier_2x_date_override    date,
  tier_1x_date_override    date,
  graduation_date_override date,
  owner_coach_id_override  bigint,
  -- Shared-field hand overrides (the "accept into hand" target for the 3-source panel).
  email_override           text,
  phone_override           text,
  coach_override           text,
  notes                    text,
  is_test                  boolean not null default false,

  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_mentees_client        on mentees (client_id);
create index if not exists idx_mentees_status         on mentees (status);
create index if not exists idx_mentees_notion_status  on mentees (notion_status);  -- first-class filter
create index if not exists idx_mentees_notion_name    on mentees (lower(notion_name));  -- name match
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
