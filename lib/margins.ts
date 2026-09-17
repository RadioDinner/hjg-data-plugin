// Pure helpers for the Margins tab — "Margins on Mentoring", per mentee.
// No I/O — the caller supplies already-fetched rows (invoices, meetings,
// engagements for ONE mentee), so this is unit-testable (scripts/verify-metrics.ts
// §17) and reusable from the browser.
//
// THE MODEL (decided with the user, session 020):
//  - A mentee on an ongoing tier (4x / 2x / 1x) is invoiced monthly for that
//    tier's price (e.g. $425 for 4x). HJG keeps a share of what is COLLECTED
//    (default 40%); the mentor gets the rest (default 60%).
//  - HJG's margin is expressed PER MEETING. The naive figure — HJG's collected
//    share ÷ meetings that have occurred — is skewed the moment the mentee pays
//    an invoice ahead of the meetings it buys (4 paid months = 16 meetings owed on
//    a 4x, but only 12 have happened → the per-meeting number reads too high).
//  - So the report also counts the meetings the paid invoices ENTITLE the mentee
//    to (Σ tier cadence per paid invoice, prorated for partial payment) and shows
//    the margin both ways:
//      per meeting delivered = HJG collected ÷ meetings occurred     (cash basis)
//      per meeting paid for  = HJG collected ÷ meetings paid for     (entitlement)
//    plus the prepaid gap (meetings paid for but not yet delivered) and the HJG
//    dollars that gap represents (deferred — collected, not yet earned).
//  - Scope is MENTORING ONLY: invoices whose tier resolves to 4x / 2x / 1x and
//    meetings under a 4x / 2x / 1x engagement (or an unknown engagement — old
//    rows with no engagement id are kept; JumpStart / training / group / other
//    engagements are excluded and counted separately so nothing vanishes silently).

import { engagementTier, type EngagementTier } from "./config";

// The ongoing-mentoring tiers and how many meetings one monthly invoice buys.
export const MENTORING_TIERS = ["4x", "2x", "1x"] as const;
export type MentoringTier = (typeof MENTORING_TIERS)[number];
export const TIER_MEETINGS_PER_MONTH: Record<MentoringTier, number> = { "4x": 4, "2x": 2, "1x": 1 };

// Default revenue split: the mentor's share of collected revenue (HJG keeps the rest).
export const DEFAULT_MENTOR_SHARE = 0.6;

export function isMentoringTier(t: string | null | undefined): t is MentoringTier {
  return t === "4x" || t === "2x" || t === "1x";
}

// --- inputs (one mentee) ---

export interface MarginInvoiceInput {
  id: number | null;
  invoiceNumber: string | null;
  serviceDate: string | null; // ca_invoices.date_of (YYYY-MM-DD) — the revenue month
  issuedDate: string | null; // ca_invoices.date_added
  dueDate: string | null; // ca_invoices.date_due
  amount: number; // billed
  collected: number; // amount_paid so far
  lineItems: { item: string | null; amount: number }[];
  payments: { datePaid: string | null; amount: number; method: string | null }[];
}

export interface MarginMeetingInput {
  id: number | null;
  name: string;
  isGroup: boolean;
  coachName: string | null;
  engagementId: number | null;
  startDate: string | null; // YYYY-MM-DD (account-local)
  startRaw: string | null; // "YYYY-MM-DD HH:MM:SS" (account-local), exact CA string
  countsInEngagement: number | null; // CA: 1 counts, -1 does not, 0 no judgement, null unsynced
}

export interface MarginEngagementInput {
  id: number | null;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  isComplete: boolean;
  isCanceled: boolean;
  nextInvoiceDate: string | null; // CA Engagement.nextInvoiceDate (needs migration 9963 + re-sync)
}

export interface MenteeMarginInputs {
  invoices: MarginInvoiceInput[];
  meetings: MarginMeetingInput[];
  engagements: MarginEngagementInput[];
  today: string; // YYYY-MM-DD (account-local)
  // "YYYY-MM-DD HH:MM:SS" account-local. A meeting whose start is at or before
  // this instant has OCCURRED; later = upcoming. Defaults to the end of `today`.
  now?: string;
  mentorShare?: number; // 0..1 (default DEFAULT_MENTOR_SHARE)
}

// --- per-row classifications ---

export type InvoiceStatus = "paid" | "partial" | "unpaid" | "credit";

// paid = fully collected; partial = some money in; unpaid = nothing yet;
// credit = a zero/negative invoice (refund or adjustment — nothing to collect).
export function invoiceStatus(amount: number, collected: number): InvoiceStatus {
  if (amount <= 0) return "credit";
  if (collected >= amount - 0.005) return "paid";
  if (collected > 0) return "partial";
  return "unpaid";
}

