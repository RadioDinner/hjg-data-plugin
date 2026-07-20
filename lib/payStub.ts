// Printable mentor PAY STUB — a one-page summary plus a per-invoice breakdown,
// generated from a Build-payout review (draft => "REVIEW COPY", approved =>
// "PAY STUB"). Sent to mentors, so the language is plain and every HJG review
// decision is visible: a credit kept OUT of the basis reads "reviewed — does NOT
// reduce your pay", a swept-out charge reads "not mentoring revenue", an override
// shows both numbers. Transparency is the whole point (Harry's 2026-07 email).
//
// Two pure layers, no I/O (unit-tested in scripts/verify-metrics.ts §13d):
//   buildPayStubModel — review state + engine lines -> a display model
//   payStubHtml       — model -> a self-contained printable HTML document
// The Build-payout screen opens the HTML in a new window and calls print().

import type { PayMenteeLine, PayLineSource } from "./pay";
import {
  DEFAULT_LINE_STATE,
  effectiveLineTotal,
  excludedInvoiceSet,
  lineItemCounts,
  lineItemsSplittable,
  payLineSourceKey,
  sourceIsClassified,
  sourceRecognizedAfterExclusions,
  sourceIncludedBilled,
  type BuildLineState,
  type BuildStatus,
} from "./payBuild";

const round2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabelLong(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : ym;
}
function prevYmOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const o = y * 12 + (m - 1) - 1;
  return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
}

// How one billed line item ended up, in mentor-facing terms.
export type StubItemDisposition =
  | "counted" // pay-eligible, in the basis
  | "credit-counted" // credit, reduces the basis
  | "credit-out" // credit the reviewer kept OUT — does not reduce pay
  | "not-pay" // not mentoring revenue — never part of mentor pay
  | "opted-in" // non-matching charge the reviewer included by hand
  | "removed-by-review"; // eligible charge the reviewer removed

export interface StubItem {
  label: string;
  amount: number;
  disposition: StubItemDisposition;
}

export interface StubInvoice {
  invoiceNumber: string;
  serviceDate: string; // YYYY-MM-DD
  slice: "this-month" | "rollover";
  billed: number;
  counts: number; // effective basis after review
  recognized: number; // effective slice into this payout month (rounded)
  fractionLabel: string; // e.g. "20/30 remaining" or "10/30 rolled in"
  wholeExcluded: boolean;
  items: StubItem[];
}

export interface StubMenteeRow {
  name: string;
  tier: string;
  thisMonth: number; // effective this-month slice total
  rolledIn: number; // effective rolled-in total
  earned: number;
  payout: number; // effective (0 when excluded; override when set)
  excluded: boolean; // whole line dropped by review
  overridden: boolean;
  adjusted: boolean; // any review change or judgment credit on this line
  note: string | null;
  invoices: StubInvoice[];
  enginePayout: number;
}

export interface PayStubModel {
  coachName: string;
  ym: string;
  monthLabel: string;
  prevMonthLabel: string;
  approved: boolean;
  unsavedChanges: boolean;
  splitPct: number;
  generatedOn: string; // YYYY-MM-DD (caller supplies; keeps this pure)
  reviewedAt: string | null;
  monthNote: string | null;
  rows: StubMenteeRow[];
  totals: {
    earned: number;
    payout: number; // the number on the check
    enginePayout: number; // before review adjustments
    delta: number;
    menteeCount: number; // included lines
    adjustedCount: number;
  };
}

export interface PayStubInput {
  coachName: string;
  ym: string;
  splitPct: number;
  status: BuildStatus;
  unsavedChanges?: boolean;
  lines: PayMenteeLine[];
  states: Map<number, BuildLineState>;
  monthNote?: string | null;
  reviewedAt?: string | null;
  generatedOn: string; // YYYY-MM-DD
}

function dispositionOf(src: PayLineSource, index: number, state: BuildLineState): StubItemDisposition {
  const li = src.lineItems[index];
  const counts = !excludedInvoiceSet(state).has(payLineSourceKey(src)) && lineItemCounts(src, index, state);
  if (sourceIsClassified(src)) {
    if (li.status === "credit") return counts ? "credit-counted" : "credit-out";
    if (li.status === "excluded") return counts ? "opted-in" : "not-pay";
    return counts ? "counted" : "removed-by-review";
  }
  // Legacy sources: per-line review only exists when splittable; otherwise all count.
  const legacyCounts = lineItemsSplittable(src) ? counts : !excludedInvoiceSet(state).has(payLineSourceKey(src));
  if ((li.amount || 0) < 0) return legacyCounts ? "credit-counted" : "credit-out";
  return legacyCounts ? "counted" : "removed-by-review";
}

