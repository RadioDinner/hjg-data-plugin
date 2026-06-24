// Pure logic for the conversion-rate TREND line on the Metrics "Discovery calls →
// conversion" card (src/views/MetricsView.tsx), configured by the Company option
// `metrics_conversion_trend_window` (src/companyOptions.ts).
//
// The card buckets discovery calls by signup MONTH. Instead of plotting each
// month's raw conversion rate (noisy), the line shows a TRAILING-WINDOW rate: for
// each month bucket, the conversion rate over the trailing window ending there.
// The window length is the org's choice — N weeks or N months:
//   - "months": the trailing N month buckets (this bucket + the prior N-1), summed.
//   - "weeks":  the trailing N*7 calendar days by EXACT call date, ending at the
//               bucket's month end — so a sub-month window is honored precisely.
//
// The window is computed from the calls loaded for the selected range, so the
// earliest buckets reflect a shorter (warming-up) window. Stored as a JSON string
// in app_settings so it rides the existing string-valued Company-options plumbing.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §18.

export type TrendUnit = "weeks" | "months";

export interface TrendWindow {
  n: number; // window length (>= 1, integer)
  unit: TrendUnit;
}

export const DEFAULT_TREND_WINDOW: TrendWindow = { n: 3, unit: "months" };

// Defensive parse of the stored JSON string -> a valid TrendWindow. Junk / empty /
// out-of-range all fall back to the default so the card never breaks on bad data.
export function parseTrendWindow(raw: string | null | undefined): TrendWindow {
  if (!raw) return { ...DEFAULT_TREND_WINDOW };
  try {
    const o = JSON.parse(raw) as Partial<TrendWindow>;
    const unit: TrendUnit = o.unit === "weeks" ? "weeks" : "months";
    let n = Math.floor(Number(o.n));
    if (!Number.isFinite(n) || n < 1) n = DEFAULT_TREND_WINDOW.n;
    if (n > 60) n = 60; // sane upper bound (≈5 years of months / >1 year of weeks)
    return { n, unit };
  } catch {
    return { ...DEFAULT_TREND_WINDOW };
  }
}

export function serializeTrendWindow(w: TrendWindow): string {
  return JSON.stringify({ n: w.n, unit: w.unit });
}

// Human label for the line / hint, e.g. "3-month" or "6-week".
export function trendWindowLabel(w: TrendWindow): string {
  const unit = w.unit === "weeks" ? "week" : "month";
  return `${w.n}-${unit}`;
}

// A single dated discovery call with its resolved outcome.
export interface TrendCall {
  date: string; // YYYY-MM-DD (signup date)
  converted: boolean;
}

export interface TrendPoint {
  key: string; // YYYY-MM bucket key
  converted: number;
  total: number;
  rate: number | null; // integer percent, or null when the window has no calls
}

// Last calendar day of a YYYY-MM month, as YYYY-MM-DD (UTC, matches the day-only
// date strings used elsewhere).
function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  // Day 0 of the next month = last day of this month.
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

// YYYY-MM-DD that is `days` before the given YYYY-MM-DD (UTC).
function minusDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const pct = (converted: number, total: number): number | null =>
  total > 0 ? Math.round((converted / total) * 100) : null;

// Trailing-window conversion rate per bucket, aligned 1:1 with `buckets`.
export function rollingConversionTrend(
  calls: TrendCall[],
  buckets: { key: string; label: string }[],
  window: TrendWindow
): TrendPoint[] {
  const w = parseTrendWindow(serializeTrendWindow(window)); // normalize/clamp

  if (w.unit === "months") {
    // Per-bucket-month aggregates, then sum the trailing N buckets.
    const byMonth = new Map<string, { converted: number; total: number }>();
    for (const c of calls) {
      const k = c.date.slice(0, 7);
      const agg = byMonth.get(k) ?? { converted: 0, total: 0 };
      agg.total++;
      if (c.converted) agg.converted++;
      byMonth.set(k, agg);
    }
    return buckets.map((b, i) => {
      let converted = 0;
      let total = 0;
      for (let j = Math.max(0, i - w.n + 1); j <= i; j++) {
        const agg = byMonth.get(buckets[j].key);
        if (agg) {
          converted += agg.converted;
          total += agg.total;
        }
      }
      return { key: b.key, converted, total, rate: pct(converted, total) };
    });
  }

  // weeks: trailing N*7 days by exact date, ending at each bucket's month end.
  const span = w.n * 7;
  return buckets.map((b) => {
    const anchor = monthEnd(b.key);
    const lowerExclusive = minusDays(anchor, span);
    let converted = 0;
    let total = 0;
    for (const c of calls) {
      if (c.date > lowerExclusive && c.date <= anchor) {
        total++;
        if (c.converted) converted++;
      }
    }
    return { key: b.key, converted, total, rate: pct(converted, total) };
  });
}
