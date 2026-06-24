// Pure helpers for the Margins tab — comparing STAFF hours (entered manually) to
// DELIVERED meeting hours (computed from CoachAccountable) per program, per month.
// No I/O — the caller supplies already-fetched maps, so this is unit-testable
// (scripts/verify-metrics.ts §17) and reusable from the browser.
//
// "Bones" stage (decided with the user): hours only, dollars come later. Delivered
// hours are a STAND-IN: each distinct meeting/session counts as PROGRAM_MEETING_HOURS
// until CoachAccountable exposes real per-appointment durations.

import type { PipelineTier } from "./config";

// Assumed length of one delivered session, in hours. A single knob to retune once
// real durations are available (CA Appointment has no end time in the mirror today).
export const PROGRAM_MEETING_HOURS = 1;

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
