-- CA Engagement mirror. CoachAccountable models a coaching "Engagement" per
-- client (often one per program tier — JumpStart / 4x / 2x / 1x), each with a
-- name, start/end dates, and a complete/canceled close state. We already store
-- the bare EngagementID on ca_appointments; this table is the dimension behind
-- it, and the source of truth for the pipeline-stage timeline on the Journeys
-- tab. Written only by the sync job (service role); read by all authenticated.
--
-- READ-ONLY mirror: the sync calls Engagement.getAll only — nothing is written
-- back to CoachAccountable. Apply via the Supabase SQL Editor; re-runnable.

create table if not exists ca_engagements (
  id                    bigint primary key,   -- CA Engagement.ID
  type                  text,
  client_id             bigint,
  company_id            bigint,
  coach_id              bigint,
  with_name             text,
  name                  text,                 -- engagement/template name (likely encodes the tier)
  start_raw             text,
  start_date            date,
  end_raw               text,
  end_date              date,
  allocation_units      text,                 -- "A" appointments or "M" minutes
  allocation            int,
  allocation_used_a     int,
  allocation_used_p     int,
  allocation_used_v     int,
  allocation_per_client int,
  is_complete           boolean,
  is_canceled           boolean,
  date_closed_raw       text,
  date_closed           date,
  date_added_raw        text,
  date_added            date,
  synced_at             timestamptz not null default now()
);
create index if not exists idx_ca_engagement_client on ca_engagements (client_id);
create index if not exists idx_ca_engagement_coach on ca_engagements (coach_id);

-- Read-only for authenticated users (same as the other ca_* mirrors). Service
-- role bypasses RLS for the sync upserts. drop-if-exists keeps this re-runnable.
alter table ca_engagements enable row level security;
drop policy if exists ca_engagements_read on ca_engagements;
create policy ca_engagements_read on ca_engagements for select to authenticated using (true);