export function buildPayStubModel(input: PayStubInput): PayStubModel {
  const rows: StubMenteeRow[] = input.lines.map((l) => {
    const s = input.states.get(l.clientId) ?? DEFAULT_LINE_STATE;
    const payout = effectiveLineTotal(l, s);
    const excluded = !s.included;
    const overridden = s.included && s.override != null;
    let thisMonth = 0;
    let rolledIn = 0;
    const invoices: StubInvoice[] = l.sources.map((src) => {
      const counts = round2(sourceIncludedBilled(src, s));
      const recognized = round2(sourceRecognizedAfterExclusions(src, s));
      if (src.slice === "this-month") thisMonth += recognized;
      else rolledIn += recognized;
      const dayPart = Math.round(src.elapsedFraction * 30);
      return {
        invoiceNumber: src.invoiceNumber ?? "—",
        serviceDate: src.serviceDate,
        slice: src.slice,
        billed: round2(src.billed),
        counts,
        recognized,
        fractionLabel: src.slice === "this-month" ? `${30 - dayPart}/30 remaining` : `${dayPart}/30 rolled in`,
        wholeExcluded: excludedInvoiceSet(s).has(payLineSourceKey(src)),
        items: src.lineItems.map((li, i) => ({
          label: li.item ?? "—",
          amount: round2(li.amount || 0),
          disposition: dispositionOf(src, i, s),
        })),
      };
    });
    const adjusted =
      excluded ||
      overridden ||
      (s.excludedInvoices?.length ?? 0) + (s.excludedLineItems?.length ?? 0) + (s.includedLineItems?.length ?? 0) > 0 ||
      invoices.some((inv) => inv.items.some((it) => it.disposition === "credit-out" || it.disposition === "opted-in"));
    return {
      name: l.clientName,
      tier: l.tier,
      thisMonth: round2(thisMonth),
      rolledIn: round2(rolledIn),
      earned: round2(thisMonth + rolledIn),
      payout,
      excluded,
      overridden,
      adjusted,
      note: s.note ?? null,
      invoices,
      enginePayout: round2(l.payout),
    };
  });
  rows.sort((a, b) => b.payout - a.payout || a.name.localeCompare(b.name));
  const included = rows.filter((r) => !r.excluded);
  const payout = round2(rows.reduce((t, r) => t + r.payout, 0));
  const enginePayout = round2(rows.reduce((t, r) => t + r.enginePayout, 0));
  return {
    coachName: input.coachName,
    ym: input.ym,
    monthLabel: monthLabelLong(input.ym),
    prevMonthLabel: monthLabelLong(prevYmOf(input.ym)),
    approved: input.status === "approved",
    unsavedChanges: !!input.unsavedChanges,
    splitPct: input.splitPct,
    generatedOn: input.generatedOn,
    reviewedAt: input.reviewedAt ?? null,
    monthNote: input.monthNote ?? null,
    rows,
    totals: {
      earned: round2(included.reduce((t, r) => t + r.earned, 0)),
      payout,
      enginePayout,
      delta: round2(payout - enginePayout),
      menteeCount: included.length,
      adjustedCount: rows.filter((r) => r.adjusted).length,
    },
  };
}

// ---------------------------------------------------------------------------
// HTML rendering — a fully self-contained printable document (inline CSS, no
// external assets), styled after HJG's statement look: olive + cream, serif
// display. One summary page, then the per-mentee breakdown.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return m && d ? `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}-${y}` : ymd;
};

const DISPO_TEXT: Record<StubItemDisposition, { label: string; cls: string }> = {
  counted: { label: "counted", cls: "ok" },
  "credit-counted": { label: "credit — reduces the pay basis", cls: "warn" },
  "credit-out": { label: "credit reviewed by HJG — does NOT reduce your pay", cls: "good" },
  "not-pay": { label: "not mentoring revenue — not part of mentor pay", cls: "mut" },
  "opted-in": { label: "included by HJG review", cls: "good" },
  "removed-by-review": { label: "removed by HJG review", cls: "warn" },
};

