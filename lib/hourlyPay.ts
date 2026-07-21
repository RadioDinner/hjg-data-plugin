// HOURLY (timesheet) staff pay — pure math + the printable hourly pay stub.
// For staff who send time sheets rather than being paid by the CA-invoice
// engine: HJG sets an hourly rate, enters the period's hours (one row per
// timesheet line), an optional adjustment, and paystub notes; the total is
// hours × rate + adjustment. No I/O (unit-tested in scripts/verify-metrics.ts);
// persistence lives in src/db.ts (staff_pay_profiles / staff_pay_builds,
// migration 9970) and the UI in src/components/HourlyPayView.tsx.

import { monthLabelLong, STUB_CSS } from "./payStub";

const round2 = (n: number) => Math.round(n * 100) / 100;

// One timesheet line: an optional date, a free-text description, and hours.
export interface HourlyEntry {
  date: string | null; // 'YYYY-MM-DD' or null (a lump-sum line like "Admin work")
  label: string;
  hours: number;
}

// Drop rows that carry no information (no label AND no hours) — blank editor
// rows — while keeping deliberate zero-hour noted lines.
export function normalizeEntries(entries: HourlyEntry[]): HourlyEntry[] {
  return entries
    .filter((e) => (e.label ?? "").trim().length > 0 || (e.hours || 0) !== 0)
    .map((e) => ({ date: e.date || null, label: (e.label ?? "").trim(), hours: round2(e.hours || 0) }));
}

export function hoursTotal(entries: HourlyEntry[]): number {
  return round2(entries.reduce((t, e) => t + (e.hours || 0), 0));
}

// The logged payout: hours × rate, rounded to the cent, plus the adjustment.
export function hourlyTotal(entries: HourlyEntry[], rate: number, adjustment = 0): number {
  return round2(round2(hoursTotal(entries) * (rate || 0)) + (adjustment || 0));
}

// Parse the entries jsonb from staff_pay_builds defensively (same posture as
// the other jsonb readers: garbage collapses to safe defaults, never throws).
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
    };
  });
}

// --- Printable hourly pay stub ---------------------------------------------

export interface HourlyStubModel {
  staffName: string;
  ym: string;
  monthLabel: string;
  approved: boolean;
  unsavedChanges: boolean;
  rate: number;
  entries: HourlyEntry[];
  hours: number;
  base: number; // hours × rate
  adjustment: number;
  adjustmentNote: string | null;
  total: number;
  notes: string | null;
  generatedOn: string; // YYYY-MM-DD (caller supplies; keeps this pure)
}

export interface HourlyStubInput {
  staffName: string;
  ym: string;
  rate: number;
  entries: HourlyEntry[];
  adjustment?: number;
  adjustmentNote?: string | null;
  notes?: string | null;
  status: "draft" | "approved";
  unsavedChanges?: boolean;
  generatedOn: string;
}

export function buildHourlyStubModel(input: HourlyStubInput): HourlyStubModel {
  const entries = normalizeEntries(input.entries);
  const hours = hoursTotal(entries);
  const base = round2(hours * (input.rate || 0));
  const adjustment = round2(input.adjustment || 0);
  return {
    staffName: input.staffName,
    ym: input.ym,
    monthLabel: monthLabelLong(input.ym),
    approved: input.status === "approved",
    unsavedChanges: !!input.unsavedChanges,
    rate: round2(input.rate || 0),
    entries,
    hours,
    base,
    adjustment,
    adjustmentNote: input.adjustmentNote ?? null,
    total: round2(base + adjustment),
    notes: input.notes ?? null,
    generatedOn: input.generatedOn,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return m && d ? `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}-${y}` : ymd;
};
const fmtH = (n: number) => `${round2(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} h`;

// The printable hourly statement — same visual language as the mentor stub
// (shared STUB_CSS): a summary band, then the timesheet lines verbatim.
export function hourlyStubHtml(m: HourlyStubModel): string {
  const badge = m.approved
    ? `<span class="badge badge--ok">APPROVED PAY STUB</span>`
    : `<span class="badge badge--draft">REVIEW COPY — DRAFT</span>`;
  const unsaved = m.unsavedChanges ? `<span class="badge badge--draft" style="margin-left:6px">UNSAVED CHANGES</span>` : "";
  const watermark = m.approved ? "" : `<div class="watermark">REVIEW<br/>COPY</div>`;

  const entryRows = m.entries
    .map(
      (e) =>
        `<tr><td class="l">${e.date ? fmtD(e.date) : "—"}</td><td class="l">${esc(e.label || "—")}</td><td class="n">${fmtH(e.hours)}</td><td class="n">${usd(round2(e.hours * m.rate))}</td></tr>`
    )
    .join("");

  const adjRow =
    Math.abs(m.adjustment) >= 0.005
      ? `<tr><td class="l">—</td><td class="l">Adjustment${m.adjustmentNote ? ` — ${esc(m.adjustmentNote)}` : ""}</td><td class="n"></td><td class="n">${usd(m.adjustment)}</td></tr>`
      : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(m.staffName)} — ${esc(m.monthLabel)} pay stub</title>
<style>${STUB_CSS}</style></head>
<body>${watermark}<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div>
      <div class="kicker">Staff payment statement</div>
      <h1>${esc(m.monthLabel)}</h1>
      <div class="sub">Prepared by HJG · generated ${fmtD(m.generatedOn)}</div>
    </div>
    <div style="text-align:right">
      ${badge}${unsaved}
      <div style="margin-top:10px"><div class="kicker">Paid to</div>
      <div style="font-size:20px">${esc(m.staffName)}</div>
      <div class="sub">Hourly rate ${usd(m.rate)}/h</div></div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="lab">Hours</div><div class="val">${fmtH(m.hours)}</div>
      <div class="sumrow" style="margin-top:4px"><span>${m.entries.length} timesheet line${m.entries.length === 1 ? "" : "s"}</span><span>× ${usd(m.rate)}/h</span></div></div>
    <div class="card card--hero"><div class="lab">Total payout</div><div class="val">${usd(m.total)}</div>
      ${Math.abs(m.adjustment) >= 0.005 ? `<div class="sumrow"><span>Hours × rate</span><span>${usd(m.base)}</span></div><div class="sumrow"><span>Adjustment</span><span>${usd(m.adjustment)}</span></div>` : ""}</div>
  </div>

  <table>
    <thead><tr><th class="l">Date</th><th class="l">Work</th><th>Hours</th><th>Amount</th></tr></thead>
    <tbody>${entryRows}${adjRow}</tbody>
    <tfoot><tr><td class="l">TOTAL</td><td></td><td class="n">${fmtH(m.hours)}</td><td class="n">${usd(m.total)}</td></tr></tfoot>
  </table>

  ${m.notes ? `<div class="note"><strong>Note from HJG:</strong> ${esc(m.notes)}</div>` : ""}

  <div class="fine">
    Hours are taken from the time sheet you submitted for ${esc(m.monthLabel)}; the total is hours × your hourly rate${Math.abs(m.adjustment) >= 0.005 ? " plus the adjustment shown" : ""}.
    Questions about any line? Reply to this statement and HJG will walk through it with you.
  </div>
</div></body></html>`;
}
