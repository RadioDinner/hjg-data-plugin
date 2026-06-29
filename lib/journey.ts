// Pure pipeline stage-date logic for the Journeys tab. Two bases, switchable via
// the org-wide "journeys_stage_basis" company option:
//   - "engagement_start": each stage is dated by the CoachAccountable engagement's
//     start date (earliest engagement of that tier).
//   - "first_meeting": each stage is dated by the first 1-on-1 MENTORING meeting
//     tied to that tier's engagement (group sessions excluded), falling back to
//     the engagement start when a tier has an engagement but no meeting yet.
// No I/O, no React — unit-testable in isolation (verify §12).

import { PIPELINE_TIERS, type PipelineTier } from "./config.js";

export type StageBasis = "engagement_start" | "first_meeting";

export interface EngagementStageInput {
  tier: PipelineTier;
  startDate: string | null;
}

export interface MeetingStageInput {
  tier: PipelineTier | null; // tier of the meeting's engagement (null if unknown)
  date: string | null;
  isGroup: boolean; // group session — excluded from "first meeting"
}

export function emptyStageDates(): Record<PipelineTier, string | null> {
  return { jumpstart: null, "4x": null, "2x": null, "1x": null, graduated: null };
}

// Earliest engagement start date per tier.
export function stageDatesFromEngagements(engs: EngagementStageInput[]): Record<PipelineTier, string | null> {
  const out = emptyStageDates();
  for (const e of engs) {
    if (!e.startDate) continue;
    const cur = out[e.tier];
    if (cur === null || e.startDate < cur) out[e.tier] = e.startDate;
  }
  return out;
}

// Earliest 1-on-1 mentoring meeting per tier (group sessions excluded), falling
// back to the engagement start for any tier that has an engagement but no
// qualifying meeting yet (so a tier never silently disappears).
export function stageDatesFromFirstMeeting(
  engs: EngagementStageInput[],
  meets: MeetingStageInput[]
): Record<PipelineTier, string | null> {
  const out = emptyStageDates();
  for (const m of meets) {
    if (m.isGroup || !m.date || !m.tier) continue;
    const cur = out[m.tier];
    if (cur === null || m.date < cur) out[m.tier] = m.date;
  }
  const fallback = stageDatesFromEngagements(engs);
  for (const t of PIPELINE_TIERS) {
    if (out[t] === null && fallback[t] !== null) out[t] = fallback[t];
  }
  return out;
}

export function computeStageDates(
  basis: StageBasis,
  engs: EngagementStageInput[],
  meets: MeetingStageInput[]
): Record<PipelineTier, string | null> {
  return basis === "first_meeting" ? stageDatesFromFirstMeeting(engs, meets) : stageDatesFromEngagements(engs);
}

// Highest pipeline tier reached = the latest tier (in PIPELINE_TIERS order) that
// has a date.
export function highestTier(stageDates: Record<PipelineTier, string | null>): PipelineTier | null {
  let best: PipelineTier | null = null;
  for (const t of PIPELINE_TIERS) if (stageDates[t]) best = t;
  return best;
}
