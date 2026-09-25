// HOURLY LINES — the timesheet line model (date, work, hours, optional per-line
// rate) and its pay math. Shared by BOTH pay paths, like lib/pieceWork:
//   • hourly staff  — staff_pay_builds.entries   (lib/hourlyPay, HourlyPayView)
//   • mentor builds — payout_builds.hour_items   (lib/payBuild + lib/payStub,
//     BuildPayoutView; migration 9962). Hourly work is paid 100% to the person —
//     a mentor's Split % never touches it.
// Lives apart from lib/hourlyPay because that module imports the stub stylesheet
// from lib/payStub, and payStub needs these lines (no import cycle).
//
// No I/O — unit-tested in scripts/verify-metrics.ts.

const round2 = (n: number) => Math.round(n * 100) / 100;

// One timesheet line: an optional date, a free-text description, hours, and an
// OPTIONAL per-line rate. `rate == null` (the common case) means "pay this line
// at the period's default rate"; a number overrides it for this line only.
export interface HourlyEntry {
  date: string | null; // 'YYYY-MM-DD' or null (a lump-sum line like "Admin work")
  label: string;
  hours: number;
  rate?: number | null; // $/h for THIS line; null/undefined = the period default
}

// The rate a line is actually paid at. A negative or non-finite override falls
// back to the default rather than silently paying nothing.
export function entryRate(e: HourlyEntry, defaultRate: number): number {
  const r = e.rate;
  return r != null && Number.isFinite(r) && r >= 0 ? r : defaultRate || 0;
}

// What one timesheet line pays.
export function entryAmount(e: HourlyEntry, defaultRate: number): number {
  return round2((e.hours || 0) * entryRate(e, defaultRate));
}

// True when any line is priced off the period default — drives whether the UI
// and the pay stub bother showing a per-line Rate column.
export function hasCustomRates(entries: HourlyEntry[], defaultRate: number): boolean {
  return normalizeEntries(entries).some((e) => entryRate(e, defaultRate) !== (defaultRate || 0));
}

// Drop rows that carry no information (no label AND no hours) — blank editor
// rows — while keeping deliberate zero-hour noted lines.
export function normalizeEntries(entries: HourlyEntry[]): HourlyEntry[] {
  return (entries ?? [])
    .filter((e) => (e.label ?? "").trim().length > 0 || (e.hours || 0) !== 0)
    .map((e) => ({
      date: e.date || null,
      label: (e.label ?? "").trim(),
      hours: round2(e.hours || 0),
      rate: e.rate != null && Number.isFinite(e.rate) && e.rate >= 0 ? round2(e.rate) : null,
    }));
}

export function hoursTotal(entries: HourlyEntry[]): number {
  return round2(entries.reduce((t, e) => t + (e.hours || 0), 0));
}

// Labor pay: every line at its own rate (falling back to the period default).
// The SUM is rounded once, so a sheet with no per-line overrides reproduces the
// old `hours × rate` number to the penny.
export function laborTotal(entries: HourlyEntry[], defaultRate: number): number {
  return round2(
    normalizeEntries(entries).reduce((t, e) => t + (e.hours || 0) * entryRate(e, defaultRate), 0),
  );
}

// Parse a timesheet-lines jsonb (staff_pay_builds.entries, payout_builds.hour_items)
// defensively (same posture as the other jsonb readers: garbage collapses to safe
// defaults, never throws).
export function parseEntries(raw: unknown): HourlyEntry[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      date: typeof o.date === "string" && o.date ? o.date.slice(0, 10) : null,
      label: o.label != null ? String(o.label) : "",
      hours: Number(o.hours) || 0,
      // Absent on every timesheet saved before 2026-07-25 -> null -> default rate.
      rate: o.rate != null && Number.isFinite(Number(o.rate)) ? Number(o.rate) : null,
    };
  });
}
