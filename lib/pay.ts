// Pure staff-payment (payroll) engine — the CLAYTON model (matched 2026-06-22 after
// the user reconstructed the legacy admin's method; see docs/legacy-pay-calculator.md).
// No I/O — the caller supplies already-fetched rows, so this is unit-testable
// (scripts/verify-metrics.ts §8/§9) and reusable from the browser.
//
// MODEL (decided with the user):
//  - Each invoice bills a mentee their tier price (e.g. $425 for 4x) for a service
//    month. The mentor earns a share of that BILLED amount (collected is carried for
//    reference only).
//  - PRORATION + TWO-MONTH SPLIT (the heart of Clayton's method). An invoice dated
//    on day D of its service month is split across TWO calendar months by where D
//    falls in the month:
//        elapsed   e        = D / 30            (FIXED 30-day month, per the user)
//        remaining (1 − e)
//      • the REMAINING fraction (1 − e) is recognized in the invoice's own month,
//      • the ELAPSED fraction (e) rolls forward into the NEXT calendar month.
//    So a payout month M sums: this month's invoice × (1 − e)  +  last month's
//    invoice × e_last. Each invoice's two slices add back to the full amount, so the
//    mentor is made whole across the two months with no separate catch-up.
//  - SHARE RAMPS with the MENTOR's tenure (NOT the mentee's): the mentor's 1st month
//    of work = 35%, 2nd = 50%, 3rd onward = 60%, applied to ALL their mentees. The
//    rate used for a payout month is the mentor's rate IN THAT MONTH (so everything
//    landing in a month — including a rolled-forward slice — is paid at that month's
//    rate; with the per-mentor ramp this only differs during a mentor's first two
//    months, which is why no per-mentee catch-up is needed).
//  - ATTRIBUTION (who gets credited/paid for a mentee's invoice):
//    • If `primaryCoachOf` is supplied and returns a coach for the mentee, that
//      coach (CoachAccountable's PRIMARY-coach pairing = the mentee's OWNER) is
//      credited — this is what the dashboard uses (decided with the user, session
//      009: owner = primary coach, everywhere incl. pay).
//    • Otherwise (no primary coach known yet — e.g. before a re-sync) it falls back
//      to the coach whose engagement covers the invoice date, then to the coach who
//      covered the most days that service month.
//    The TIER always comes from the engagement coverage regardless of who's credited.
//    Billed revenue with no coach at all (no owner, no engagement) is reported as
//    "unassigned" rather than silently dropped.

import { engagementTier } from "./config";

// Mentor revenue-share ramp by tenure month (1-indexed). Past the table it holds
// at the final value (60%).
export const PAY_RAMP = [0.35, 0.5, 0.6] as const;

export function splitForTenureMonth(tenureMonth: number): number {
  if (tenureMonth < 1) return PAY_RAMP[0];
  const i = Math.min(tenureMonth, PAY_RAMP.length) - 1;
  return PAY_RAMP[i];
}

