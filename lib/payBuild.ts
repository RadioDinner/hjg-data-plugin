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
  // Per-INVOICE exclusions: source-keys (payLineSourceKey) of whole invoices the
  // reviewer dropped from THIS line's payout — used for invoices whose line items
  // can't drive a basis (none, or they don't reconcile to the total). Absent /
  // empty = every contributing invoice counts.
  excludedInvoices?: string[];
  // Per-LINE-ITEM exclusions: keys (payLineItemKey = `${sourceKey}#${index}`) of
  // individual line items the reviewer dropped — e.g. a JumpStart/JYF charge or a
  // duplicate that rides on an otherwise-mentoring invoice. The invoice's pay basis
  // becomes the sum of its surviving line items (see sourceIncludedBilled).
  excludedLineItems?: string[];
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
    !(s.excludedInvoices && s.excludedInvoices.length > 0) &&
    !(s.excludedLineItems && s.excludedLineItems.length > 0)
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

// A stable key for ONE line item within an invoice: the invoice's source-key plus
// the line item's index. Line items within an invoice aren't unique (e.g. two
// identical "MN Subscription ($425)" charges), so the index is what disambiguates.
export function payLineItemKey(src: PayLineSource, index: number): string {
  return `${payLineSourceKey(src)}#${index}`;
}

// The sets of invoice / line-item keys a reviewer has dropped from a line.
export function excludedInvoiceSet(state?: BuildLineState): Set<string> {
  return new Set(state?.excludedInvoices ?? []);
}
export function excludedLineItemSet(state?: BuildLineState): Set<string> {
  return new Set(state?.excludedLineItems ?? []);
}

// Whether an invoice's line items can drive a line-item-level pay basis: there is
// at least one line item and they sum to the invoice's billed amount (so dropping
// some of them leaves a meaningful remaining basis). When false — no line items,
// or they don't reconcile to the total — the invoice is only excludable whole.
export function lineItemsSplittable(src: PayLineSource): boolean {
  if (!src.lineItems || src.lineItems.length === 0) return false;
  const sum = src.lineItems.reduce((t, li) => t + (li.amount || 0), 0);
  return Math.abs(sum - src.billed) < 0.01;
}

// The billed amount of an invoice that still counts after the reviewer's drops:
//   • whole invoice excluded            -> 0
//   • splittable + some line items off  -> sum of the surviving line items
//   • otherwise                         -> the full billed amount
export function sourceIncludedBilled(src: PayLineSource, state?: BuildLineState): number {
  const s = state ?? DEFAULT_LINE_STATE;
  if (excludedInvoiceSet(s).has(payLineSourceKey(src))) return 0;
  const exclLI = excludedLineItemSet(s);
  if (!exclLI.size || !lineItemsSplittable(src)) return src.billed;
  const key = payLineSourceKey(src);
  let sum = 0;
  src.lineItems.forEach((li, i) => {
    if (!exclLI.has(`${key}#${i}`)) sum += li.amount || 0;
  });
  return sum;
}

// One invoice's recognized slice AFTER the reviewer's drops (UNROUNDED, to be
// summed then rounded). Recognized scales with the surviving billed basis at the
// invoice's own proration fraction (this-month = 1 − e, rollover = e), so dropping
// a line item removes exactly its prorated contribution. An unchanged basis returns
// the engine's stored recognized untouched (no rounding drift).
export function sourceRecognizedAfterExclusions(src: PayLineSource, state?: BuildLineState): number {
  const included = sourceIncludedBilled(src, state);
  if (Math.abs(included - src.billed) < 0.005) return src.recognized;
  const fraction = src.slice === "this-month" ? 1 - src.elapsedFraction : src.elapsedFraction;
  return included * fraction;
}

// A line's payout after the reviewer's per-invoice / per-line-item drops: recompute
// earned from the surviving slices, then re-apply the mentor split. Matches the
// engine's rounding (round the earned sum, then round earned × split), so an
// untouched line reproduces the engine number to the penny. With no drops (or no
// sources/split to recompute from) this IS the engine payout.
export function payoutAfterExclusions(
  line: { payout: number; splitPct?: number; sources?: PayLineSource[] },
  state?: BuildLineState
): number {
  const s = state ?? DEFAULT_LINE_STATE;
  if (!line.sources || line.splitPct == null) return round2(line.payout);
  if (!excludedInvoiceSet(s).size && !excludedLineItemSet(s).size) return round2(line.payout);
  const rawEarned = line.sources.reduce((t, src) => t + sourceRecognizedAfterExclusions(src, s), 0);
  return round2(round2(rawEarned) * line.splitPct);
}

// The final signed-off payout for a line, honoring EVERY review decision in
// precedence order:
//   1. line-level exclusion (`included: false`) -> 0
//   2. a manual dollar override -> that number wins (the reviewer's explicit value)
//   3. otherwise the engine payout minus any dropped invoices / line items.
// `sources` + `splitPct` are only consulted for path 3, so a bare {payout} still
// works for callers that don't do invoice-level review.
export function effectiveLineTotal(
  line: { payout: number; splitPct?: number; sources?: PayLineSource[] },
  state?: BuildLineState
): number {
  const s = state ?? DEFAULT_LINE_STATE;
  if (!s.included) return 0;
  if (s.override != null) return round2(s.override);
  return payoutAfterExclusions(line, s);
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
function joinLineItems(src: PayLineSource, exclLI?: ReadonlySet<string>): string {
  const splittable = exclLI && exclLI.size ? lineItemsSplittable(src) : false;
  const key = payLineSourceKey(src);
  return src.lineItems
    .map((li, i) => {
      const off = splittable && exclLI!.has(`${key}#${i}`);
      return `${li.item ?? "—"} ($${round2(li.amount)})${off ? " [dropped]" : ""}`;
    })
    .join("; ");
}

// One CSV row per contributing invoice. Mentee-level columns (Split, Engine/
// Effective payout, Included, Override, Note) are written only on that mentee's
// FIRST invoice row and left blank on the rest, so summing a payout column never
// double-counts a mentee across their several invoices. The per-invoice "Invoice
// incl." column reads yes / no / partial (a partially-included invoice has some
// line items dropped — those are tagged " [dropped]" in the Line items cell), so
// the "Effective payout" reduction is auditable down to the line item; the
// mentee-level "Included" column is the whole-line decision. "Recognized into
// month" is the EFFECTIVE (post-drop) slice, so up to per-cell rounding the rows
// sum (per mentee) to that line's effective earned.
export function payoutDetailCsvRows(
  lines: BuildDetailLine[],
  states: Map<number, BuildLineState>
): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const l of lines) {
    const s = states.get(l.clientId) ?? DEFAULT_LINE_STATE;
    const exclLI = excludedLineItemSet(s);
    const eff = effectiveLineTotal(l, s); // honors invoice/line-item drops + override + line exclusion
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
      const incBilled = sourceIncludedBilled(src, s);
      const inclFlag = incBilled <= 0.005 ? "no" : Math.abs(incBilled - src.billed) < 0.005 ? "yes" : "partial";
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
        round2(sourceRecognizedAfterExclusions(src, s)),
        joinPaymentDates(src),
        joinPaymentAmounts(src),
        joinPaymentMethods(src),
        joinLineItems(src, exclLI),
        inclFlag,
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
      else if ((s.excludedInvoices?.length ?? 0) + (s.excludedLineItems?.length ?? 0) > 0) invoiceAdjustedCount++;
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
