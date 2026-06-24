-- Mentees: "hand reviewed" flag (2026-06-24). Marks a mentee record as having been
-- human/hand reviewed. It is set automatically when staff save an edit to the
-- record on the Journeys "Mentee record" card, and can also be ticked directly
-- (without editing anything) to acknowledge a review. `hand_reviewed_at` records
-- when it was last set true (null when not reviewed).
--
-- Apply via the Supabase SQL Editor. Re-runnable (add column if not exists).

alter table mentees add column if not exists hand_reviewed boolean not null default false;
alter table mentees add column if not exists hand_reviewed_at timestamptz;
