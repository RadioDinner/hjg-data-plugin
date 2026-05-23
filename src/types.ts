// Frontend mirror of the /api/reports/funnel response shape.

export interface FunnelStage {
  key: "leads" | "converted" | "active" | "graduated";
  label: string;
  count: number | null;
  note?: string;
}

export interface SalesByOffering {
  offeringId: number;
  offeringName: string;
  units: number;
  revenue: number;
}

export interface SalesSummary {
  totalUnits: number;
  totalRevenue: number;
  unitsByMonth: number[];
  revenueByMonth: number[];
  byOffering: SalesByOffering[];
}

export interface MonthlyMetrics {
  year: number;
  months: string[];
  shortMonths: string[];
  discoveryPhone: number[];
  discoveryZoom: number[];
  menteeMeetings: number[];
  activeMentees: number[];
  activeMentors: number[];
  meta: {
    appointmentsConsidered: number;
    excludedClients: string[];
    uncategorizedAppointmentNames: string[];
    unmatchedClientIds: number[];
    computedAt: string;
    dateRange: { from: string; to: string };
    endMonth: number;
  };
}

export interface FunnelReport {
  year: number;
  funnel: FunnelStage[];
  conversionRates: { leadsToConverted: number | null };
  sales: SalesSummary;
  metrics: MonthlyMetrics;
  meta: {
    computedAt: string;
    stale: boolean;
    snapshotAgeSeconds: number;
    budget: { capDaily: number; usedToday: number; remainingToday: number };
    warnings: string[];
  };
}

export type DataSource = "live" | "mock";