// The engagement that covers a service date: the most-recently-started
// mentoring (4x/2x/1x) engagement whose span includes the date. Null when none.
function coveringMentoringEngagement(
  serviceDate: string,
  engagements: MarginEngagementInput[],
): MarginEngagementInput | null {
  let best: MarginEngagementInput | null = null;
  for (const e of engagements) {
    if (!isMentoringTier(engagementTier(e.name))) continue;
    if (e.startDate && e.startDate > serviceDate) continue;
    if (e.endDate && e.endDate < serviceDate) continue;
    if (!best || (e.startDate ?? "") > (best.startDate ?? "")) best = e;
  }
  return best;
}

// Which tier an invoice bills. Read off the largest positive line item whose text
// names a tier ("MN Subscription | (4x Month) …"); when no line item resolves, fall
// back to the mentoring engagement covering the invoice's service date. "other"
// when neither works — such an invoice is NOT mentoring revenue here.
export function invoiceTier(
  inv: MarginInvoiceInput,
  engagements: MarginEngagementInput[],
): EngagementTier {
  const lines = inv.lineItems
    .filter((l) => (l.amount || 0) > 0)
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));
  for (const l of lines) {
    const t = engagementTier(l.item);
    if (t !== "other") return t;
  }
  if (inv.serviceDate) {
    const cov = coveringMentoringEngagement(inv.serviceDate, engagements);
    if (cov) return engagementTier(cov.name);
  }
  return "other";
}

