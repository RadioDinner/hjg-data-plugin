// Pure "JYF vs Active Mentoring" cohort metric (src/views/MetricsView.tsx).
//
// A current-state snapshot (not date-range scoped): how many people are
// currently in the SUPERVISED start (JumpStart Your Freedom) versus how many
// are in ongoing 1-on-1 mentoring (4x / 2x / 1x). Both sides count distinct
// PEOPLE (clients), and only OPEN engagements — an engagement is open when it
// is neither complete nor canceled. Completed JumpStarts and graduated mentees
// drop out; this is "who is in the room right now", by phase.
//
// - jyf       = distinct clients with an open JumpStart ("jumpstart") engagement.
// - mentoring = distinct clients with an open 4x / 2x / 1x engagement.
// - byTier    = distinct clients per ongoing tier. A person with two open
//               mentoring engagements of different tiers (rare) appears under
//               both, so the byTier values can sum to MORE than `mentoring`;
//               `mentoring` is the de-duplicated headline.
//
// Tier resolution is delegated to engagementTier() so it stays in lockstep with
// the rest of the app. Exclusions (placeholder/group clients, staff-excluded
// test mentees) are applied by the caller before handing engagements here.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §15.

import { engagementTier } from "./config";

export interface CohortEngagementInput {
  clientId: number;
  name: string | null;
  isComplete: boolean | null;
  isCanceled: boolean | null;
}

export type MentoringTier = "4x" | "2x" | "1x";

export interface JyfVsMentoring {
  jyf: number; // distinct clients with an open JumpStart engagement
  mentoring: number; // distinct clients with an open 4x/2x/1x engagement
  byTier: Record<MentoringTier, number>; // distinct clients per ongoing tier (may overlap)
  total: number; // distinct clients in either bucket (de-duplicated)
}

const MENTORING_TIERS: ReadonlySet<string> = new Set<MentoringTier>(["4x", "2x", "1x"]);

export function computeJyfVsMentoring(engagements: CohortEngagementInput[]): JyfVsMentoring {
  const jyfClients = new Set<number>();
  const mentoringClients = new Set<number>();
  const tierClients: Record<MentoringTier, Set<number>> = {
    "4x": new Set<number>(),
    "2x": new Set<number>(),
    "1x": new Set<number>(),
  };
  for (const e of engagements) {
    if (e.clientId == null) continue;
    if (e.isComplete || e.isCanceled) continue; // only open / active engagements
    const tier = engagementTier(e.name);
    if (tier === "jumpstart") {
      jyfClients.add(e.clientId);
    } else if (MENTORING_TIERS.has(tier)) {
      mentoringClients.add(e.clientId);
      tierClients[tier as MentoringTier].add(e.clientId);
    }
  }
  return {
    jyf: jyfClients.size,
    mentoring: mentoringClients.size,
    byTier: { "4x": tierClients["4x"].size, "2x": tierClients["2x"].size, "1x": tierClients["1x"].size },
    total: new Set<number>([...jyfClients, ...mentoringClients]).size,
  };
}
