// Pure helpers for the Pay-staff "Build payout" reviewer (src/views/BuildPayoutView.tsx).
//
// A deliberate HUMAN review layer over the automated payroll engine (lib/pay).
// The reviewer loads one coach + one service month, then for each engine-computed
// line decides to include or exclude it, and may OVERRIDE a line's payout (with a
// note explaining why). None of this mutates the engine — the engine stays the
// source of truth; this only records the human decisions and the signed-off total
// so there's an auditable record of what was checked before money goes out.
//
// No I/O here, so it's unit-testable (scripts/verify-metrics.ts §13) and reusable
// from the browser. The DB shape that persists these decisions lives in
// supabase/migrations/9989_payout_builds.sql; the access layer is src/db.ts.

// Per-line review decision, keyed by clientId within a build. A line with no
// stored state is treated as DEFAULT_LINE_STATE (included, no override, no note).
export interface BuildLineState {
  included: boolean; // counted toward the built total
  override: number | null; // reviewer-set payout; null = use the engine's number
  note: string | null; // why this line was changed/dropped
}

export const DEFAULT_LINE_STATE: BuildLineState = { included: true, override: null, note: null };

// Minimal shape a reviewable line must expose — both PayMenteeLine and
// PayLedgerRow satisfy it, so the engine's output drops straight in.
export interface BuildLineInput {
  clientId: number;
  payout: number; // engine-computed payout for this line
}

export type BuildStatus = "draft" | "approved";

const round2 = (n: number) => Math.round(n * 100) / 100;

// A non-default state is one worth persisting (excluded, overridden, or noted).
// Lets the store keep line_states compact — default lines aren't written.
export function isDefaultLineState(s: BuildLineState): boolean {
  return s.included && s.override == null && (s.note == null || s.note === "");
}

// What a line actually contributes to the built total: 0 if excluded, else the
// override when set, else the engine's payout.
export function effectiveLinePayout(enginePayout: number, state?: BuildLineState): number {
  const s = state ?? DEFAULT_LINE_STATE;
  if (!s.included) return 0;
  return round2(s.override != null ? s.override : enginePayout);
}

// Roll-up of a build: the engine total (every line), the reviewed/built total
// (included lines with overrides applied), the drift between them, and counts.
export interface BuildSummary {
  computedTotal: number; // Σ engine payout over ALL lines — the automated number
  builtTotal: number; // Σ effective payout over included lines — the signed-off number
  delta: number; // builtTotal - computedTotal (how far review moved the number)
  lineCount: number;
  includedCount: number;
  excludedCount: number;
  overriddenCount: number; // included lines carrying an override
}

export function summarizeBuild(lines: BuildLineInput[], states: Map<number, BuildLineState>): BuildSummary {
  let computedTotal = 0;
  let builtTotal = 0;
  let includedCount = 0;
  let excludedCount = 0;
  let overriddenCount = 0;
  for (const l of lines) {
    computedTotal += l.payout;
    const s = states.get(l.clientId) ?? DEFAULT_LINE_STATE;
    builtTotal += effectiveLinePayout(l.payout, s);
    if (s.included) {
      includedCount++;
      if (s.override != null) overriddenCount++;
    } else {
      excludedCount++;
    }
  }
  return {
    computedTotal: round2(computedTotal),
    builtTotal: round2(builtTotal),
    delta: round2(builtTotal - computedTotal),
    lineCount: lines.length,
    includedCount,
    excludedCount,
    overriddenCount,
  };
}
