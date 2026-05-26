// Daily cap on CoachAccountable calls, now backed by Postgres instead of KV.
// Config lives in app_settings (ca_plan_daily_limit, daily_cap_pct), falling
// back to env defaults. "Used today" is the sum of calls_made across today's
// sync_runs (in the configured timezone). The sync job drives a BudgetTracker
// that refuses a CA call once the cap would be crossed.

import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = strEnv("BUDGET_TZ", "America/Chicago");

export class BudgetExhaustedError extends Error {
  constructor(public capDaily: number) {
    super("Daily CoachAccountable call budget exhausted");
    this.name = "BudgetExhaustedError";
  }
}

function numEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function tzDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function settingNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export interface BudgetConfig {
  planDailyLimit: number;
  capPct: number;
  capDaily: number;
}

export async function getBudgetConfig(admin: SupabaseClient): Promise<BudgetConfig> {
  const { data } = await admin
    .from("app_settings")
    .select("key,value")
    .in("key", ["ca_plan_daily_limit", "daily_cap_pct"]);
  const map = new Map<string, unknown>((data ?? []).map((r) => [r.key as string, r.value]));
  const planDailyLimit = settingNumber(map.get("ca_plan_daily_limit"), numEnv("CA_PLAN_DAILY_LIMIT", 600));
  const capPct = settingNumber(map.get("daily_cap_pct"), numEnv("HJG_DAILY_CAP_PCT", 5));
  const capDaily = Math.max(1, Math.floor((planDailyLimit * capPct) / 100));
  return { planDailyLimit, capPct, capDaily };
}

// Sum of CA calls made by today's sync runs (configured-timezone calendar day).
// Fetches a bounded recent window then filters by local date in JS, which avoids
// fragile timezone-instant arithmetic in the query.
export async function getUsedToday(admin: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data } = await admin
    .from("sync_runs")
    .select("calls_made,started_at")
    .gte("started_at", since);
  const today = tzDate(new Date());
  let sum = 0;
  for (const r of data ?? []) {
    if (tzDate(new Date(r.started_at as string)) === today) sum += Number(r.calls_made) || 0;
  }
  return sum;
}

export interface BudgetStatus extends BudgetConfig {
  usedToday: number;
  remainingToday: number;
}

export async function budgetStatus(admin: SupabaseClient): Promise<BudgetStatus> {
  const [cfg, usedToday] = await Promise.all([getBudgetConfig(admin), getUsedToday(admin)]);
  return { ...cfg, usedToday, remainingToday: Math.max(0, cfg.capDaily - usedToday) };
}

// Drives a single sync run's CA spend. spend() is called immediately before each
// wire call and throws once the daily cap (accounting for calls already made
// today by prior runs) would be crossed, so a multi-call sync can't overshoot.
export class BudgetTracker {
  private local = 0;
  constructor(private capDaily: number, private usedAtStart: number) {}

  get callsMade(): number {
    return this.local;
  }

  spend(): void {
    if (this.usedAtStart + this.local >= this.capDaily) {
      throw new BudgetExhaustedError(this.capDaily);
    }
    this.local++;
  }
}

export async function makeTracker(admin: SupabaseClient): Promise<BudgetTracker> {
  const [{ capDaily }, used] = await Promise.all([getBudgetConfig(admin), getUsedToday(admin)]);
  return new BudgetTracker(capDaily, used);
}
