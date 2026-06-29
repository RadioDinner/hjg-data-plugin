// Pure logic for the Journeys pipeline-timing "Compare start-date cohorts" tool
// (src/views/JourneysView.tsx → PipelineSummary). The card can split the roster
// into two start-date bands — e.g. "started 0–3 months ago" vs "4–6 months ago" —
// and roll up how each band is doing (counts, graduation rate, days in system,
// current-tier mix). The stage-leg durations per cohort reuse
// aggregateJourneyDurations (db.ts); this module owns the windowing + summary math.
//
// A cohort's "start date" is the mentee's SYSTEM START (the same basis as
// `daysInSystem`): first of discovery call → JumpStart → JYF purchase → first
// meeting, resolved upstream into MenteeJourney.startDate.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §19.

// Minimal structural view of a mentee journey (a subset of db.ts MenteeJourney)
// so this module stays pure and independently testable.
export interface CohortJourneyInput {
  startDate: string | null; // system start (YYYY-MM-DD)
  daysInSystem: number | null;
  resolvedStatus: string; // "active" | "graduated" | "quit" | "fired" | "no_mentoring" | "inactive"
  currentTier: string | null; // "jumpstart" | "4x" | "2x" | "1x" | "graduated" | null
  excluded: boolean;
  inSourceOfTruth: boolean;
}

// Current-tier buckets reported in the cohort tier-mix, in pipeline order.
export const COHORT_TIERS = ["jumpstart", "4x", "2x", "1x", "graduated"] as const;
export type CohortTier = (typeof COHORT_TIERS)[number];

// A start-date band, expressed as a half-open count of months-ago. `from` is the
// more-recent edge, `to` the older edge (from <= to). 0–3 = the last three months.
export interface StartWindow {
  fromMonths: number;
  toMonths: number;
}

// YYYY-MM-DD for `n` months before `today` (itself a YYYY-MM-DD string). Pure —
// `today` is passed in (not read from the clock) so the function is deterministic
// and verify-friendly. Computed at UTC midnight to avoid DST drift.
export function monthsAgoYmd(today: string, n: number): string {
  const [y, m, d] = today.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() - n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// True when `startDate` falls in the window "started between `fromMonths` and
// `toMonths` months ago". Inclusive on both edges. A null start is never in a
// window. The arguments are order-insensitive (min/max are taken internally).
export function inStartWindow(startDate: string | null, w: StartWindow, today: string): boolean {
  if (!startDate) return false;
  const lo = Math.min(w.fromMonths, w.toMonths);
  const hi = Math.max(w.fromMonths, w.toMonths);
  const newest = monthsAgoYmd(today, lo); // closer to today (later date)
  const oldest = monthsAgoYmd(today, hi); // further back (earlier date)
  const s = startDate.slice(0, 10);
  return s >= oldest && s <= newest;
}

export interface CohortStats {
  total: number; // in-roster, non-excluded mentees in the cohort
  active: number;
  graduated: number;
  pctGraduated: number | null; // graduated / total (0..1); null when total is 0
  avgDaysInSystem: number | null; // mean over non-negative daysInSystem
  tierMix: Record<CohortTier, number>; // counts by current tier
}

// Roll up one cohort. Mirrors aggregateJourneyDurations' scoping: excluded mentees
// and anyone off the Mentees source-of-truth roster don't count.
export function summarizeCohort(journeys: CohortJourneyInput[]): CohortStats {
  const inScope = journeys.filter((j) => j.inSourceOfTruth && !j.excluded);
  const total = inScope.length;
  let active = 0;
  let graduated = 0;
  const tierMix: Record<CohortTier, number> = { jumpstart: 0, "4x": 0, "2x": 0, "1x": 0, graduated: 0 };
  const dis: number[] = [];
  for (const j of inScope) {
    if (j.resolvedStatus === "active") active++;
    if (j.resolvedStatus === "graduated") graduated++;
    if (j.currentTier && (COHORT_TIERS as readonly string[]).includes(j.currentTier)) {
      tierMix[j.currentTier as CohortTier]++;
    }
    if (j.daysInSystem != null && j.daysInSystem >= 0) dis.push(j.daysInSystem);
  }
  const avgDaysInSystem = dis.length ? Math.round(dis.reduce((s, v) => s + v, 0) / dis.length) : null;
  const pctGraduated = total ? graduated / total : null;
  return { total, active, graduated, pctGraduated, avgDaysInSystem, tierMix };
}

// Compact "started 0–3 months ago" style label for a window.
export function startWindowLabel(w: StartWindow): string {
  const lo = Math.min(w.fromMonths, w.toMonths);
  const hi = Math.max(w.fromMonths, w.toMonths);
  return `${lo}–${hi} mo ago`;
}