export function payStubHtml(m: PayStubModel): string {
  const badge = m.approved
    ? `<span class="badge badge--ok">APPROVED PAY STUB</span>`
    : `<span class="badge badge--draft">REVIEW COPY — DRAFT</span>`;
  const unsaved = m.unsavedChanges ? `<span class="badge badge--draft" style="margin-left:6px">UNSAVED CHANGES</span>` : "";
  const watermark = m.approved ? "" : `<div class="watermark">REVIEW<br/>COPY</div>`;
  const pct = `${Math.round(m.splitPct * 100)}%`;

  const summaryRows = m.rows
    .map((r) => {
      const cls = r.excluded ? ' class="row-x"' : "";
      const tag = r.excluded
        ? ' <span class="tag tag--warn">excluded</span>'
        : (r.overridden ? ' <span class="tag tag--warn">adjusted by HJG</span>' : "") +
          (!r.overridden && r.adjusted ? ' <span class="tag tag--good">reviewed ✓</span>' : "");
      return `<tr${cls}><td class="l">${esc(r.name)}${tag}</td><td>${esc(r.tier)}</td><td class="n">${usd(r.thisMonth)}</td><td class="n">${usd(r.rolledIn)}</td><td class="n">${usd(r.earned)}</td><td class="n b">${usd(r.payout)}</td></tr>`;
    })
    .join("");

  const breakdown = m.rows
    .map((r) => {
      const invRows = r.invoices
        .map((inv) => {
          const items = inv.items
            .map((it) => {
              const d = DISPO_TEXT[it.disposition];
              return `<div class="item item--${d.cls}"><span class="item__amt">${usd(it.amount)}</span> ${esc(it.label)} <span class="item__tag item__tag--${d.cls}">${d.label}</span></div>`;
            })
            .join("");
          const sliceTag =
            inv.slice === "this-month"
              ? `${m.monthLabel} invoice · ${inv.fractionLabel}`
              : `${m.prevMonthLabel} invoice · ${inv.fractionLabel}`;
          const excludedTag = inv.wholeExcluded ? ` <span class="item__tag item__tag--warn">invoice excluded by HJG review</span>` : "";
          const countsCell = inv.counts !== inv.billed ? `${usd(inv.counts)} <span class="was">(billed ${usd(inv.billed)})</span>` : usd(inv.billed);
          return `<div class="inv${inv.wholeExcluded ? " inv--x" : ""}">
            <div class="inv__head"><strong>Invoice #${esc(inv.invoiceNumber)}</strong> · ${fmtD(inv.serviceDate)} · <span class="mut">${sliceTag}</span>${excludedTag}
              <span class="inv__nums">counts <strong>${countsCell}</strong> → <strong>${usd(inv.recognized)}</strong> into ${m.monthLabel}</span></div>
            ${items}
          </div>`;
        })
        .join("");
      const overrideNote = r.overridden
        ? `<div class="callout">HJG set this payout to <strong>${usd(r.payout)}</strong> (calculated ${usd(r.enginePayout)}).${r.note ? ` Reason: ${esc(r.note)}` : ""}</div>`
        : r.note
          ? `<div class="callout">Review note: ${esc(r.note)}</div>`
          : "";
      const excludedNote = r.excluded ? `<div class="callout">This mentee was excluded from this payout by HJG review.${r.note ? ` Reason: ${esc(r.note)}` : ""}</div>` : "";
      return `<section class="mentee">
        <div class="mentee__head"><h3>${esc(r.name)} <span class="mut">· ${esc(r.tier)}</span></h3>
        <div class="mentee__math">${usd(r.thisMonth)} this month + ${usd(r.rolledIn)} rolled in = <strong>${usd(r.earned)}</strong> × ${pct} = <strong>${usd(r.payout)}</strong></div></div>
        ${excludedNote}${overrideNote}${invRows}
      </section>`;
    })
    .join("");

  const delta = m.totals.delta;
  const deltaRow =
    Math.abs(delta) >= 0.005
      ? `<div class="sumrow"><span>Calculated before HJG review</span><span>${usd(m.totals.enginePayout)}</span></div>
         <div class="sumrow"><span>Review adjustments</span><span>${delta > 0 ? "+" : "−"}${usd(Math.abs(delta)).slice(1)}</span></div>`
      : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(m.coachName)} — ${esc(m.monthLabel)} pay stub</title>
