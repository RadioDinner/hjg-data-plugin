// CoachAccountable entity shapes (read-only) and the report payloads the
// dashboard consumes. CA field names mirror the API; our derived shapes use
// camelCase. Anything marked "unconfirmed" must be verified on first real call.

export interface CACoach {
  ID: number;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  isActive?: boolean;
}

export interface CAClient {
  ID: number;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  isActive?: boolean;
}

export type CAAppointmentStatus = "A" | "C" | "P" | "D";

export interface CAAppointment {
  ID: number;
  CoachID: number;
  ClientID: number;
  EngagementID?: number;
  name: string;
  startDate: string; // e.g. "2026-01-31 09:00:00" in the account timezone (unconfirmed)
  endDate?: string;
  status: CAAppointmentStatus;
}

export interface CAAppointmentType {
  CoachID: number;
  name: string;
  [k: string]: unknown;
}

export interface CAOffering {
  ID: number;
  name: string;
  [k: string]: unknown;
}

// "Submissions" = signups and/or purchases for an Offering.
export interface CAOfferingSubmission {
  ID: number;
  OfferingID: number;
  ClientID: number;
  ClientInvoiceID?: number;
  offeringName: string;
  clientName?: string;
  clientEmail?: string;
  amountPaid: number;
  trackingData?: string;
  dateAdded: string; // "YYYY-MM-DD ..." (unconfirmed exact format)
}

// --- Derived / report shapes ---

export type AppointmentCategory =
  | "mentoring"
  | "discoveryPhone"
  | "discoveryZoom"
  | "excluded"
  | "other";

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
    endMonth: number; // 1-indexed, inclusive
  };
}

export interface FunnelStage {
  key: "leads" | "converted" | "active" | "graduated";
  label: string;
  count: number | null; // null = not computable from CA data yet (needs a rule)
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

export interface FunnelReport {
  year: number;
  funnel: FunnelStage[];
  conversionRates: {
    leadsToConverted: number | null; // 0..1
  };
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
