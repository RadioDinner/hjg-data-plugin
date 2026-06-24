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
  CoachID?: number; // the client's PRIMARY coach (CA's "managed by" pairing)
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
  dateAdded?: string; // when the appointment was booked (signup date)
  status: CAAppointmentStatus;
  // Whether CA has credited this appointment against its Engagement's allocation:
  //   1  = DOES count (a delivered session toward what the mentee paid for)
  //  -1  = does NOT count
  //   0  = no judgement applied yet
  // This is CA's closest signal to "the session actually happened." See docs/
  // coachaccountable-api.md (Appointment.getAll return values).
  countsInEngagement?: number;
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

// A CoachAccountable Engagement (Engagement.getAll). Often one per program tier
// (JumpStart / 4x / 2x / 1x); `name` likely carries the tier. Close state comes
// from isComplete/isCanceled + dateClosed. AppointmentSet is omitted — we
// already mirror appointments with their EngagementID.
export interface CAEngagement {
  ID: number;
  type?: string;
  ClientID?: number;
  CompanyID?: number;
  CoachID?: number;
  withName?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  allocationUnits?: string; // "A" appointments or "M" minutes
  allocation?: number;
  allocationUsedP?: number;
  allocationUsedA?: number;
  allocationUsedV?: number;
  allocationPerClient?: number;
  isComplete?: boolean;
  isCanceled?: boolean;
  dateClosed?: string;
  dateAdded?: string;
}

// Invoice line item and payment, as nested in Invoice.getAll / Invoice.get.
export interface CAInvoiceLineItem {
  item?: string;
  amount?: number;
}
export interface CAInvoicePayment {
  datePaid?: string;
  amount?: number;
  method?: string;
  checkNumber?: string;
}

// A CoachAccountable Invoice (Invoice.getAll). For HJG this is typically one per
// mentee per month for their subscription tier. `dateOf` is the service date
// (which month the revenue belongs to); `amount` is billed, `amountPaid` is
// collected so far.
export interface CAInvoice {
  ID: number;
  invoiceNumber?: string;
  dateAdded?: string;
  dateOf?: string;
  dateDue?: string;
  currency?: string;
  amount?: number;
  amountPaid?: number;
  taxRate?: number;
  ClientID?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  CompanyID?: number;
  companyName?: string;
  lineItemSet?: CAInvoiceLineItem[];
  paymentSet?: CAInvoicePayment[];
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
  | "group"
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
  coach_id: number | null; // CA Client.CoachID = primary coach (the mentee's owner)
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
  // CA Appointment.countsInEngagement: 1 = credited toward the engagement
  // (delivered), -1 = explicitly not counted, 0 = no judgement yet, null = not
  // yet synced. The delivery signal behind "did the paid-for sessions happen?".
  counts_in_engagement: number | null;
  start_raw: string | null;
  start_date: string | null; // YYYY-MM-DD (account-local)
  start_year: number | null;
  start_month: number | null; // 1..12
  date_added_raw: string | null;
  date_added: string | null; // YYYY-MM-DD (account-local) — booking/signup date
  date_added_year: number | null;
  date_added_month: number | null;
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

export interface CaEngagementRow {
  id: number;
  type: string | null;
  client_id: number | null;
  company_id: number | null;
  coach_id: number | null;
  with_name: string | null;
  name: string | null;
  start_raw: string | null;
  start_date: string | null;
  end_raw: string | null;
  end_date: string | null;
  allocation_units: string | null;
  allocation: number | null;
  allocation_used_a: number | null;
  allocation_used_p: number | null;
  allocation_used_v: number | null;
  allocation_per_client: number | null;
  is_complete: boolean | null;
  is_canceled: boolean | null;
  date_closed_raw: string | null;
  date_closed: string | null;
  date_added_raw: string | null;
  date_added: string | null;
  synced_at?: string;
}

export interface CaInvoiceRow {
  id: number;
  invoice_number: string | null;
  client_id: number | null;
  company_id: number | null;
  first_name: string | null;
  last_name: string | null;
  client_name: string | null;
  email: string | null;
  company_name: string | null;
  currency: string | null;
  amount: number | null;
  amount_paid: number | null;
  tax_rate: number | null;
  date_added_raw: string | null;
  date_added: string | null;
  date_of_raw: string | null;
  date_of: string | null;
  date_of_year: number | null;
  date_of_month: number | null;
  date_due_raw: string | null;
  date_due: string | null;
  line_items: CAInvoiceLineItem[] | null;
  payments: CAInvoicePayment[] | null;
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
