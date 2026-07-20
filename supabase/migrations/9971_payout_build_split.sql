-- Build-payout (§204): let the reviewer override the mentor's Split % for one
-- coach+month build. The engine's tenure ramp stays the source of truth — this
-- is a REVIEW decision persisted with the build (like line exclusions/overrides)
-- and only changes the built/effective numbers + the printed pay stub.
-- Stored as a FRACTION (0.5 = 50%), null = use the engine's ramp split.
-- Apply via the Supabase SQL Editor; re-runnable.

alter table payout_builds add column if not exists split_override numeric
  check (split_override is null or (split_override >= 0 and split_override <= 1));
