// Pure staff-payment (payroll) engine. Computes what each mentor is owed for a
// given service month. No I/O — the caller supplies already-fetched rows, so
// this is unit-testable (see scripts/verify-metrics.ts §8) and reusable from the
// browser (src/views/PayStaffView.tsx).
//
// Model (decided with the user, 2026-06-19):
//  - Revenue belongs to the invoice's SERVICE month (date_of), never the payment
//    date. We pay coaches on money actually COLLECTED (amount_paid), credited to
//    that service month.
//  - Partial months are prorated by active service days: (active days in month /
//    days in month). A full month => factor 1 => the whole monthly share. This
//    handles mid-month starts, quits/graduations, and tier changes.
//  - The split RAMPS with the mentor's tenure: their 1st month = 35%, 2nd = 50%,
//    3rd month onward = 60%. Tenure is measured from the mentor's earliest
//    engagement start (overridable per coach).
//  - A mentee is attributed to the coach who covered the most active days that
//    month (handles a mid-month hand-off). Collected revenue with no overlapping
//    engagement is reported as "unassigned" rather than silently dropped.

import { engagementTier } from "./config";

// Mentor revenue-share ramp by tenure month (1-indexed). Past the table it holds
// at the final value (60%).
export const PAY_RAMP = [0.35, 0.5, 0.6] as const;

export function splitForTenureMonth(tenureMonth: number): number {
  if (tenureMonth < 1) return PAY_RAMP[0];
  const i = Math.min(tenureMonth, PAY_RAMP.length) - 1;
  return PAY_RAMP[i];
}

// 'YYYY-MM' -> absolute month ordinal, for tenure arithmetic.
export function monthOrdinal(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

// 1-indexed tenure: the mentor's start month itself is tenure month 1.
export function tenureMonthsBetween(startYm: string, serviceYm: string): number {
  return monthOrdinal(serviceYm) - monthOrdinal(startYm) + 1;
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this one
}

function ymOf(dateYmd: string): string {
  return dateYmd.slice(0, 7);
}

// --- engine inputs ---

export interface PayInvoiceInput {
  clientId: number;
  serviceYm: string; // 'YYYY-MM' from the invoice date_of
  collected: number; // amount_paid (collected so far)
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
  ym: string; // the service month being computed, 'YYYY-MM'
  invoices: PayInvoiceInput[];
  engagements: PayEngagementInput[];
  coachName: (id: number) => string;
  clientName: (id: number) => string;
  // coachId -> 'YYYY-MM' override for when a mentor's tenure started (else
  // derived from their earliest engagement start).
  startMonthOverride?: Map<number, string>;
}

// --- engine outputs ---

export interface PayMenteeLine {
  clientId: number;
  clientName: string;
  coachId: number | null;
  collected: number;
  activeDays: number;
  daysInMonth: number;
  proration: number; // activeDays / daysInMonth, 0..1
  earned: number; // collected * proration (revenue credited to this month)
  splitPct: number;
  payout: number; // earned * splitPct
  tier: string;
}

export interface PayMentorSummary {
  coachId: number;
  coachName: string;
  startMonth: string | null;
  tenureMonth: number | null;
  splitPct: number;
  menteeCount: number;
  collected: number;
  earned: number;
  payout: number;
  lines: PayMenteeLine[];
}

export interface PayReport {
  ym: string;
  daysInMonth: number;
  mentors: PayMentorSummary[];
  unassigned: PayMenteeLine[]; // collected revenue with no overlapping engagement
  totals: { collected: number; earned: number; payout: number; mentorCount: number; menteeCount: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computePayReport(input: PayInputs): PayReport {
  const { ym } = input;
  const dim = daysInMonth(ym);

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

  // Collected revenue for this service month, per mentee.
  const collectedByClient = new Map<number, number>();
  for (const inv of input.invoices) {
    if (inv.serviceYm !== ym) continue;
    collectedByClient.set(inv.clientId, (collectedByClient.get(inv.clientId) ?? 0) + (inv.collected || 0));
  }

  // Non-canceled engagements grouped by mentee.
  const engByClient = new Map<number, PayEngagementInput[]>();
  for (const e of input.engagements) {
    if (e.isCanceled) continue;
    const arr = engByClient.get(e.clientId) ?? [];
    arr.push(e);
    engByClient.set(e.clientId, arr);
  }

  const monthEnd = `${ym}-${String(dim).padStart(2, "0")}`;
  const mentors = new Map<number, PayMentorSummary>();
  const unassigned: PayMenteeLine[] = [];

  for (const [clientId, collected] of collectedByClient) {
    if (collected <= 0) continue; // pay on collected: nothing collected, nothing owed
    const engs = engByClient.get(clientId) ?? [];

    // Walk each day of the month: count active days (union across engagements)
    // and which coach + tier covered the day (first matching engagement wins).
    let activeDays = 0;
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
        activeDays++;
        if (coverCoach != null) daysByCoach.set(coverCoach, (daysByCoach.get(coverCoach) ?? 0) + 1);
        if (coverTier) tier = coverTier;
      }
    }

    // Attribute the mentee to the coach with the most active days this month.
    let coachId: number | null = null;
    let best = 0;
    for (const [cid, n] of daysByCoach) {
      if (n > best) {
        best = n;
        coachId = cid;
      }
    }

    const proration = dim ? Math.min(1, activeDays / dim) : 0;
    const earned = round2(collected * proration);

    if (coachId == null) {
      // Collected revenue we can't tie to a coach this month — surface it.
      unassigned.push({
        clientId,
        clientName: input.clientName(clientId),
        coachId: null,
        collected: round2(collected),
        activeDays,
        daysInMonth: dim,
        proration,
        earned,
        splitPct: 0,
        payout: 0,
        tier,
      });
      continue;
    }

    const startMonth = startMonthFor(coachId);
    const tenure = startMonth ? tenureMonthsBetween(startMonth, ym) : null;
    // Unknown tenure (coach has engagements but no dated start) defaults to the
    // established rate rather than penalizing them as "new".
    const splitPct = tenure != null ? splitForTenureMonth(tenure) : PAY_RAMP[PAY_RAMP.length - 1];
    const payout = round2(earned * splitPct);

    let m = mentors.get(coachId);
    if (!m) {
      m = {
        coachId,
        coachName: input.coachName(coachId),
        startMonth,
        tenureMonth: tenure,
        splitPct,
        menteeCount: 0,
        collected: 0,
        earned: 0,
        payout: 0,
        lines: [],
      };
      mentors.set(coachId, m);
    }
    m.menteeCount++;
    m.collected = round2(m.collected + collected);
    m.earned = round2(m.earned + earned);
    m.payout = round2(m.payout + payout);
    m.lines.push({
      clientId,
      clientName: input.clientName(clientId),
      coachId,
      collected: round2(collected),
      activeDays,
      daysInMonth: dim,
      proration,
      earned,
      splitPct,
      payout,
      tier,
    });
  }

  const mentorList = [...mentors.values()].sort((a, b) => b.payout - a.payout);
  for (const m of mentorList) m.lines.sort((a, b) => b.payout - a.payout);

  const totals = {
    collected: round2(mentorList.reduce((s, m) => s + m.collected, 0) + unassigned.reduce((s, u) => s + u.collected, 0)),
    earned: round2(mentorList.reduce((s, m) => s + m.earned, 0)),
    payout: round2(mentorList.reduce((s, m) => s + m.payout, 0)),
    mentorCount: mentorList.length,
    menteeCount: mentorList.reduce((s, m) => s + m.menteeCount, 0),
  };

  return { ym, daysInMonth: dim, mentors: mentorList, unassigned, totals };
}
