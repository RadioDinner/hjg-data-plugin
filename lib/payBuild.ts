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

import type { PayLineSource } from "./pay";

// Per-line review decision, keyed by clientId within a build. A line with no
// stored state is treated as DEFAULT_LINE_STATE (included, no override, no note).
export interface BuildLineState {
  included: boolean; // counted toward the built total
  override: number | null; // reviewer-set payout; null = use the engine's number
  note: string | null; // why this line was changed/dropped
  // Per-INVOICE exclusions: source-keys (payLineSourceKey) of invoices the
  // reviewer dropped from THIS line's payout — e.g. a JumpStart/JYF charge that
  // rides on the same mentee's month but shouldn't count toward mentor pay. The
  // line's payout recomputes from the surviving invoices (see effectiveLineTotal).
  // Absent / empty = every contributing invoice counts (the engine's number).
  excludedInvoices?: string[];
}

export const DEFAULT_LINE_STATE: BuildLineState = { included: true, override: null, note: null };

// Minimal shape a reviewable line must expose. PayMenteeLine / PayLedgerRow
// satisfy it, so the engine's output drops straight in. `splitPct` + `sources`
// are optional and only needed for per-invoice exclusions; a bare {clientId,
// payout} still works for callers that don't offer invoice-level review.
export interface BuildLineInput {
  clientId: number;
  payout: number; // engine-computed payout for this line (all invoices)
  splitPct?: number; // mentor revenue share — re-applied after invoice exclusions
  sources?: PayLineSource[]; // contributing invoice slices — enables per-invoice exclusions
}

export type BuildStatus = "draft" | "approved";

const round2 = (n: number) => Math.round(n * 100) / 100;

// A non-default state is one worth persisting (excluded, overridden, noted, or
// carrying per-invoice exclusions). Lets the store keep line_states compact —
// untouched lines aren't written.
export function isDefaultLineState(s: BuildLineState): boolean {
  return (
    s.included &&
    s.override == null &&
    (s.note == null || s.note === "") &&
    !(s.excludedInvoices && s.excludedInvoices.length > 0)
  );
}

// What a line actually contributes to the built total: 0 if excluded, else the
// override when set, else the engine's payout. This is the ENGINE-payout-only
// form (no invoice-level review); effectiveLineTotal layers invoice exclusions on.
export function effectiveLinePayout(enginePayout: number, state?: BuildLineState): number {
  const s = state ?? DEFAULT_LINE_STATE;
  if (!s.included) return 0;
  return round2(s.override != null ? s.override : enginePayout);
}

// A stable key identifying one invoice's slice within a line, for per-invoice
// exclusions. Prefers the CA invoice id (stable across re-syncs), then the human
// invoice number, then the service date as a last resort.
export function payLineSourceKey(src: PayLineSource): string {
  if (src.invoiceId != null) return `id:${src.invoiceId}`;
  if (src.invoiceNumber) return `no:${src.invoiceNumber}`;
  return `dt:${src.serviceDate}`;
}

// The set of invoice source-keys a reviewer has dropped from a line.
export function excludedInvoiceSet(state?: BuildLineState): Set<string> {
  return new Set(state?.excludedInvoices ?? []);
}

// A line's payout after dropping the reviewer-excluded invoices: recompute earned
// from the SURVIVING sources' recognized slices, then re-apply the mentor split.
// Matches the engine's rounding (round the earned sum, then round earned × split),
// so an unexcluded line reproduces the engine number to the penny. With no
// exclusions (or no sources/split to recompute from) this IS the engine payout.
export function payoutAfterInvoiceExclusions(
  line: { payout: number; splitPct?: number; sources?: PayLineSource[] },
  excluded: ReadonlySet<string>
): number {
  if (!excluded.size || !line.sources || line.splitPct == null) return round2(line.payout);
  let anyExcluded = false;
  const rawEarned = line.sources.reduce((t, src) => {
    if (excluded.has(payLineSourceKey(src))) {
      anyExcluded = true;
      return t;
    }
    return t + src.recognized;
  }, 0);
  if (!anyExcluded) return round2(line.payout); // excluded keys matched nothing here
  return round2(round2(rawEarned) * line.splitPct);
}

// The final signed-off payout for a line, honoring EVERY review decision in
// precedence order:
//   1. line-level exclusion (`included: false`) -> 0
//   2. a manual dollar override -> that number wins (the reviewer's explicit value)
//   3. otherwise the engine payout MINUS any per-invoice exclusions.
// `sources` + `splitPct` are only consulted for path 3, so a bare {payout} still
// works for callers that don't do invoice-level review.
export function effectiveLineTotal(
  line: { payout: number; splitPct?: number; sources?: PayLineSource[] },
  state?: BuildLineState
): number {
  const s = state ?? DEFAULT_LINE_STATE;
  if (!s.included) return 0;
  if (s.override != null) return round2(s.override);
  return payoutAfterInvoiceExclusions(line, excludedInvoiceSet(s));
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
  invoiceAdjustedCount: number; // included, un-overridden lines with ≥1 dropped invoice
}

