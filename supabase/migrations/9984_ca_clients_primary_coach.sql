-- CoachAccountable's PRIMARY-COACH pairing, mirrored onto ca_clients.
-- CA's Client.getAll returns a `CoachID` per client = the client's primary coach
-- (the "managed by" pairing you set/change in CA). We previously dropped it; this
-- adds it so the dashboard can treat the PRIMARY COACH as the mentee's OWNER
-- (decided with the user, session 009): owner drives the Journeys owner display,
-- Mentor-capacity grouping, AND Pay-staff payout attribution.
--
-- The sync (lib/sync.ts) now populates this from Client.CoachID. Until the next
-- re-sync runs it stays null, and every consumer falls back to the prior
-- engagement/appointment-derived coach — so the dashboard never breaks waiting on
-- the data. Apply via the Supabase SQL Editor; re-runnable.

alter table ca_clients add column if not exists coach_id bigint;  -- CA Client.CoachID = primary coach (owner)

create index if not exists idx_ca_clients_coach on ca_clients (coach_id);
