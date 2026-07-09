-- Payment groups: which CoachAccountable engagement templates count toward which
-- group of staff for payout calculations (Company options → Payment groups, §451).
--
-- Two parts:
--  1) ca_engagement_templates — a read-only mirror of CoachAccountable's Engagement
--     Templates (Engagement.getTemplates: ID, name, managingCoachID, duration,
--     allocationUnit, allocation). Written only by the sync (service role); read by
--     all authenticated. This is the row source for the checkbox grid.
--  2) app_settings key `pay_engagement_groups` — the org-wide config: a list of
--     groups, each with the engagement-template NAMES checked for it and the coach
--     IDs assigned to it. Stored as a JSON *string* so it rides the existing
--     string-valued Company-options plumbing (fetchCompanyOptions). Staff can UPDATE
--     app_settings (RLS) but there is no staff INSERT policy, so the key is seeded
--     here. Registry entry: src/companyOptions.ts; pure logic + default: lib/payGroups.ts.
--
-- Apply via the Supabase SQL Editor; re-runnable. After applying, run a sync (or the
-- "Refresh templates" button) to populate ca_engagement_templates.

create table if not exists ca_engagement_templates (
  id                bigint primary key,   -- CA Engagement Template ID
  name              text,                 -- e.g. "MN Subscription | (4x Month) Zoom Meetings"
  managing_coach_id bigint,
  duration          int,
  allocation_unit   text,
  allocation        int,
  synced_at         timestamptz not null default now()
);

alter table ca_engagement_templates enable row level security;
drop policy if exists ca_engagement_templates_read on ca_engagement_templates;
create policy ca_engagement_templates_read on ca_engagement_templates for select to authenticated using (true);

-- Seed the Payment-groups config. Default = one "Mentors" group with NO templates
-- or coaches yet. The pay engine falls back to the legacy 4x/2x/1x auto-detection
-- while a group's template list is empty, so payouts are unchanged until an admin
-- checks templates in the grid (at which point the grid becomes authoritative).
insert into app_settings (key, value) values
  (
    'pay_engagement_groups',
    to_jsonb('{"groups":[{"id":"mentors","name":"Mentors","templateNames":[],"coachIds":[]}]}'::text)
  )
on conflict (key) do nothing;
