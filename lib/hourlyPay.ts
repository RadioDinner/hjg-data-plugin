// HOURLY (timesheet) staff pay — pure math + the printable hourly pay stub.
// For staff who send time sheets rather than being paid by the CA-invoice
// engine: HJG sets a DEFAULT hourly rate, enters the period's hours (one row per
// timesheet line), and the total is Σ hours × rate + piece work + adjustment.
//
// PER-LINE RATE (2026-07-25): a timesheet line may carry its OWN rate, because
// some work is billed higher than the staff member's standing rate. `rate: null`
// on a line means "use the period's default rate", so existing saved timesheets
// read back unchanged.
//
// PIECE WORK (2026-07-25): flat per-unit pay lines (lib/pieceWork) — e.g. $25 per
// new mentee × 8 — add on top of the hours.
//
// No I/O (unit-tested in scripts/verify-metrics.ts); persistence lives in
// src/db.ts (staff_pay_profiles / staff_pay_builds, migrations 9970 + 9964) and
// the UI in src/components/HourlyPayView.tsx.

import { monthLabelLong, STUB_CSS } from "./payStub";
import { normalizePieces, pieceAmount, piecesTotal, type PieceEntry } from "./pieceWork";

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
  return round2(normalizeEntries(entries).reduce((t, e) => t + (e.hours || 0) * entryRate(e, defaultRate), 0));
}

