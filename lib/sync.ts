// Sync orchestration: pull CoachAccountable (read-only, budget-guarded), apply
// HJG categorization/exclusion, and upsert the ca_* mirror tables. Each run is
// recorded in sync_runs. The dashboard reads only from the mirror, never CA.

import { getAdminClient } from "./supabase-admin.js";
import { CAClient } from "./ca.js";
import { makeTracker, BudgetExhaustedError, type BudgetTracker } from "./budget.js";
import { categorizeAppointmentName, isExcludedClientName } from "./config.js";
import { caDateParts } from "./metrics.js";
import type {
  SyncTrigger,
  CaCoachRow,
  CaClientRow,
  CaAppointmentRow,
  CaOfferingRow,
  CaOfferingSubmissionRow,
  CaEngagementRow,
  CaInvoiceRow,
} from "./types.js";

export class SyncInProgressError extends Error {
  constructor() {
    super("A sync is already running");
    this.name = "SyncInProgressError";
  }
}

export interface SyncResult {
  runId: string | null;
  status: "success" | "error";
  callsMade: number;
  recordsSynced: number;
  years: number[];
  error?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateParts(raw: string | undefined): {
  date: string | null;
  year: number | null;
  month: number | null;
} {
  const p = caDateParts(raw ?? "");
  if (!p) return { date: null, year: null, month: null };
  return { date: `${p.year}-${pad2(p.month1)}-${pad2(p.day)}`, year: p.year, month: p.month1 };
}

function fullName(first?: string, last?: string, name?: string): string {
  return (name ?? [first, last].filter(Boolean).join(" ")).trim();
}

export function syncYears(): number[] {
  const env = process.env.SYNC_YEARS;
  if (env && env.trim()) {
    const years = env
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 2000 && n < 3000);
    if (years.length) return [...new Set(years)].sort((a, b) => a - b);
  }
  const current = new Date().getFullYear();
  return [current - 2, current - 1, current];
}

// Strip anything resembling the CA credentials from an error string before it is
// stored or returned.
function sanitizeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (const secret of [process.env.CA_API_ID, process.env.CA_API_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]) {
    if (secret) msg = msg.split(secret).join("[redacted]");
  }
  return msg.slice(0, 500);
}

async function chunkedUpsert<T extends object>(
  admin: ReturnType<typeof getAdminClient>,
  table: string,
  rows: T[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const size = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const { error } = await admin.from(table).upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
    written += batch.length;
  }
  return written;
}

