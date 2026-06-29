// Pure "Meetings to Freedom!" metric (src/views/MetricsView.tsx).
//
// For each GRADUATED mentee, count the 1-on-1 mentoring sessions between the
// completion of JumpStart Your Freedom and their graduation — i.e. how many
// ongoing-tier (4x / 2x / 1x) one-on-one meetings it took to walk them to
// "Freedom" (graduation). Group sessions don't count.
//
// Window per mentee:
//   start = the JumpStart engagement's END date (when JumpStart completed); if
//           that's missing, fall back to when they entered their first ongoing
//           tier (earliest 4x/2x/1x stage date) so a graduated mentee isn't
//           dropped over a missing end date.
//   end   = the graduation date.
// Count = non-group mentoring meetings with start <= date <= end.
//
// Only graduated mentees with a usable window (both endpoints, start <= end) are
// "measurable"; the rest are reported as `unmeasured` rather than silently
// dropped. No I/O, no React — unit-tested in scripts/verify-metrics.ts §14.

export interface FreedomMenteeInput {
  clientId: number;
  name: string;
  graduated: boolean;
  graduationDate: string | null; // YYYY-MM-DD
  jumpstartEnd: string | null; // JumpStart engagement end (completion) date
  firstOngoingStart: string | null; // earliest 4x/2x/1x stage date (fallback window start)
  meetings: { date: string; isGroup: boolean }[];
}

export interface FreedomRow {
  clientId: number;
  name: string;
  windowStart: string; // resolved JumpStart-completion date
  graduationDate: string;
  meetings: number; // 1-on-1 mentoring sessions in the window
}

export interface FreedomReport {
  rows: FreedomRow[]; // measurable graduated mentees, most meetings first
  n: number; // measurable graduated mentees
  avg: number | null; // mean meetings-to-freedom (1 decimal)
  median: number | null;
  min: number | null;
  max: number | null;
  total: number; // total 1-on-1 sessions across measurable mentees
  unmeasured: number; // graduated but no usable window (missing/!ordered endpoints)
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeMeetingsToFreedom(mentees: FreedomMenteeInput[]): FreedomReport {
  const rows: FreedomRow[] = [];
  let unmeasured = 0;

  for (const m of mentees) {
    if (!m.graduated) continue;
    const windowStart = m.jumpstartEnd ?? m.firstOngoingStart;
    const gradDate = m.graduationDate;
    // Need both endpoints, ordered correctly (a window that ends before it starts
    // is a data anomaly — surface it as unmeasured, don't count a misleading 0).
    if (!windowStart || !gradDate || windowStart > gradDate) {
      unmeasured++;
      continue;
    }
    const count = m.meetings.filter((mt) => !mt.isGroup && mt.date >= windowStart && mt.date <= gradDate).length;
    rows.push({ clientId: m.clientId, name: m.name, windowStart, graduationDate: gradDate, meetings: count });
  }

  rows.sort((a, b) => b.meetings - a.meetings || a.name.localeCompare(b.name));

  const counts = rows.map((r) => r.meetings);
  const n = counts.length;
  const total = counts.reduce((s, c) => s + c, 0);
  const avg = n ? round1(total / n) : null;
  const min = n ? Math.min(...counts) : null;
  const max = n ? Math.max(...counts) : null;
  let median: number | null = null;
  if (n) {
    const sorted = [...counts].sort((a, b) => a - b);
    median = n % 2 ? sorted[(n - 1) / 2] : round1((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
  }

  return { rows, n, avg, median, min, max, total, unmeasured };
}
