// Pure discovery-call conversion logic. No I/O — the browser data layer
// (src/db.ts) feeds it purchase dates and manual overrides; the verify harness
// exercises it directly. The rule and its knobs live in config.ts.

import { DISCOVERY_DECISION_WINDOW_DAYS } from "./config";

export type DiscoveryOutcomeValue = "converted" | "not_converted" | "pending" | "no_show";

export type ResolvedOutcomeSource = "manual" | "auto";

// The outcome a discovery call resolves to, plus where it came from. "manual"
// means staff recorded it by hand (always wins); "auto" means it was derived
// from JumpStart purchase data via the rule below.
export interface ResolvedOutcome {
  outcome: DiscoveryOutcomeValue;
  source: ResolvedOutcomeSource;
  reason: string;
}

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Whole days from `a` to `b`, both YYYY-MM-DD. Parsed at UTC midnight so DST
// can't shift the count.
function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// The conversion rule, as a pure function so it's easy to reason about and test:
//   manual override     -> wins outright
//   JumpStart purchase   -> "converted" (purchase dated on/after the call)
//   else, call <= window -> "pending"
//   else                 -> "not_converted"
// `conversionPurchaseDates` are this client's qualifying purchase dates
// (YYYY-MM-DD), ascending.
export function resolveDiscoveryOutcome(args: {
  callDate: string | null;
  manual: DiscoveryOutcomeValue | null;
  conversionPurchaseDates: string[];
  today?: string;
  windowDays?: number;
}): ResolvedOutcome {
  const today = args.today ?? todayYmd();
  const windowDays = args.windowDays ?? DISCOVERY_DECISION_WINDOW_DAYS;

  if (args.manual) {
    return { outcome: args.manual, source: "manual", reason: "Set by staff (overrides automation)" };
  }
  const purchase = args.callDate ? args.conversionPurchaseDates.find((d) => d >= args.callDate!) : undefined;
  if (purchase) {
    return { outcome: "converted", source: "auto", reason: `Bought JumpStart (Waiting List) on ${purchase}` };
  }
  if (!args.callDate) {
    return { outcome: "pending", source: "auto", reason: "No call date on record yet" };
  }
  const age = daysBetween(args.callDate, today);
  if (age <= windowDays) {
    return { outcome: "pending", source: "auto", reason: `Awaiting decision — day ${Math.max(age, 0)} of ${windowDays}` };
  }
  return { outcome: "not_converted", source: "auto", reason: `No JumpStart purchase within ${windowDays} days of the call` };
}
