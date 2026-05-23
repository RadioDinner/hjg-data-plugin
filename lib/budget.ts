// The hard daily cap on CoachAccountable calls. Every CA call routes through
// spendOne(); once today's counter reaches the cap, spendOne throws and the
// caller serves a stale snapshot instead of hitting CA.

import { store } from "./store";
import { BUDGET_DEFAULTS } from "./config";

const CAP_OVERRIDE_KEY = "settings:capDaily";
const COUNTER_TTL_SECONDS = 60 * 60 * 36; // 36h: outlives any single budget day

export class BudgetExhaustedError extends Error {
  constructor(public capDaily: number) {
    super("Daily CoachAccountable call budget exhausted");
    this.name = "BudgetExhaustedError";
  }
}

// Date string (YYYY-MM-DD) in the configured timezone, so the counter rolls on
// the local calendar day rather than UTC.
export function budgetDayKey(now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDGET_DEFAULTS.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `ca:calls:${ymd}`;
}

export function defaultCap(): number {
  return Math.max(
    1,
    Math.floor((BUDGET_DEFAULTS.planDailyLimit * BUDGET_DEFAULTS.capPct) / 100)
  );
}

export async function getCap(): Promise<{ capDaily: number; source: "default" | "override" }> {
  const override = await store.getJSON<number>(CAP_OVERRIDE_KEY);
  if (typeof override === "number" && override > 0) {
    return { capDaily: override, source: "override" };
  }
  return { capDaily: defaultCap(), source: "default" };
}

export async function setCap(capDaily: number | null): Promise<void> {
  if (capDaily === null) {
    await store.setJSON(CAP_OVERRIDE_KEY, null);
    return;
  }
  await store.setJSON(CAP_OVERRIDE_KEY, capDaily);
}

export async function getUsedToday(): Promise<number> {
  return store.getNumber(budgetDayKey());
}

export async function budgetStatus(): Promise<{
  capDaily: number;
  usedToday: number;
  remainingToday: number;
  source: "default" | "override";
  planDailyLimit: number;
  capPct: number;
}> {
  const [{ capDaily, source }, usedToday] = await Promise.all([getCap(), getUsedToday()]);
  return {
    capDaily,
    usedToday,
    remainingToday: Math.max(0, capDaily - usedToday),
    source,
    planDailyLimit: BUDGET_DEFAULTS.planDailyLimit,
    capPct: BUDGET_DEFAULTS.capPct,
  };
}

// Reserve one CA call against today's budget. Throws BudgetExhaustedError if the
// cap is reached. Checked per-call (not once up front) so a multi-call refresh
// can't overshoot.
export async function spendOne(): Promise<void> {
  const { capDaily } = await getCap();
  const used = await getUsedToday();
  if (used >= capDaily) throw new BudgetExhaustedError(capDaily);
  const next = await store.incr(budgetDayKey(), COUNTER_TTL_SECONDS);
  // Race guard: if a concurrent caller pushed us past the cap, we've already
  // counted this one, but the next check will block further calls. With a 5%
  // cap the 1-call overshoot is immaterial (see SPEC.md s5.4).
  if (next > capDaily + 1) throw new BudgetExhaustedError(capDaily);
}
