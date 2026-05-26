// Sales/engagement funnel computation. Pure (no I/O). Builds on the monthly
// metrics plus offering submissions. Graduation is intentionally null until HJG
// defines a rule (CoachAccountable has no graduation field).

import { computeMonthlyMetrics, caDateParts, type ComputeOptions } from "./metrics.js";
import { categorizeAppointmentName, isExcludedClientName, GRADUATION_RULE } from "./config.js";
import type {
  CAAppointment,
  CAClient,
  CAOfferingSubmission,
  FunnelReport,
  FunnelStage,
  SalesByOffering,
  SalesSummary,
} from "./types.js";

function clientFullName(c: CAClient | undefined): { full: string; first?: string; last?: string } {
  if (!c) return { full: "" };
  const full = c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" ");
  return { full, first: c.firstName, last: c.lastName };
}

function inWindow(appt: CAAppointment, year: number, endMonth: number): boolean {
  if (appt.status !== "A") return false;
  const p = caDateParts(appt.startDate);
  return !!p && p.year === year && p.month1 <= endMonth;
}

function isExcludedAppointmentClient(appt: CAAppointment, clients: Map<number, CAClient>): boolean {
  const { full, first, last } = clientFullName(clients.get(appt.ClientID));
  return Boolean(full && isExcludedClientName(full, first, last));
}

function computeSales(
  submissions: CAOfferingSubmission[],
  year: number,
  endMonth: number
): SalesSummary {
  const unitsByMonth = Array<number>(12).fill(0);
  const revenueByMonth = Array<number>(12).fill(0);
  const byOffering = new Map<number, SalesByOffering>();
  let totalUnits = 0;
  let totalRevenue = 0;

  for (const s of submissions) {
    const p = caDateParts(s.dateAdded);
    if (!p || p.year !== year || p.month1 > endMonth) continue;
    const m = p.month1 - 1;
    const amount = Number(s.amountPaid) || 0;

    unitsByMonth[m]++;
    revenueByMonth[m] += amount;
    totalUnits++;
    totalRevenue += amount;

    const existing = byOffering.get(s.OfferingID);
    if (existing) {
      existing.units++;
      existing.revenue += amount;
    } else {
      byOffering.set(s.OfferingID, {
        offeringId: s.OfferingID,
        offeringName: s.offeringName,
        units: 1,
        revenue: amount,
      });
    }
  }

  return {
    totalUnits,
    totalRevenue: round2(totalRevenue),
    unitsByMonth,
    revenueByMonth: revenueByMonth.map(round2),
    byOffering: [...byOffering.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeFunnelReport(
  appointments: CAAppointment[],
  clients: Map<number, CAClient>,
  submissions: CAOfferingSubmission[],
  opts: ComputeOptions & {
    stale?: boolean;
    snapshotAgeSeconds?: number;
    budget?: { capDaily: number; usedToday: number; remainingToday: number };
    warnings?: string[];
  }
): FunnelReport {
  const { year, endMonth } = opts;
  const metrics = computeMonthlyMetrics(appointments, clients, opts);

  // Stage sets, computed over the active window, excluding placeholder clients.
  const leadClients = new Set<number>();
  const mentoringClients = new Set<number>();
  for (const appt of appointments) {
    if (!inWindow(appt, year, endMonth)) continue;
    if (isExcludedAppointmentClient(appt, clients)) continue;
    const cat = categorizeAppointmentName(appt.name);
    if (cat === "discoveryPhone" || cat === "discoveryZoom") leadClients.add(appt.ClientID);
    else if (cat === "mentoring") mentoringClients.add(appt.ClientID);
  }

  // Converted = leads who also became mentees (had >=1 mentoring appointment).
  let converted = 0;
  for (const id of leadClients) if (mentoringClients.has(id)) converted++;

  const leads = leadClients.size;
  const active = mentoringClients.size;

  const graduated: number | null = GRADUATION_RULE === null ? null : 0;

  const funnel: FunnelStage[] = [
    { key: "leads", label: "Discovery calls (leads)", count: leads },
    {
      key: "converted",
      label: "Converted to mentee",
      count: converted,
      note: "Leads who later had at least one mentoring appointment this period.",
    },
    { key: "active", label: "Active mentees", count: active },
    {
      key: "graduated",
      label: "Graduated",
      count: graduated,
      note:
        graduated === null
          ? "Not a CoachAccountable field. Define a rule in lib/config.ts (GRADUATION_RULE) to enable."
          : undefined,
    },
  ];

  const warnings = [...(opts.warnings ?? [])];
  if (graduated === null) warnings.push("graduation_undefined");
  if (metrics.meta.uncategorizedAppointmentNames.length > 0) {
    warnings.push("uncategorized_appointment_types_present");
  }

  return {
    year,
    funnel,
    conversionRates: {
      leadsToConverted: leads > 0 ? round2(converted / leads) : null,
    },
    sales: computeSales(submissions, year, endMonth),
    metrics,
    meta: {
      computedAt: new Date().toISOString(),
      stale: opts.stale ?? false,
      snapshotAgeSeconds: opts.snapshotAgeSeconds ?? 0,
      budget: opts.budget ?? { capDaily: 0, usedToday: 0, remainingToday: 0 },
      warnings,
    },
  };
}
