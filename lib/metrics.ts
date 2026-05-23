// Pure monthly-metrics computation. Reproduces the known-good values in SPEC.md
// s4 when fed equivalent data. No I/O here, so it is unit-testable in isolation.

import {
  categorizeAppointmentName,
  isExcludedClientName,
  MENTOR_COACH_ID_WHITELIST,
} from "./config";
import type { CAAppointment, CAClient, MonthlyMetrics } from "./types";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Extract calendar parts from a CA date string WITHOUT constructing a JS Date.
// CA returns account-local strings; string-extracting the YYYY-MM-DD prefix is
// timezone-safe, whereas new Date(...) would reinterpret it in the server's UTC
// zone and could shift an appointment across midnight into the wrong month.
export function caDateParts(s: string): { year: number; month1: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s ?? "").trim());
  if (!m) return null;
  return { year: Number(m[1]), month1: Number(m[2]), day: Number(m[3]) };
}

function clientFullName(c: CAClient | undefined): { full: string; first?: string; last?: string } {
  if (!c) return { full: "" };
  const first = c.firstName;
  const last = c.lastName;
  const full = c.name ?? [first, last].filter(Boolean).join(" ");
  return { full, first, last };
}

export interface ComputeOptions {
  year: number;
  endMonth: number; // 1-indexed, inclusive
}

export function computeMonthlyMetrics(
  appointments: CAAppointment[],
  clients: Map<number, CAClient>,
  opts: ComputeOptions
): MonthlyMetrics {
  const { year, endMonth } = opts;
  const zero = () => Array<number>(12).fill(0);
  const discoveryPhone = zero();
  const discoveryZoom = zero();
  const menteeMeetings = zero();
  const menteesByMonth: Array<Set<number>> = Array.from({ length: 12 }, () => new Set());
  const mentorsByMonth: Array<Set<number>> = Array.from({ length: 12 }, () => new Set());

  const excludedClients = new Set<string>();
  const uncategorized = new Set<string>();
  const unmatchedClientIds = new Set<number>();
  const whitelist = new Set(MENTOR_COACH_ID_WHITELIST);
  let appointmentsConsidered = 0;

  for (const appt of appointments) {
    if (appt.status !== "A") continue;
    const parts = caDateParts(appt.startDate);
    if (!parts) continue;
    if (parts.year !== year) continue;
    if (parts.month1 > endMonth) continue;
    const m = parts.month1 - 1;

    const client = clients.get(appt.ClientID);
    if (!client) unmatchedClientIds.add(appt.ClientID);
    const { full, first, last } = clientFullName(client);
    if (full && isExcludedClientName(full, first, last)) {
      excludedClients.add(full);
      continue;
    }

    appointmentsConsidered++;
    const category = categorizeAppointmentName(appt.name);
    switch (category) {
      case "excluded":
        continue;
      case "other":
        uncategorized.add(appt.name);
        continue;
      case "discoveryPhone":
        discoveryPhone[m]++;
        break;
      case "discoveryZoom":
        discoveryZoom[m]++;
        break;
      case "mentoring":
        menteeMeetings[m]++;
        menteesByMonth[m].add(appt.ClientID);
        if (whitelist.size === 0 || whitelist.has(appt.CoachID)) {
          mentorsByMonth[m].add(appt.CoachID);
        }
        break;
    }
  }

  return {
    year,
    months: MONTHS,
    shortMonths: SHORT_MONTHS,
    discoveryPhone,
    discoveryZoom,
    menteeMeetings,
    activeMentees: menteesByMonth.map((s) => s.size),
    activeMentors: mentorsByMonth.map((s) => s.size),
    meta: {
      appointmentsConsidered,
      excludedClients: [...excludedClients].sort(),
      uncategorizedAppointmentNames: [...uncategorized].sort(),
      unmatchedClientIds: [...unmatchedClientIds].sort((a, b) => a - b),
      computedAt: new Date().toISOString(),
      dateRange: { from: `${year}-01-01`, to: `${year}-12-31` },
      endMonth,
    },
  };
}
