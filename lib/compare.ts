// Pure period-comparison math for the Metrics "Compare" mode (period vs period).
// No I/O and no React — just date-range derivation and delta computation — so it
// is unit-testable in isolation (verify §10) and shared by the view. Frontend
// imports these via src/db.ts (the same re-export pattern as the pay engine).

export type CompareKey = "mom" | "qoq" | "yoy" | "custom";

export interface Range {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
}

export interface ComparePreset {
  key: CompareKey;
  label: string;
  // Canonical Period A this preset snaps to, and the month-shift used to derive
  // Period B from A. `custom` carries neither (both ranges are user-driven).
  base?: "this_month" | "this_quarter" | "this_year";
  shiftMonths?: number;
}

export const COMPARE_PRESETS: ComparePreset[] = [
  { key: "mom", label: "Month vs last", base: "this_month", shiftMonths: 1 },
  { key: "qoq", label: "Quarter vs last", base: "this_quarter", shiftMonths: 3 },
  { key: "yoy", label: "Year vs last", base: "this_year", shiftMonths: 12 },
  { key: "custom", label: "Custom" },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Shift a YYYY-MM-DD date back by `months`, clamping the day-of-month to the
// target month's length so e.g. shifting Mar 31 back one month yields Feb 28/29
// (a valid date) rather than overflowing into March. Span-aligned shifting keeps
// a partial current period (e.g. month-to-date) fairly comparable to the prior
// one (same number of days), which is what board "are we up or down?" wants.
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) - months; // absolute month index, 0-based month
  const ny = Math.floor(idx / 12);
  const nm0 = idx - ny * 12; // 0..11 (safe for negative idx)
  const lastDay = new Date(ny, nm0 + 1, 0).getDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${pad2(nm0 + 1)}-${pad2(nd)}`;
}

// Derive Period B from Period A for a preset key. Returns null for "custom",
// where B is user-specified rather than derived.
export function derivePeriodB(key: CompareKey, a: Range): Range | null {
  const p = COMPARE_PRESETS.find((x) => x.key === key);
  if (!p || p.shiftMonths == null) return null;
  return { from: shiftMonths(a.from, p.shiftMonths), to: shiftMonths(a.to, p.shiftMonths) };
}

export interface Delta {
  abs: number;
  pct: number | null; // percent change vs the baseline (b); null when b is 0
}

// Δ of a current value (a) against a baseline (b). `pct` is the percent change
// relative to the baseline; null when the baseline is 0 (no meaningful %).
export function delta(a: number, b: number): Delta {
  const abs = a - b;
  return { abs, pct: b === 0 ? null : (abs / b) * 100 };
}

// ---------------------------------------------------------------------------
// Point-in-time ("as of") presets for the JYF vs Active Mentoring card (§005).
// That card is a current-state snapshot, not a date range, so "compare" there
// means TODAY vs WHAT THE CARD WOULD HAVE SHOWN ON AN EARLIER DAY. The three
// presets pick that earlier day by shifting today back a calendar month /
// quarter / year (day-of-month clamped by shiftMonths, so Mar 31 → Feb 28).
// ---------------------------------------------------------------------------

export type AsOfKey = "month" | "quarter" | "year";

export interface AsOfPreset {
  key: AsOfKey;
  label: string;
  shiftMonths: number;
}

export const ASOF_PRESETS: AsOfPreset[] = [
  { key: "month", label: "Today vs a month ago", shiftMonths: 1 },
  { key: "quarter", label: "Today vs a quarter ago", shiftMonths: 3 },
  { key: "year", label: "Today vs a year ago", shiftMonths: 12 },
];

// The "then" date for a preset, given today's YYYY-MM-DD.
export function asOfDate(today: string, key: AsOfKey): string {
  const p = ASOF_PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`unknown as-of preset: ${key}`);
  return shiftMonths(today, p.shiftMonths);
}
