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

// --- Database row shapes (Postgres mirror + HJG-owned tables) ---
// Mirror tables: written only by the sync job (service role); read by everyone.

export interface CaCoachRow {
  id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_active: boolean | null;
  synced_at?: string;
}

export interface CaClientRow {
  id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_active: boolean | null;
  is_excluded: boolean;
  synced_at?: string;
}

export interface CaAppointmentRow {
  id: number;
  coach_id: number | null;
  client_id: number | null;
  engagement_id: number | null;
  name: string;
  category: AppointmentCategory;
  status: string;
  start_raw: string | null;
  start_date: string | null; // YYYY-MM-DD (account-local)
  start_year: number | null;
  start_month: number | null; // 1..12
  synced_at?: string;
}

export interface CaOfferingRow {
  id: number;
  name: string;
  synced_at?: string;
}

export interface CaOfferingSubmissionRow {
  id: number;
  offering_id: number | null;
  client_id: number | null;
  client_invoice_id: number | null;
  offering_name: string | null;
  client_name: string | null;
  client_email: string | null;
  amount_paid: number;
  tracking_data: string | null;
  date_added_raw: string | null;
  date_added: string | null;
  date_year: number | null;
  date_month: number | null;
  synced_at?: string;
}

export type SyncTrigger = "manual" | "scheduled";
export type SyncStatus = "running" | "success" | "error";

export interface SyncRunRow {
  id: string;
  trigger: SyncTrigger;
  status: SyncStatus;
  started_at: string;
  finished_at: string | null;
  calls_made: number;
  records_synced: number;
  error: string | null;
}

// HJG-owned tables (edited by signed-in staff).

export type CadenceTier = "4x" | "2x" | "1x" | "graduated";
export type DiscoveryOutcomeValue = "converted" | "not_converted" | "pending" | "no_show";

export interface GraduationRow {
  id: string;
  client_id: number;
  graduated_on: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveryOutcomeRow {
  id: string;
  client_id: number;
  appointment_id: number | null;
  outcome: DiscoveryOutcomeValue;
  follow_up_on: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CadenceStatusRow {
  id: string;
  client_id: number;
  tier: CadenceTier;
  effective_from: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}
