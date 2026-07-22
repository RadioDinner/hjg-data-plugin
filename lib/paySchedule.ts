// Pure service-month scheduling for the Build-payout screen (§203/§204): which
// month the builder should open on, and how "complete" each month's payment run
// is (every mentor with payout lines that month marked Payment sent). No I/O —
// unit-tested in scripts/verify-metrics.ts and reusable from the browser.

const YM_RE = /^\d{4}-\d{2}$/;

// 'YYYY-MM' -> the month before it.
export function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const o = y * 12 + (m - 1) - 1;
  return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
}

// The service month the builder opens on: the newest month with a payment
// already sent (the user's "last paid month"), else the month BEFORE today —
// payouts are built after a service month closes, so on 2026-07-22 with no
// payments recorded yet this is 2026-06. (More provisions may layer on later;
// this is deliberately the simple rule the user asked for.)
export function defaultServiceMonth(todayYm: string, paidMonths: Iterable<string>): string {
  let latest = "";
  for (const m of paidMonths) if (YM_RE.test(m) && m > latest) latest = m;
  return latest || prevYm(todayYm);
}

export interface MonthPayProgress {
  ym: string;
  paid: number; // mentors whose build for this month is marked Payment sent
  total: number; // mentors with payout lines in this month
  complete: boolean; // total > 0 and every mentor paid
  unpaidCoachIds: number[]; // who still needs a payment (for the tooltip)
}

// Per-month completion across mentors, newest month first. `mentorMonths` holds
// one entry per (mentor, month) with payout lines (duplicates tolerated);
// `isPaid` says whether that mentor's build for the month is marked Payment sent.
export function monthPayProgress(
  mentorMonths: { coachId: number; ym: string }[],
  isPaid: (coachId: number, ym: string) => boolean
): MonthPayProgress[] {
  const byMonth = new Map<string, { paid: number; total: number; unpaidCoachIds: number[] }>();
  const seen = new Set<string>();
  for (const { coachId, ym } of mentorMonths) {
    if (!YM_RE.test(ym)) continue;
    const key = `${coachId}|${ym}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = byMonth.get(ym) ?? { paid: 0, total: 0, unpaidCoachIds: [] };
    e.total++;
    if (isPaid(coachId, ym)) e.paid++;
    else e.unpaidCoachIds.push(coachId);
    byMonth.set(ym, e);
  }
  return [...byMonth.entries()]
    .map(([ym, e]) => ({ ym, paid: e.paid, total: e.total, complete: e.total > 0 && e.paid === e.total, unpaidCoachIds: e.unpaidCoachIds }))
    .sort((a, b) => b.ym.localeCompare(a.ym));
}