// YYYY-MM-DD shifted forward by `months` calendar months, day clamped to the
// target month's length (Jan 31 + 1 → Feb 28/29).
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm0 = idx - ny * 12;
  const lastDay = new Date(ny, nm0 + 1, 0).getDate();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${ny}-${pad2(nm0 + 1)}-${pad2(Math.min(d, lastDay))}`;
}

export interface ScheduledInvoices {
  // Monthly invoices CA will still issue on the mentee's open mentoring
  // engagements, from each engagement's next invoice date through its end date.
  // null = at least one open engagement has NO end date (open-ended subscription:
  // one invoice a month for as long as it runs — there is no finite count).
  count: number | null;
  nextInvoiceDate: string | null; // the soonest upcoming invoice date, if any
  openEnded: boolean;
  // false when no engagement carries a next-invoice date at all — the column is
  // not synced yet (migration 9963 + a re-sync), so "scheduled" is unknown.
  hasData: boolean;
}

export function projectScheduledInvoices(
  engagements: MarginEngagementInput[],
  today: string,
): ScheduledInvoices {
  const hasData = engagements.some((e) => e.nextInvoiceDate != null);
  const open = engagements.filter(
    (e) =>
      isMentoringTier(engagementTier(e.name)) &&
      !e.isComplete &&
      !e.isCanceled &&
      e.nextInvoiceDate != null &&
      e.nextInvoiceDate >= today,
  );
  if (open.length === 0) return { count: 0, nextInvoiceDate: null, openEnded: false, hasData };
  let count = 0;
  let openEnded = false;
  let next: string | null = null;
  for (const e of open) {
    const first = e.nextInvoiceDate as string;
    if (next == null || first < next) next = first;
    if (!e.endDate) {
      openEnded = true;
      continue;
    }
    // One invoice a month from the next date through the end date (bounded).
    for (let k = 0; k < 240; k++) {
      if (addMonths(first, k) > e.endDate) break;
      count++;
    }
  }
  return { count: openEnded ? null : count, nextInvoiceDate: next, openEnded, hasData };
}

// --- report rows ---

export interface MarginInvoiceRow {
  id: number | null;
  invoiceNumber: string | null;
  serviceDate: string | null;
  issuedDate: string | null;
  dueDate: string | null;
  tier: EngagementTier;
  mentoring: boolean; // counts toward the mentoring margin
  meetingsBought: number; // tier cadence × paid fraction (0 for non-mentoring)
  amount: number;
  collected: number;
  status: InvoiceStatus;
  overdue: boolean; // not fully paid and past due
  paidOn: string | null; // date of the last recorded payment
}

export interface MarginMeetingRow {
  id: number | null;
  date: string | null;
  time: string | null; // HH:MM from startRaw when known
  coachName: string | null;
  name: string;
  isGroup: boolean;
  tier: EngagementTier | null; // null = engagement unknown (kept in scope)
  mentoring: boolean; // counts toward the mentoring margin
  occurred: boolean; // start at/before `now`
  credited: boolean | null; // CA countsInEngagement === 1 (null = unsynced)
}

export interface MarginEngagementRow {
  id: number | null;
  name: string | null;
  tier: EngagementTier;
  startDate: string | null;
  endDate: string | null;
  state: "open" | "complete" | "canceled";
  nextInvoiceDate: string | null;
}

export interface MarginMonthRow {
  month: string; // YYYY-MM
  invoicesIssued: number;
  invoicesPaid: number;
  billed: number;
  collected: number;
  hjgCollected: number;
  meetingsOccurred: number;
  meetingsUpcoming: number;
  // HJG collected this service month ÷ meetings occurred this month. Null when no
  // meeting occurred (an invoice with no delivery yet shows the prepaid skew).
  marginPerMeeting: number | null;
}

export interface MenteeMarginReport {
  mentorShare: number;
  hjgShare: number;
  invoices: {
    issued: number; // mentoring invoices in the mirror
    paid: number;
    partial: number;
    unpaid: number;
    overdue: number; // subset of partial + unpaid, past due date
    nonMentoring: number; // invoices excluded from the margin (JYF, training, …)
    scheduled: ScheduledInvoices;
  };
  money: {
    billed: number; // Σ amount over mentoring invoices
    collected: number; // Σ collected
    outstanding: number; // billed − collected (what is still owed)
    hjgCollected: number; // collected × hjgShare
    mentorCollected: number; // collected × mentorShare
    hjgEarned: number; // the part of hjgCollected whose meetings have been delivered
    hjgDeferred: number; // hjgCollected − hjgEarned (paid for, not yet delivered)
  };
  meetings: {
    occurred: number;
    upcoming: number;
    booked: number; // occurred + upcoming
    paidFor: number; // Σ cadence × paid fraction over mentoring invoices
    prepaid: number; // max(0, paidFor − occurred) — the skew
    overDelivered: number; // max(0, occurred − paidFor)
    credited: number; // occurred meetings CA has credited against an engagement
    nonMentoring: number; // meetings excluded (JYF / training / group engagements)
  };
  margin: {
    perMeetingDelivered: number | null; // hjgCollected ÷ occurred (cash basis)
    perMeetingPaidFor: number | null; // hjgCollected ÷ paidFor (entitlement basis)
  };
  byMonth: MarginMonthRow[]; // oldest → newest
  invoiceRows: MarginInvoiceRow[]; // newest service date first
  meetingRows: MarginMeetingRow[]; // newest first
  engagementRows: MarginEngagementRow[]; // newest start first
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeMenteeMargin(input: MenteeMarginInputs): MenteeMarginReport {
  const mentorShare = clampShare(input.mentorShare ?? DEFAULT_MENTOR_SHARE);
  const hjgShare = 1 - mentorShare;
  const today = input.today;
  const now = input.now ?? `${today} 23:59:59`;

  // Engagements → tier lookup for meetings.
  const tierByEngagement = new Map<number, EngagementTier>();
  for (const e of input.engagements)
    if (e.id != null) tierByEngagement.set(e.id, engagementTier(e.name));

  // --- invoices ---
  const invoiceRows: MarginInvoiceRow[] = input.invoices.map((inv) => {
    const tier = invoiceTier(inv, input.engagements);
    const mentoring = isMentoringTier(tier);
    const status = invoiceStatus(inv.amount, inv.collected);
    const paidFraction = inv.amount > 0 ? Math.min(1, Math.max(0, inv.collected) / inv.amount) : 0;
    const meetingsBought = mentoring
      ? TIER_MEETINGS_PER_MONTH[tier as MentoringTier] * paidFraction
      : 0;
    let paidOn: string | null = null;
    for (const p of inv.payments)
      if (p.datePaid && (paidOn == null || p.datePaid > paidOn)) paidOn = p.datePaid;
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      serviceDate: inv.serviceDate,
      issuedDate: inv.issuedDate,
      dueDate: inv.dueDate,
      tier,
      mentoring,
      meetingsBought,
      amount: inv.amount,
      collected: inv.collected,
      status,
      overdue:
        (status === "partial" || status === "unpaid") && !!inv.dueDate && inv.dueDate < today,
      paidOn,
    };
  });
  invoiceRows.sort((a, b) => (b.serviceDate ?? "").localeCompare(a.serviceDate ?? ""));

  // --- meetings ---
  const meetingRows: MarginMeetingRow[] = input.meetings
    .filter((m) => m.startDate || m.startRaw)
    .map((m) => {
      const tier = m.engagementId != null ? (tierByEngagement.get(m.engagementId) ?? null) : null;
      const mentoring = tier == null || isMentoringTier(tier);
      const occurred = m.startRaw ? m.startRaw <= now : (m.startDate as string) <= today;
      return {
        id: m.id,
        date: m.startDate ?? (m.startRaw ? m.startRaw.slice(0, 10) : null),
        time: m.startRaw && m.startRaw.length >= 16 ? m.startRaw.slice(11, 16) : null,
        coachName: m.coachName,
        name: m.name,
        isGroup: m.isGroup,
        tier,
        mentoring,
        occurred,
        credited: m.countsInEngagement == null ? null : m.countsInEngagement === 1,
      };
    });
  meetingRows.sort((a, b) =>
    `${b.date ?? ""}${b.time ?? ""}`.localeCompare(`${a.date ?? ""}${a.time ?? ""}`),
  );

  // --- engagements ---
  const engagementRows: MarginEngagementRow[] = input.engagements
    .map((e) => ({
      id: e.id,
      name: e.name,
      tier: engagementTier(e.name),
      startDate: e.startDate,
      endDate: e.endDate,
      state: (e.isCanceled ? "canceled" : e.isComplete ? "complete" : "open") as
        "open" | "complete" | "canceled",
      nextInvoiceDate: e.nextInvoiceDate,
    }))
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  // --- totals ---
  let issued = 0;
  let paid = 0;
  let partial = 0;
  let unpaid = 0;
  let overdue = 0;
  let nonMentoringInvoices = 0;
  let billed = 0;
  let collected = 0;
  let paidFor = 0;
  for (const r of invoiceRows) {
    if (!r.mentoring) {
      nonMentoringInvoices++;
      continue;
    }
    issued++;
    if (r.status === "paid") paid++;
    else if (r.status === "partial") partial++;
    else if (r.status === "unpaid") unpaid++;
    if (r.overdue) overdue++;
    billed += r.amount;
    collected += r.collected;
    paidFor += r.meetingsBought;
  }

  let occurred = 0;
  let upcoming = 0;
  let credited = 0;
  let nonMentoringMeetings = 0;
  for (const m of meetingRows) {
    if (!m.mentoring) {
      nonMentoringMeetings++;
      continue;
    }
    if (m.occurred) {
      occurred++;
      if (m.credited) credited++;
    } else upcoming++;
  }

  const hjgCollected = collected * hjgShare;
  const mentorCollected = collected * mentorShare;
  // Delivered fraction of what was paid for: all of it once the meetings owed have
  // happened; a proportion while some are still prepaid.
  const deliveredFraction = paidFor > 0 ? Math.min(1, occurred / paidFor) : 1;
  const hjgEarned = hjgCollected * deliveredFraction;

  // --- by month (service month for invoices, start month for meetings) ---
  const months = new Map<string, MarginMonthRow>();
  const row = (ym: string) => {
    let r = months.get(ym);
    if (!r) {
      r = {
        month: ym,
        invoicesIssued: 0,
        invoicesPaid: 0,
        billed: 0,
        collected: 0,
        hjgCollected: 0,
        meetingsOccurred: 0,
        meetingsUpcoming: 0,
        marginPerMeeting: null,
      };
      months.set(ym, r);
    }
    return r;
  };
  for (const r of invoiceRows) {
    if (!r.mentoring || !r.serviceDate) continue;
    const m = row(r.serviceDate.slice(0, 7));
    m.invoicesIssued++;
    if (r.status === "paid") m.invoicesPaid++;
    m.billed += r.amount;
    m.collected += r.collected;
  }
  for (const mt of meetingRows) {
    if (!mt.mentoring || !mt.date) continue;
    const m = row(mt.date.slice(0, 7));
    if (mt.occurred) m.meetingsOccurred++;
    else m.meetingsUpcoming++;
  }
  const byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of byMonth) {
    m.billed = round2(m.billed);
    m.collected = round2(m.collected);
    m.hjgCollected = round2(m.collected * hjgShare);
    m.marginPerMeeting =
      m.meetingsOccurred > 0 ? round2(m.hjgCollected / m.meetingsOccurred) : null;
  }

  return {
    mentorShare,
    hjgShare,
    invoices: {
      issued,
      paid,
      partial,
      unpaid,
      overdue,
      nonMentoring: nonMentoringInvoices,
      scheduled: projectScheduledInvoices(input.engagements, today),
    },
    money: {
      billed: round2(billed),
      collected: round2(collected),
      outstanding: round2(billed - collected),
      hjgCollected: round2(hjgCollected),
      mentorCollected: round2(mentorCollected),
      hjgEarned: round2(hjgEarned),
      hjgDeferred: round2(hjgCollected - hjgEarned),
    },
    meetings: {
      occurred,
      upcoming,
      booked: occurred + upcoming,
      paidFor: round2(paidFor),
      prepaid: round2(Math.max(0, paidFor - occurred)),
      overDelivered: round2(Math.max(0, occurred - paidFor)),
      credited,
      nonMentoring: nonMentoringMeetings,
    },
    margin: {
      perMeetingDelivered: occurred > 0 ? round2(hjgCollected / occurred) : null,
      perMeetingPaidFor: paidFor > 0 ? round2(hjgCollected / paidFor) : null,
    },
    byMonth,
    invoiceRows,
    meetingRows,
    engagementRows,
  };
}

// Keep a user-typed share inside 0..1; anything unparseable falls back to the default.
export function clampShare(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MENTOR_SHARE;
  return Math.min(1, Math.max(0, n));
}