// 'YYYY-MM' -> absolute month ordinal, for tenure + adjacency arithmetic.
export function monthOrdinal(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}
function ymFromOrdinal(o: number): string {
  const y = Math.floor(o / 12);
  const m = (o % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function nextYm(ym: string): string {
  return ymFromOrdinal(monthOrdinal(ym) + 1);
}
function prevYm(ym: string): string {
  return ymFromOrdinal(monthOrdinal(ym) - 1);
}

// 1-indexed tenure: the mentor's start month itself is tenure month 1.
export function tenureMonthsBetween(startYm: string, serviceYm: string): number {
  return monthOrdinal(serviceYm) - monthOrdinal(startYm) + 1;
}

// Actual calendar days in a month — used ONLY for the engagement-coverage day-walk
// (which coach served the mentee). The PRORATION denominator is a fixed 30 (below).
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Clayton's fixed 30-day proration denominator. Elapsed fraction of the month at
// the invoice's day-of-month, clamped to [0, 1] (a day past the 30th = fully elapsed).
export const PRORATION_DAYS = 30;
export function elapsedFraction(dayOfMonth: number): number {
  return Math.min(Math.max(dayOfMonth, 0), PRORATION_DAYS) / PRORATION_DAYS;
}

function ymOf(dateYmd: string): string {
  return dateYmd.slice(0, 7);
}
function dayOf(dateYmd: string): number {
  return Number(dateYmd.slice(8, 10)) || 1;
}

// --- engine inputs ---

export interface PayInvoiceInput {
  clientId: number;
  serviceDate: string; // 'YYYY-MM-DD' from the invoice date_of (the DAY drives proration)
  billed: number; // invoice `amount` — what was billed; the PAY BASIS
  collected: number; // amount_paid (collected so far) — reference only
}

export interface PayEngagementInput {
  clientId: number;
  coachId: number | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD, null = ongoing
  isCanceled: boolean;
  name: string | null; // engagement name (for the tier label)
}

export interface PayInputs {
  ym: string; // the payout month being computed, 'YYYY-MM'
  invoices: PayInvoiceInput[];
  engagements: PayEngagementInput[];
  coachName: (id: number) => string;
  clientName: (id: number) => string;
  // coachId -> 'YYYY-MM' override for when a mentor's tenure started (else
  // derived from their earliest engagement start).
  startMonthOverride?: Map<number, string>;
  // clientId -> the mentee's OWNER (CA primary coach). When present and non-null
  // this coach is credited for the invoice instead of the engagement-coverage coach.
  // Absent / null => fall back to engagement coverage (prior behavior).
  primaryCoachOf?: (clientId: number) => number | null;
}

// --- engine outputs ---

// One mentee's payout for one PAYOUT month under the Clayton split. The payout
// blends this month's invoice slice and last month's rolled-forward slice:
//   earned = recognizedThis (this invoice × (1−e)) + rolloverPrev (last invoice × e_prev)
//   payout = earned × splitPct   (mentor rate in this payout month)
export interface PayMenteeLine {
  clientId: number;
  clientName: string;
  coachId: number | null;
  billed: number; // invoice amount billed THIS payout month (0 if rollover-only); pay basis
  collected: number; // amount paid so far on this month's invoice (reference)
  invoiceDay: number | null; // day-of-month of this month's invoice date_of (null if none)
  recognizedThis: number; // billed × (1 − e) — recognized from this month's invoice
  rolloverPrev: number; // last month's invoice × e_prev — rolled into this month
  earned: number; // recognizedThis + rolloverPrev (revenue credited to this month)
  splitPct: number;
  payout: number; // earned × splitPct
  tier: string;
}

export interface PayMentorSummary {
  coachId: number;
  coachName: string;
  startMonth: string | null;
  tenureMonth: number | null;
  splitPct: number;
  menteeCount: number;
  billed: number;
  collected: number;
  earned: number;
  payout: number;
  lines: PayMenteeLine[];
}

export interface PayReport {
  ym: string;
  mentors: PayMentorSummary[];
  unassigned: PayMenteeLine[]; // billed revenue with no overlapping engagement
  totals: { billed: number; collected: number; earned: number; payout: number; mentorCount: number; menteeCount: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Which coach covered a client the most in a given month, and the tier in force.
// Day-walk over the ACTUAL calendar days (engagement coverage), independent of the
// fixed-30 proration. First matching engagement wins the day's coach/tier.
function coverInMonth(ym: string, engs: PayEngagementInput[]): { coachId: number | null; tier: string } {
  const dim = daysInMonth(ym);
  const monthEnd = `${ym}-${String(dim).padStart(2, "0")}`;
  const daysByCoach = new Map<number, number>();
  let tier = "other";
  for (let day = 1; day <= dim; day++) {
    const d = `${ym}-${String(day).padStart(2, "0")}`;
    let coverCoach: number | null = null;
    let coverTier: string | null = null;
    let covered = false;
    for (const e of engs) {
      const s = (e.startDate ?? "0000-01-01").slice(0, 10);
      const en = (e.endDate ?? "9999-12-31").slice(0, 10);
      if (d >= s && d <= en && d <= monthEnd) {
        covered = true;
        if (coverCoach == null && e.coachId != null) {
          coverCoach = e.coachId;
          coverTier = engagementTier(e.name);
        }
      }
    }
    if (covered) {
      if (coverCoach != null) daysByCoach.set(coverCoach, (daysByCoach.get(coverCoach) ?? 0) + 1);
      if (coverTier) tier = coverTier;
    }
  }
  let coachId: number | null = null;
  let best = 0;
  for (const [cid, n] of daysByCoach) {
    if (n > best) {
      best = n;
      coachId = cid;
    }
  }
  return { coachId, tier };
}

// Which coach/tier covers a client ON a specific date (the invoice's date_of).
// Among engagements spanning that date, the most-recently-STARTED one wins, so an
// end-of-month tier change credits the NEW invoice to the NEW coach instead of the
// outgoing one. Falls back to the month-majority coach (coverInMonth) only when no
// engagement covers the exact date, so invoices on uncovered days keep prior behavior.
function coverOnDate(dateYmd: string, engs: PayEngagementInput[]): { coachId: number | null; tier: string } {
  const d = dateYmd.slice(0, 10);
  let best: PayEngagementInput | null = null;
  for (const e of engs) {
    const s = (e.startDate ?? "0000-01-01").slice(0, 10);
    const en = (e.endDate ?? "9999-12-31").slice(0, 10);
    if (d >= s && d <= en && e.coachId != null) {
      if (!best || s > (best.startDate ?? "0000-01-01").slice(0, 10)) best = e;
    }
  }
  if (best) return { coachId: best.coachId, tier: engagementTier(best.name) };
  return coverInMonth(d.slice(0, 7), engs);
}

// Per-(coach, client) accumulator for a payout month.
interface LineAcc {
  coachId: number | null;
  tier: string;
  billed: number;
  collected: number;
  invoiceDay: number | null;
  recognizedThis: number;
  rolloverPrev: number;
}

export function computePayReport(input: PayInputs): PayReport {
  const { ym } = input;
  const prev = prevYm(ym);

  // Mentor tenure start = override, else the earliest engagement start month.
  const earliestStart = new Map<number, string>();
  for (const e of input.engagements) {
    if (e.coachId == null || !e.startDate) continue;
    const cur = earliestStart.get(e.coachId);
    if (!cur || e.startDate < cur) earliestStart.set(e.coachId, e.startDate);
  }
  const startMonthFor = (coachId: number): string | null => {
    const o = input.startMonthOverride?.get(coachId);
    if (o) return o;
    const s = earliestStart.get(coachId);
    return s ? ymOf(s) : null;
  };

  // Non-canceled engagements grouped by mentee (for coverage).
  const engByClient = new Map<number, PayEngagementInput[]>();
  for (const e of input.engagements) {
    if (e.isCanceled) continue;
    const arr = engByClient.get(e.clientId) ?? [];
    arr.push(e);
    engByClient.set(e.clientId, arr);
  }

  // Accumulate slices into (coach|client) lines: this-month invoices contribute the
  // remaining-fraction slice; prev-month invoices contribute the elapsed rollover.
  const acc = new Map<string, LineAcc & { clientId: number }>();
  const keyOf = (coachId: number | null, clientId: number) => `${coachId ?? "—"}|${clientId}`;
  const ensure = (coachId: number | null, clientId: number, tier: string): LineAcc & { clientId: number } => {
    const k = keyOf(coachId, clientId);
    let a = acc.get(k);
    if (!a) {
      a = { coachId, clientId, tier, billed: 0, collected: 0, invoiceDay: null, recognizedThis: 0, rolloverPrev: 0 };
      acc.set(k, a);
    }
    return a;
  };

  // The coach credited for this mentee's invoice: the OWNER (CA primary coach) when
  // known, else the engagement-coverage coach. The tier always comes from coverage.
  const creditFor = (clientId: number, cov: { coachId: number | null; tier: string }): number | null =>
    input.primaryCoachOf?.(clientId) ?? cov.coachId;

  for (const inv of input.invoices) {
    const invYm = ymOf(inv.serviceDate);
    const amt = inv.billed || 0;
    if (amt <= 0) continue;
    if (invYm === ym) {
      const cov = coverOnDate(inv.serviceDate, engByClient.get(inv.clientId) ?? []);
      const day = dayOf(inv.serviceDate);
      const recognized = amt * (1 - elapsedFraction(day));
      const a = ensure(creditFor(inv.clientId, cov), inv.clientId, cov.tier);
      a.billed += amt;
      a.collected += inv.collected || 0;
      a.recognizedThis += recognized;
      a.invoiceDay = a.invoiceDay == null ? day : Math.min(a.invoiceDay, day);
      if (a.tier === "other") a.tier = cov.tier;
    } else if (invYm === prev) {
      const cov = coverOnDate(inv.serviceDate, engByClient.get(inv.clientId) ?? []);
      const rollover = amt * elapsedFraction(dayOf(inv.serviceDate));
      const a = ensure(creditFor(inv.clientId, cov), inv.clientId, cov.tier);
      a.rolloverPrev += rollover;
      if (a.tier === "other") a.tier = cov.tier;
    }
  }

  const mentors = new Map<number, PayMentorSummary>();
  const unassigned: PayMenteeLine[] = [];

  for (const a of acc.values()) {
    const earned = round2(a.recognizedThis + a.rolloverPrev);
    const billed = round2(a.billed);
    if (earned <= 0 && billed <= 0) continue;
    const collected = round2(a.collected);
    const base: Omit<PayMenteeLine, "splitPct" | "payout"> = {
      clientId: a.clientId,
      clientName: input.clientName(a.clientId),
      coachId: a.coachId,
      billed,
      collected,
      invoiceDay: a.invoiceDay,
      recognizedThis: round2(a.recognizedThis),
      rolloverPrev: round2(a.rolloverPrev),
      earned,
      tier: a.tier,
    };

    if (a.coachId == null) {
      unassigned.push({ ...base, splitPct: 0, payout: 0 });
      continue;
    }

    const startMonth = startMonthFor(a.coachId);
    const tenure = startMonth ? tenureMonthsBetween(startMonth, ym) : null;
    // Unknown tenure (engagements but no dated start) defaults to the established
    // rate rather than penalizing the mentor as "new".
    const splitPct = tenure != null ? splitForTenureMonth(tenure) : PAY_RAMP[PAY_RAMP.length - 1];
    const payout = round2(earned * splitPct);

    let m = mentors.get(a.coachId);
    if (!m) {
      m = {
        coachId: a.coachId,
        coachName: input.coachName(a.coachId),
        startMonth,
        tenureMonth: tenure,
        splitPct,
        menteeCount: 0,
        billed: 0,
        collected: 0,
        earned: 0,
        payout: 0,
        lines: [],
      };
      mentors.set(a.coachId, m);
    }
    m.menteeCount++;
    m.billed = round2(m.billed + billed);
    m.collected = round2(m.collected + collected);
    m.earned = round2(m.earned + earned);
    m.payout = round2(m.payout + payout);
    m.lines.push({ ...base, splitPct, payout });
  }

  const mentorList = [...mentors.values()].sort((a, b) => b.payout - a.payout);
  for (const m of mentorList) m.lines.sort((a, b) => b.payout - a.payout);

  const totals = {
    billed: round2(mentorList.reduce((s, m) => s + m.billed, 0) + unassigned.reduce((s, u) => s + u.billed, 0)),
    collected: round2(mentorList.reduce((s, m) => s + m.collected, 0) + unassigned.reduce((s, u) => s + u.collected, 0)),
    earned: round2(mentorList.reduce((s, m) => s + m.earned, 0)),
    payout: round2(mentorList.reduce((s, m) => s + m.payout, 0)),
    mentorCount: mentorList.length,
    menteeCount: mentorList.reduce((s, m) => s + m.menteeCount, 0),
  };

  return { ym, mentors: mentorList, unassigned, totals };
}

// --- Multi-month timeline + flat ledger ------------------------------------
// computePayTimeline is a thin map over computePayReport plus a FLAT LEDGER (one
// row per mentee per payout month, incl. the unassigned bucket) for the explorer.

export interface PayLedgerRow {
  ym: string;
  coachId: number | null;
  coachName: string; // "—" for the unassigned bucket
  clientId: number;
  clientName: string;
  tier: string;
  billed: number;
  collected: number;
  invoiceDay: number | null;
  recognizedThis: number;
  rolloverPrev: number;
  earned: number;
  splitPct: number;
  payout: number;
  assigned: boolean; // false = billed revenue with no coach overlapping that month
}

export interface PayMonth {
  ym: string;
  report: PayReport;
}

export interface PayTimeline {
  months: PayMonth[]; // one per requested month, in the requested order
  ledger: PayLedgerRow[]; // every mentee line across all months (incl. unassigned)
  totals: { billed: number; collected: number; earned: number; payout: number };
}

export interface PayTimelineInput {
  invoices: PayInvoiceInput[];
  engagements: PayEngagementInput[];
  coachName: (id: number) => string;
  clientName: (id: number) => string;
  startMonthOverride?: Map<number, string>;
  // clientId -> the mentee's OWNER (CA primary coach); credited instead of the
  // engagement-coverage coach when present (see computePayReport).
  primaryCoachOf?: (clientId: number) => number | null;
  // Payout months to compute, 'YYYY-MM'. Defaults to every distinct invoice service
  // month PLUS the following month (where the rollover slice lands), newest first.
  months?: string[];
}

// Distinct service months present in the invoices, newest first.
export function distinctServiceMonths(invoices: PayInvoiceInput[]): string[] {
  return [...new Set(invoices.map((i) => ymOf(i.serviceDate)))].sort((a, b) => b.localeCompare(a));
}

// Payout months = every service month AND the month after it (the rollover tail),
// newest first. So a mentee's final invoice still pays its elapsed slice the
// following month even if no new invoice is issued.
export function payoutMonths(invoices: PayInvoiceInput[]): string[] {
  const set = new Set<string>();
  for (const i of invoices) {
    const ym = ymOf(i.serviceDate);
    set.add(ym);
    set.add(nextYm(ym));
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

export function computePayTimeline(input: PayTimelineInput): PayTimeline {
  const months = input.months ?? payoutMonths(input.invoices);
  const reports = months.map((ym) =>
    computePayReport({
      ym,
      invoices: input.invoices,
      engagements: input.engagements,
      coachName: input.coachName,
      clientName: input.clientName,
      startMonthOverride: input.startMonthOverride,
      primaryCoachOf: input.primaryCoachOf,
    })
  );

  const ledger: PayLedgerRow[] = [];
  for (const r of reports) {
    for (const m of r.mentors) {
      for (const l of m.lines) {
        ledger.push({
          ym: r.ym,
          coachId: m.coachId,
          coachName: m.coachName,
          clientId: l.clientId,
          clientName: l.clientName,
          tier: l.tier,
          billed: l.billed,
          collected: l.collected,
          invoiceDay: l.invoiceDay,
          recognizedThis: l.recognizedThis,
          rolloverPrev: l.rolloverPrev,
          earned: l.earned,
          splitPct: l.splitPct,
          payout: l.payout,
          assigned: true,
        });
      }
    }
    for (const u of r.unassigned) {
      ledger.push({
        ym: r.ym,
        coachId: null,
        coachName: "—",
        clientId: u.clientId,
        clientName: u.clientName,
        tier: u.tier,
        billed: u.billed,
        collected: u.collected,
        invoiceDay: u.invoiceDay,
        recognizedThis: u.recognizedThis,
        rolloverPrev: u.rolloverPrev,
        earned: u.earned,
        splitPct: u.splitPct,
        payout: u.payout,
        assigned: false,
      });
    }
  }

  const totals = {
    billed: round2(reports.reduce((s, r) => s + r.totals.billed, 0)),
    collected: round2(reports.reduce((s, r) => s + r.totals.collected, 0)),
    earned: round2(reports.reduce((s, r) => s + r.totals.earned, 0)),
    payout: round2(reports.reduce((s, r) => s + r.totals.payout, 0)),
  };

  return { months: reports.map((report) => ({ ym: report.ym, report })), ledger, totals };
}