// The logged payout: labor + piece work + the adjustment.
export function hourlyTotal(
  entries: HourlyEntry[],
  rate: number,
  adjustment = 0,
  pieces: PieceEntry[] = []
): number {
  return round2(laborTotal(entries, rate) + piecesTotal(pieces) + (adjustment || 0));
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
      // Absent on every timesheet saved before 2026-07-25 -> null -> default rate.
      rate: o.rate != null && Number.isFinite(Number(o.rate)) ? Number(o.rate) : null,
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
  rate: number; // the period's DEFAULT rate
  entries: HourlyEntry[];
  hours: number;
  mixedRates: boolean; // ≥1 line priced off the default -> show the Rate column
  base: number; // Σ hours × each line's rate
  pieces: PieceEntry[];
  piecesTotal: number;
  piecesQty: number;
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
  pieces?: PieceEntry[];
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
  const defaultRate = round2(input.rate || 0);
  const base = laborTotal(entries, defaultRate);
  const pieces = normalizePieces(input.pieces ?? []);
  const pTotal = piecesTotal(pieces);
  const adjustment = round2(input.adjustment || 0);
  return {
    staffName: input.staffName,
    ym: input.ym,
    monthLabel: monthLabelLong(input.ym),
    approved: input.status === "approved",
    unsavedChanges: !!input.unsavedChanges,
    rate: defaultRate,
    entries,
    hours,
    mixedRates: hasCustomRates(entries, defaultRate),
    base,
    pieces,
    piecesTotal: pTotal,
    piecesQty: pieces.reduce((t, p) => t + (p.qty || 0), 0),
    adjustment,
    adjustmentNote: input.adjustmentNote ?? null,
    total: round2(base + pTotal + adjustment),
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

  // A Rate column only appears when at least one line is priced off the default,
  // so an ordinary single-rate stub reads exactly as it always has.
  const rateCol = m.mixedRates;
  const cols = rateCol ? 5 : 4;
  const entryRows = m.entries
    .map((e) => {
      const r = entryRate(e, m.rate);
      const rateCell = rateCol
        ? `<td class="n">${usd(r)}/h${r !== m.rate ? ` <span class="tag tag--warn">custom</span>` : ""}</td>`
        : "";
      return `<tr><td class="l">${e.date ? fmtD(e.date) : "—"}</td><td class="l">${esc(e.label || "—")}</td><td class="n">${fmtH(e.hours)}</td>${rateCell}<td class="n">${usd(entryAmount(e, m.rate))}</td></tr>`;
    })
    .join("");

  const spacer = rateCol ? `<td class="n"></td>` : "";
  const pieceRows = m.pieces
    .map(
      (p) =>
        `<tr><td class="l">${p.date ? fmtD(p.date) : "—"}</td><td class="l">${esc(p.label || "—")} <span class="tag tag--good">piece work</span></td><td class="n">${round2(p.qty).toLocaleString("en-US", { maximumFractionDigits: 2 })} ×</td>${rateCol ? `<td class="n">${usd(p.unitRate)} ea</td>` : ""}<td class="n">${usd(pieceAmount(p))}</td></tr>`
    )
    .join("");
  const pieceHeadRow = m.pieces.length
    ? `<tr><td class="l" colspan="${cols}" style="font-weight:700;padding-top:12px">Piece work${rateCol ? "" : " (quantity × rate each)"}</td></tr>`
    : "";

  const adjRow =
    Math.abs(m.adjustment) >= 0.005
      ? `<tr><td class="l">—</td><td class="l">Adjustment${m.adjustmentNote ? ` — ${esc(m.adjustmentNote)}` : ""}</td><td class="n"></td>${spacer}<td class="n">${usd(m.adjustment)}</td></tr>`
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
      <div class="sub">${m.mixedRates ? `Default rate` : `Hourly rate`} ${usd(m.rate)}/h</div></div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="lab">Hours</div><div class="val">${fmtH(m.hours)}</div>
      <div class="sumrow" style="margin-top:4px"><span>${m.entries.length} timesheet line${m.entries.length === 1 ? "" : "s"}</span><span>${m.mixedRates ? `rates vary` : `× ${usd(m.rate)}/h`}</span></div></div>
    ${m.pieces.length ? `<div class="card"><div class="lab">Piece work</div><div class="val">${usd(m.piecesTotal)}</div>
      <div class="sumrow" style="margin-top:4px"><span>${m.pieces.length} item${m.pieces.length === 1 ? "" : "s"}</span><span>${round2(m.piecesQty).toLocaleString("en-US", { maximumFractionDigits: 2 })} unit${m.piecesQty === 1 ? "" : "s"}</span></div></div>` : ""}
    <div class="card card--hero"><div class="lab">Total payout</div><div class="val">${usd(m.total)}</div>
      ${m.pieces.length || Math.abs(m.adjustment) >= 0.005 ? `<div class="sumrow"><span>Hours</span><span>${usd(m.base)}</span></div>` : ""}${m.pieces.length ? `<div class="sumrow"><span>Piece work</span><span>${usd(m.piecesTotal)}</span></div>` : ""}${Math.abs(m.adjustment) >= 0.005 ? `<div class="sumrow"><span>Adjustment</span><span>${usd(m.adjustment)}</span></div>` : ""}</div>
  </div>

  <table>
    <thead><tr><th class="l">Date</th><th class="l">Work</th><th>Hours</th>${rateCol ? `<th>Rate</th>` : ""}<th>Amount</th></tr></thead>
    <tbody>${entryRows}${pieceHeadRow}${pieceRows}${adjRow}</tbody>
    <tfoot><tr><td class="l">TOTAL</td><td></td><td class="n">${fmtH(m.hours)}</td>${spacer}<td class="n">${usd(m.total)}</td></tr></tfoot>
  </table>

  ${m.notes ? `<div class="note"><strong>Note from HJG:</strong> ${esc(m.notes)}</div>` : ""}

  <div class="fine">
    Hours are taken from the time sheet you submitted for ${esc(m.monthLabel)}; the total is each line's hours × its rate${m.mixedRates ? " (some work is paid at a different rate — the Rate column shows which)" : ""}${m.pieces.length ? ", plus the piece-work items listed" : ""}${Math.abs(m.adjustment) >= 0.005 ? ", plus the adjustment shown" : ""}.
    Questions about any line? Reply to this statement and HJG will walk through it with you.
  </div>
</div></body></html>`;
}
