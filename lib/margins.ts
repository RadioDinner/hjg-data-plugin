// Pure helpers for the Margins tab — comparing STAFF hours (entered manually) to
// DELIVERED meeting hours (computed from CoachAccountable) per program, per month.
// No I/O — the caller supplies already-fetched maps, so this is unit-testable
// (scripts/verify-metrics.ts §17) and reusable from the browser.
//
// "Bones" stage (decided with the user): hours only, dollars come later. Delivered
// hours are a STAND-IN: each distinct meeting/session counts as PROGRAM_MEETING_HOURS
// until CoachAccountable exposes real per-appointment durations.

import type { PipelineTier } from "./config";

// Fallback length of one delivered session, in hours — used only when an
// appointment has no recorded end time (pre-sync rows, or CA left endDate blank).
// When start_raw + end_raw are both present, the REAL duration is used instead.
export const PROGRAM_MEETING_HOURS = 1;

// Hours between two CoachAccountable datetime strings ("YYYY-MM-DD HH:MM:SS",
// account-local). The difference is timezone-agnostic as long as both parse the
// same way, so we don't need the account's zone. Returns null when either side is
// missing/unparseable or the span is non-positive, so callers fall back to the
// per-session stand-in.
export function meetingHours(startRaw: string | null | undefined, endRaw: string | null | undefined): number | null {
  if (!startRaw || !endRaw) return null;
  const s = Date.parse(startRaw.replace(" ", "T"));
  const e = Date.parse(endRaw.replace(" ", "T"));
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return (e - s) / 3_600_000;
}

export interface ProgramDef {
  key: string;
  label: string;
  tiers: PipelineTier[]; // which pipeline tiers' meetings count as this program's delivery
  blurb: string;
}

// The programs shown as Margins sub-tabs. JumpStart Your Freedom = the supervised
// JumpStart tier; Mentoring = the ongoing 1-on-1 tiers (4x / 2x / 1x).
export const PROGRAMS: ProgramDef[] = [
  {
    key: "jyf",
    label: "JumpStart Your Freedom",
    tiers: ["jumpstart"],
    blurb: "Staff hours vs delivered JumpStart Your Freedom meeting hours, by month.",
  },
  {
    key: "mentoring",
    label: "Mentoring",
    tiers: ["4x", "2x", "1x"],
    blurb: "Staff hours vs delivered ongoing-mentoring (4x / 2x / 1x) meeting hours, by month.",
  },
];

// One delivered session (a distinct coach + start-time slot) behind the delivered
// hours — the drill-down rows when you click a month's column on the Margins chart.
export interface ProgramSession {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM (local) from the start time, when known
  coachName: string;
  name: string; // meeting name
  attendees: number; // appointment rows in this slot (1 = 1-on-1; >1 = group)
  hours: number; // this session's hours (real duration, or the fallback)
  realDuration: boolean; // true = from end−start; false = PROGRAM_MEETING_HOURS fallback
}

export interface ProgramMonthRow {
  month: string; // YYYY-MM
  sessions: number; // distinct delivered sessions/meetings that month
  deliveredHours: number; // sessions * PROGRAM_MEETING_HOURS
  staffHours: number | null; // entered (null = not entered yet)
  ratio: number | null; // deliveredHours / staffHours (null when staff hours absent/zero)
}

// Merge delivered-hours (from CA) with entered staff-hours into one row per month,
// newest first. `extraMonths` ensures rows exist for months with neither yet (e.g.
// the current month) so staff can still enter hours there.
export function mergeProgramMonths(
  delivered: Map<string, { sessions: number; hours: number }>,
  staff: Map<string, number>,
  extraMonths: string[] = []
): ProgramMonthRow[] {
  const months = new Set<string>([...delivered.keys(), ...staff.keys(), ...extraMonths]);
  const rows: ProgramMonthRow[] = [];
  for (const month of months) {
    const d = delivered.get(month);
    const sessions = d?.sessions ?? 0;
    const deliveredHours = d?.hours ?? 0;
    const staffHours = staff.has(month) ? staff.get(month)! : null;
    const ratio = staffHours != null && staffHours > 0 ? deliveredHours / staffHours : null;
    rows.push({ month, sessions, deliveredHours, staffHours, ratio });
  }
  return rows.sort((a, b) => b.month.localeCompare(a.month));
}