<style>
  :root { --olive:#77855c; --olive-dk:#5c6a45; --cream:#f7f3e8; --ink:#2f3226; --mut:#7a7d6f; --line:#dcd7c4; --good:#3c7a44; --warn:#a8722a; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; background:var(--cream); color:var(--ink); font-size:13px; }
  .page { max-width: 7.6in; margin: 0 auto; padding: 28px 34px; position:relative; }
  .watermark { position:fixed; top:38%; left:50%; transform:translate(-50%,-50%) rotate(-28deg); font-size:110px; font-weight:700; color:rgba(168,114,42,.10); letter-spacing:8px; text-align:center; line-height:1.05; pointer-events:none; z-index:0; }
  .topbar { height:10px; background:var(--olive); margin:-28px -34px 22px; }
  .kicker { font-size:10px; letter-spacing:2.5px; color:var(--olive-dk); font-weight:700; text-transform:uppercase; }
  h1 { font-size:34px; font-weight:400; margin:2px 0 0; }
  .sub { color:var(--mut); font-size:12px; margin-top:2px; }
  .badge { display:inline-block; font-family:Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:1px; padding:4px 10px; border-radius:3px; }
  .badge--ok { background:#e5eede; color:var(--good); border:1px solid #b9cba8; }
  .badge--draft { background:#f5e8d2; color:var(--warn); border:1px solid #dcc294; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
  .cards { display:flex; gap:14px; margin:18px 0 20px; }
  .card { border:1px solid var(--line); background:#fbf9f1; border-radius:6px; padding:12px 16px; flex:1; }
  .card .lab { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--mut); font-weight:700; }
  .card .val { font-size:22px; margin-top:4px; }
  .card--hero { background:var(--olive); color:#fff; border-color:var(--olive-dk); }
  .card--hero .lab { color:#e8ecdd; }
  .card--hero .val { font-size:26px; font-weight:700; }
  .card--hero .sumrow { color:#e8ecdd; }
  .sumrow { display:flex; justify-content:space-between; font-size:12px; color:var(--mut); padding:2px 2px; }
  table { width:100%; border-collapse:collapse; margin-top:6px; background:#fff; }
  th { background:var(--olive); color:#fff; font-family:Arial,sans-serif; font-size:10px; letter-spacing:1px; text-transform:uppercase; padding:7px 9px; text-align:right; }
  th.l, td.l { text-align:left; }
  td { padding:7px 9px; border-bottom:1px solid var(--line); text-align:right; font-size:12.5px; }
  td.n { font-variant-numeric: tabular-nums; }
  td.b { font-weight:700; }
  tr:nth-child(even) td { background:#faf8ef; }
  .row-x td { color:var(--mut); text-decoration:line-through; }
  tfoot td { background:#eef0e3 !important; font-weight:700; border-top:2px solid var(--olive); }
  .tag { font-family:Arial,sans-serif; font-size:9px; font-weight:700; letter-spacing:.5px; padding:1px 6px; border-radius:8px; vertical-align:1px; }
  .tag--good { background:#e5eede; color:var(--good); }
  .tag--warn { background:#f5e8d2; color:var(--warn); }
  .note { border-left:3px solid var(--olive); background:#fbf9f1; padding:8px 12px; margin-top:14px; font-size:12px; }
  .fine { color:var(--mut); font-size:10.5px; margin-top:16px; line-height:1.5; border-top:1px solid var(--line); padding-top:10px; }
  .break { page-break-before: always; }
  h2 { font-size:16px; font-weight:700; letter-spacing:.5px; margin:4px 0 10px; }
  .mentee { border:1px solid var(--line); border-radius:6px; background:#fff; padding:12px 14px; margin-bottom:12px; page-break-inside:avoid; }
  .mentee__head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:6px; margin-bottom:8px; }
  .mentee h3 { font-size:14.5px; }
  .mentee__math { font-size:11.5px; color:var(--mut); }
  .inv { padding:6px 0 4px; border-bottom:1px dashed var(--line); }
  .inv:last-child { border-bottom:none; }
  .inv--x { opacity:.62; }
  .inv__head { font-size:12px; margin-bottom:3px; }
  .inv__nums { float:right; font-size:11.5px; }
  .item { font-size:11.5px; padding:1px 0 1px 16px; color:var(--ink); }
  .item__amt { display:inline-block; min-width:64px; font-variant-numeric:tabular-nums; }
  .item__tag { font-family:Arial,sans-serif; font-size:9px; font-weight:700; padding:1px 6px; border-radius:8px; margin-left:6px; }
  .item__tag--ok { background:#eef0e3; color:var(--olive-dk); }
  .item__tag--good { background:#e5eede; color:var(--good); }
  .item__tag--warn { background:#f5e8d2; color:var(--warn); }
  .item__tag--mut { background:#ececec; color:#777; }
  .item--mut, .item--warn.item--x { color:var(--mut); }
  .was { color:var(--mut); font-weight:400; font-size:10.5px; }
  .callout { border-left:3px solid var(--warn); background:#fdf7ec; padding:6px 10px; margin:6px 0; font-size:11.5px; }
  .mut { color:var(--mut); }
  @media print {
    body { background:#fff; }
    .page { max-width:none; padding:0.35in 0.5in; }
    .topbar { margin:-0.35in -0.5in 18px; }
    .noprint { display:none; }
  }
</style></head>
<body>${watermark}<div class="page">
  <div class="topbar"></div>
  <div class="head">
    <div>
      <div class="kicker">Mentor payment statement</div>
      <h1>${esc(m.monthLabel)}</h1>
      <div class="sub">Prepared by HJG · generated ${fmtD(m.generatedOn)}${m.reviewedAt ? ` · reviewed ${fmtD(m.reviewedAt.slice(0, 10))}` : ""}</div>
    </div>
    <div style="text-align:right">
      ${badge}${unsaved}
      <div style="margin-top:10px"><div class="kicker">Paid to</div>
      <div style="font-size:20px">${esc(m.coachName)}</div>
      <div class="sub">Payout rate ${pct}</div></div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="lab">Eligible revenue</div><div class="val">${usd(m.totals.earned)}</div>
      <div class="sumrow" style="margin-top:4px"><span>${m.totals.menteeCount} mentee${m.totals.menteeCount === 1 ? "" : "s"}</span><span>× ${pct}</span></div></div>
    <div class="card card--hero"><div class="lab">Total payout</div><div class="val">${usd(m.totals.payout)}</div>${deltaRow}</div>
    <div class="card"><div class="lab">HJG review</div><div class="val">${m.totals.adjustedCount || "—"}</div>
      <div class="sumrow" style="margin-top:4px"><span>${m.totals.adjustedCount === 1 ? "line reviewed / adjusted" : "lines reviewed / adjusted"}</span><span>see breakdown</span></div></div>
  </div>

  <table>
    <thead><tr><th class="l">Mentee</th><th>Plan</th><th>This month</th><th>Rolled in</th><th>Earned</th><th>Payout</th></tr></thead>
    <tbody>${summaryRows}</tbody>
    <tfoot><tr><td class="l">TOTAL</td><td></td><td class="n">${usd(round2(m.rows.filter((r) => !r.excluded).reduce((t, r) => t + r.thisMonth, 0)))}</td><td class="n">${usd(round2(m.rows.filter((r) => !r.excluded).reduce((t, r) => t + r.rolledIn, 0)))}</td><td class="n">${usd(m.totals.earned)}</td><td class="n">${usd(m.totals.payout)}</td></tr></tfoot>
  </table>

  ${m.monthNote ? `<div class="note"><strong>Note from HJG:</strong> ${esc(m.monthNote)}</div>` : ""}

  <div class="fine">
    <strong>How your pay is calculated.</strong> You earn ${pct} of the mentoring-subscription revenue billed to your mentees.
    Each invoice pays out across two months: the portion of the month remaining on its billing day counts in its own month,
    and the rest rolls into the next — so "${esc(m.monthLabel)}" blends ${esc(m.monthLabel)}'s new invoices with ${esc(m.prevMonthLabel)}'s
    rolled-in portion. Non-mentoring charges (JumpStart supervision, setup fees, training) are not part of mentor pay.
    The pages that follow show every invoice and every line item behind each number, including anything HJG adjusted in review.
  </div>

  <div class="break"></div>
  <h2>Breakdown — the invoices behind each number</h2>
  ${breakdown}
  <div class="fine">Questions about any line? Reply to this statement and HJG will walk through it with you.</div>
</div></body></html>`;
}
