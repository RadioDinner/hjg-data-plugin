-- HJG-owned mentor metadata, keyed by ca_coaches.id. Lets staff mark which
-- coaches actually count as mentors (the CA team has more "coaches" than real
-- mentors) and set a capacity (max concurrent mentees they can take). Stays
-- separate from ca_coaches because that table is overwritten on every CA sync.
--
-- Editing UI: Admin tab → "Mentor capacity" card.
-- Read by: Metrics tab → Mentors metric is filtered to is_mentor=true when any
-- row in this table has is_mentor=true; a "Mentor capacity utilization" card
-- shows current mentees vs capacity per mentor.
--
-- Apply via the Supabase SQL Editor. Depends on set_updated_at() from 9999_init.

create table if not exists coach_settings (
  coach_id     integer primary key,             -- references ca_coaches.id (logical, not FK — mirror is rewritten by sync)
  is_mentor    boolean not null default false,
  capacity     integer check (capacity is null or capacity >= 0),
  notes        text,
  created_by   uuid references auth.users (id),
  updated_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_coach_settings_is_mentor on coach_settings (is_mentor) where is_mentor = true;
drop trigger if exists trg_coach_settings_updated on coach_settings;
create trigger trg_coach_settings_updated before update on coach_settings
  for each row execute function set_updated_at();

-- RLS: same pattern as the other HJG-owned tables — authenticated staff can
-- read everything and write. drop-if-exists keeps this script re-runnable in
-- the SQL Editor.
alter table coach_settings enable row level security;
drop policy if exists coach_settings_read on coach_settings;
create policy coach_settings_read on coach_settings for select to authenticated using (true);
drop policy if exists coach_settings_ins on coach_settings;
create policy coach_settings_ins  on coach_settings for insert to authenticated with check (true);
drop policy if exists coach_settings_upd on coach_settings;
create policy coach_settings_upd  on coach_settings for update to authenticated using (true);
drop policy if exists coach_settings_del on coach_settings;
create policy coach_settings_del  on coach_settings for delete to authenticated using (created_by = auth.uid());