// --- "Data used to build the payout" CSV -----------------------------------
// The Export CSV on the Build-payout screen (204) exports the INVOICES behind the
// payout, not just the on-screen per-mentee summary: one row per contributing
// invoice (the two-month split's this-month + rolled-in slices), with the dates
// each invoice was paid, plus the mentee-level review roll-up. Pure + reusable so
// the export and the drill-down modal read the same shape (verify §13).

// A reviewable payout line carrying its invoice sources. PayMenteeLine satisfies
// this structurally, so the engine's output drops straight in.
export interface BuildDetailLine {
  clientId: number;
  clientName: string;
  tier: string;
  splitPct: number;
  payout: number; // engine-computed payout for this line
  sources: PayLineSource[];
}

export const PAYOUT_DETAIL_CSV_COLUMNS = [
  "Mentee",
  "Client ID",
  "Tier",
  "Invoice #",
  "Invoice date",
  "Inv. day",
  "Service month",
  "Slice",
  "Billed (invoice)",
  "Collected (invoice)",
  "Elapsed (e)",
  "Recognized into month",
  "Payment dates",
  "Payment amounts",
  "Payment methods",
  "Line items",
  "Invoice incl.",
  "Split",
  "Engine payout",
  "Included",
  "Override",
  "Effective payout",
  "Note",
] as const;

// Join a source's payments/line-items into compact CSV cells (ISO dates kept raw,
// per the repo's "exports stay machine-sortable" convention).
function joinPaymentDates(src: PayLineSource): string {
  return src.payments.map((p) => p.datePaid ?? "").filter(Boolean).join("; ");
}
function joinPaymentAmounts(src: PayLineSource): string {
  return src.payments.map((p) => round2(p.amount)).join("; ");
}
function joinPaymentMethods(src: PayLineSource): string {
  return src.payments
    .map((p) => [p.method ?? "", p.checkNumber ? `#${p.checkNumber}` : ""].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
}
function joinLineItems(src: PayLineSource): string {
  return src.lineItems.map((li) => `${li.item ?? "—"} ($${round2(li.amount)})`).join("; ");
}

// One CSV row per contributing invoice. Mentee-level columns (Split, Engine/
// Effective payout, Included, Override, Note) are written only on that mentee's
// FIRST invoice row and left blank on the rest, so summing a payout column never
// double-counts a mentee across their several invoices. The per-invoice "Invoice
// incl." column flags any invoice the reviewer dropped (so the "Effective payout"
// reduction is auditable to the exact invoice); the mentee-level "Included"
// column is the whole-line decision. The per-invoice "Recognized into month"
// column keeps its RAW value even for a dropped invoice — up to per-cell rounding
// the surviving rows sum (per mentee) to that line's effective earned.
export function payoutDetailCsvRows(
  lines: BuildDetailLine[],
  states: Map<number, BuildLineState>
): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const l of lines) {
    const s = states.get(l.clientId) ?? DEFAULT_LINE_STATE;
    const excluded = excludedInvoiceSet(s);
    const eff = effectiveLineTotal(l, s); // honors per-invoice exclusions + override + line exclusion
    const split = `${Math.round(l.splitPct * 100)}%`;
    const menteeCols = (first: boolean): (string | number)[] => [
      first ? split : "",
      first ? round2(l.payout) : "",
      first ? (s.included ? "yes" : "no") : "",
      first && s.override != null ? s.override : "",
      first ? eff : "",
      first ? s.note ?? "" : "",
    ];
    // A line always has ≥1 source once it's a paid line; guard anyway so a
    // rollover-only line with missing invoice metadata still emits one row.
    const srcs: (PayLineSource | null)[] = l.sources.length ? l.sources : [null];
    srcs.forEach((src, i) => {
      const first = i === 0;
      if (src == null) {
        rows.push([l.clientName, l.clientId, l.tier, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ...menteeCols(first)]);
        return;
      }
      rows.push([
        l.clientName,
        l.clientId,
        l.tier,
        src.invoiceNumber ?? "",
        src.serviceDate,
        src.invoiceDay,
        src.serviceMonth,
        src.slice,
        round2(src.billed),
        round2(src.collected),
        round2(src.elapsedFraction),
        round2(src.recognized),
        joinPaymentDates(src),
        joinPaymentAmounts(src),
        joinPaymentMethods(src),
        joinLineItems(src),
        excluded.has(payLineSourceKey(src)) ? "no" : "yes",
        ...menteeCols(first),
      ]);
    });
  }
  return rows;
}

export function summarizeBuild(lines: BuildLineInput[], states: Map<number, BuildLineState>): BuildSummary {
  let computedTotal = 0;
  let builtTotal = 0;
  let includedCount = 0;
  let excludedCount = 0;
  let overriddenCount = 0;
  let invoiceAdjustedCount = 0;
  for (const l of lines) {
    computedTotal += l.payout; // always the raw engine number — the drift reference
    const s = states.get(l.clientId) ?? DEFAULT_LINE_STATE;
    builtTotal += effectiveLineTotal(l, s); // honors invoice exclusions when sources are present
    if (s.included) {
      includedCount++;
      if (s.override != null) overriddenCount++;
      else if (s.excludedInvoices && s.excludedInvoices.length > 0) invoiceAdjustedCount++;
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
    invoiceAdjustedCount,
  };
}