export async function runSync(trigger: SyncTrigger): Promise<SyncResult> {
  const admin = getAdminClient();

  // Refuse to start if another run is in flight (best-effort serialization).
  const { data: running, error: runningErr } = await admin
    .from("sync_runs")
    .select("id")
    .eq("status", "running")
    .limit(1);
  if (runningErr) throw new Error(`sync_runs check: ${runningErr.message}`);
  if (running && running.length > 0) throw new SyncInProgressError();

  const { data: inserted, error: insErr } = await admin
    .from("sync_runs")
    .insert({ trigger, status: "running" })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(`sync_runs insert: ${insErr?.message ?? "no row"}`);
  const runId = inserted.id as string;

  const years = syncYears();
  const from = `${years[0]}-01-01`;
  const to = `${years[years.length - 1]}-12-31`;

  const tracker: BudgetTracker = await makeTracker(admin);
  const ca = new CAClient(() => tracker.spend());

  let records = 0;
  const warnings: string[] = [];
  try {
    // Core data, sequential to keep call accounting clean. A failure here is a
    // real error (the dashboard's headline metrics depend on it).
    const coaches = await ca.getCoaches(true);
    const clients = await ca.getClients(true);
    const appointments = await ca.getAppointments({ dateFrom: from, dateTo: to });

    const coachRows: CaCoachRow[] = coaches.map((c) => ({
      id: c.ID,
      name: fullName(c.firstName, c.lastName, c.name) || null,
      first_name: c.firstName ?? null,
      last_name: c.lastName ?? null,
      email: c.email ?? null,
      is_active: c.isActive ?? null,
    }));

    const clientRows: CaClientRow[] = clients.map((c) => {
      const full = fullName(c.firstName, c.lastName, c.name);
      return {
        id: c.ID,
        coach_id: c.CoachID ?? null, // CA primary coach = the mentee's owner
        name: full || null,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
        email: c.email ?? null,
        is_active: c.isActive ?? null,
        is_excluded: isExcludedClientName(full, c.firstName, c.lastName),
      };
    });

    const apptRows: CaAppointmentRow[] = appointments.map((a) => {
      const dp = dateParts(a.startDate);
      const da = dateParts(a.dateAdded);
      return {
        id: a.ID,
        coach_id: a.CoachID ?? null,
        client_id: a.ClientID ?? null,
        engagement_id: a.EngagementID ?? null,
        name: a.name ?? "",
        category: categorizeAppointmentName(a.name),
        status: a.status,
        counts_in_engagement: a.countsInEngagement ?? null,
        start_raw: a.startDate ?? null,
        start_date: dp.date,
        start_year: dp.year,
        start_month: dp.month,
        date_added_raw: a.dateAdded ?? null,
        date_added: da.date,
        date_added_year: da.year,
        date_added_month: da.month,
      };
    });

    records += await chunkedUpsert(admin, "ca_coaches", coachRows);
    records += await chunkedUpsert(admin, "ca_clients", clientRows);
    records += await chunkedUpsert(admin, "ca_appointments", apptRows);

    // Offerings/submissions feed only the sales panel, and the submissions
    // function name is unconfirmed (SPEC.md s7). Best-effort: a failure here
    // leaves the core sync intact and is reported as a warning, not a failure.
    // Budget exhaustion is the exception — it's a hard stop, so it propagates.
    try {
      const offerings = await ca.getOfferings();
      const submissions = await ca.getOfferingSubmissions({ dateFrom: from, dateTo: to });

      const offeringRows: CaOfferingRow[] = offerings.map((o) => ({ id: o.ID, name: o.name }));
      const submissionRows: CaOfferingSubmissionRow[] = submissions.map((s) => {
        const dp = dateParts(s.dateAdded);
        return {
          id: s.ID,
          offering_id: s.OfferingID ?? null,
          client_id: s.ClientID ?? null,
          client_invoice_id: s.ClientInvoiceID ?? null,
          offering_name: s.offeringName ?? null,
          client_name: s.clientName ?? null,
          client_email: s.clientEmail ?? null,
          amount_paid: Number(s.amountPaid) || 0,
          tracking_data: s.trackingData ?? null,
          date_added_raw: s.dateAdded ?? null,
          date_added: dp.date,
          date_year: dp.year,
          date_month: dp.month,
        };
      });

      records += await chunkedUpsert(admin, "ca_offerings", offeringRows);
      records += await chunkedUpsert(admin, "ca_offering_submissions", submissionRows);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) throw e;
      warnings.push(`Offerings/submissions skipped: ${sanitizeError(e)}`);
    }

    // Engagements feed the pipeline-stage timeline (Journeys tab). READ-ONLY:
    // only Engagement.getAll is called; nothing is written back to CA. Pulled in
    // one unfiltered request. Best-effort like offerings — a failure here leaves
    // the core sync intact and is reported as a warning. Budget exhaustion still
    // hard-stops.
    try {
      const engagements = await ca.getEngagements({ includeAppointments: false });
      const engagementRows: CaEngagementRow[] = engagements.map((e) => {
        const sd = dateParts(e.startDate);
        const ed = dateParts(e.endDate);
        const dc = dateParts(e.dateClosed);
        const da = dateParts(e.dateAdded);
        return {
          id: e.ID,
          type: e.type ?? null,
          client_id: e.ClientID ?? null,
          company_id: e.CompanyID ?? null,
          coach_id: e.CoachID ?? null,
          with_name: e.withName ?? null,
          name: e.name ?? null,
          start_raw: e.startDate ?? null,
          start_date: sd.date,
          end_raw: e.endDate ?? null,
          end_date: ed.date,
          allocation_units: e.allocationUnits ?? null,
          allocation: e.allocation ?? null,
          allocation_used_a: e.allocationUsedA ?? null,
          allocation_used_p: e.allocationUsedP ?? null,
          allocation_used_v: e.allocationUsedV ?? null,
          allocation_per_client: e.allocationPerClient ?? null,
          is_complete: e.isComplete ?? null,
          is_canceled: e.isCanceled ?? null,
          date_closed_raw: e.dateClosed ?? null,
          date_closed: dc.date,
          date_added_raw: e.dateAdded ?? null,
          date_added: da.date,
        };
      });
      records += await chunkedUpsert(admin, "ca_engagements", engagementRows);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) throw e;
      warnings.push(`Engagements skipped: ${sanitizeError(e)}`);
    }

    // Invoices feed the staff/mentor payment tool (a coach earns a % of a
    // mentee's monthly revenue). READ-ONLY: only Invoice.getAll is called.
    // `dateOf` is the service month the revenue belongs to. Best-effort like
    // engagements — a failure here leaves the core sync intact and is reported
    // as a warning. Budget exhaustion still hard-stops.
    try {
      const invoices = await ca.getInvoices({ dateFrom: from, dateTo: to });
      const invoiceRows: CaInvoiceRow[] = invoices.map((inv) => {
        const dof = dateParts(inv.dateOf);
        const dad = dateParts(inv.dateAdded);
        const ddu = dateParts(inv.dateDue);
        return {
          id: inv.ID,
          invoice_number: inv.invoiceNumber ?? null,
          client_id: inv.ClientID ?? null,
          company_id: inv.CompanyID ?? null,
          first_name: inv.firstName ?? null,
          last_name: inv.lastName ?? null,
          client_name: fullName(inv.firstName, inv.lastName) || null,
          email: inv.email ?? null,
          company_name: inv.companyName ?? null,
          currency: inv.currency ?? null,
          amount: inv.amount ?? null,
          amount_paid: inv.amountPaid ?? null,
          tax_rate: inv.taxRate ?? null,
          date_added_raw: inv.dateAdded ?? null,
          date_added: dad.date,
          date_of_raw: inv.dateOf ?? null,
          date_of: dof.date,
          date_of_year: dof.year,
          date_of_month: dof.month,
          date_due_raw: inv.dateDue ?? null,
          date_due: ddu.date,
          line_items: inv.lineItemSet ?? null,
          payments: inv.paymentSet ?? null,
        };
      });
      records += await chunkedUpsert(admin, "ca_invoices", invoiceRows);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) throw e;
      warnings.push(`Invoices skipped: ${sanitizeError(e)}`);
    }

    await admin
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        calls_made: tracker.callsMade,
        records_synced: records,
        error: warnings.length ? warnings.join(" · ") : null,
      })
      .eq("id", runId);

    return {
      runId,
      status: "success",
      callsMade: tracker.callsMade,
      recordsSynced: records,
      years,
      error: warnings.length ? warnings.join(" · ") : undefined,
    };
  } catch (e) {
    const error = sanitizeError(e);
    await admin
      .from("sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        calls_made: tracker.callsMade,
        records_synced: records,
        error,
      })
      .eq("id", runId);

    return {
      runId,
      status: "error",
      callsMade: tracker.callsMade,
      recordsSynced: records,
      years,
      error: e instanceof BudgetExhaustedError ? `Daily CA call budget reached (cap ${e.capDaily}). Partial data synced.` : error,
    };
  }
}
