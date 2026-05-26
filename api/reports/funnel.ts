import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withApi } from "../../lib/http.js";
import { getAdminClient } from "../../lib/supabase-admin.js";
import { computeFunnelReport } from "../../lib/funnel.js";
import { budgetStatus } from "../../lib/budget.js";
import type {
  CAAppointment,
  CAClient,
  CAAppointmentStatus,
  CAOfferingSubmission,
  CaAppointmentRow,
  CaClientRow,
  CaOfferingSubmissionRow,
  FunnelReport,
} from "../../lib/types.js";

const TZ = process.env.BUDGET_TZ || "America/Chicago";

function nowParts(): { year: number; month1: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [y, m] = fmt.split("-");
  return { year: Number(y), month1: Number(m) };
}

function parseIntParam(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

// Page through a table to avoid Supabase's default 1000-row cap silently
// truncating a busy year (the same undercount risk CA pagination poses).
async function fetchAll<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  filter: (year: number) => Record<string, number> | null,
  year: number
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = admin.from(table).select(columns).order("id", { ascending: true }).range(from, from + pageSize - 1);
    const f = filter(year);
    if (f) {
      for (const [k, v] of Object.entries(f)) q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) throw new Error(`read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function lastSuccessfulSync(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("sync_runs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.finished_at as string | undefined) ?? null;
}

export default withApi(
  async (req: VercelRequest, res: VercelResponse) => {
    const now = nowParts();
    const year = parseIntParam(req.query.year) ?? now.year;
    const defaultEndMonth = year === now.year ? now.month1 : 12;
    const endMonth = Math.min(12, Math.max(1, parseIntParam(req.query.endMonth) ?? defaultEndMonth));

    const admin = getAdminClient();

    const [apptRows, clientRows, subRows, budget, lastSync] = await Promise.all([
      fetchAll<CaAppointmentRow>(admin, "ca_appointments", "*", (y) => ({ start_year: y }), year),
      fetchAll<CaClientRow>(admin, "ca_clients", "id,name,first_name,last_name", () => null, year),
      fetchAll<CaOfferingSubmissionRow>(admin, "ca_offering_submissions", "*", (y) => ({ date_year: y }), year),
      budgetStatus(admin),
      lastSuccessfulSync(admin),
    ]);

    const appointments: CAAppointment[] = apptRows.map((r) => ({
      ID: r.id,
      CoachID: r.coach_id ?? 0,
      ClientID: r.client_id ?? 0,
      EngagementID: r.engagement_id ?? undefined,
      name: r.name,
      startDate: r.start_raw ?? r.start_date ?? "",
      status: r.status as CAAppointmentStatus,
    }));

    const clients = new Map<number, CAClient>(
      clientRows.map((r) => [
        r.id,
        { ID: r.id, firstName: r.first_name ?? undefined, lastName: r.last_name ?? undefined, name: r.name ?? undefined },
      ])
    );

    const submissions: CAOfferingSubmission[] = subRows.map((r) => ({
      ID: r.id,
      OfferingID: r.offering_id ?? 0,
      ClientID: r.client_id ?? 0,
      offeringName: r.offering_name ?? "",
      amountPaid: Number(r.amount_paid) || 0,
      dateAdded: r.date_added_raw ?? r.date_added ?? "",
    }));

    const ageSeconds = lastSync ? Math.max(0, Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000)) : 0;
    const warnings: string[] = [];
    if (!lastSync) warnings.push("no_sync_yet");

    const report: FunnelReport = computeFunnelReport(appointments, clients, submissions, {
      year,
      endMonth,
      stale: false,
      snapshotAgeSeconds: ageSeconds,
      budget: { capDaily: budget.capDaily, usedToday: budget.usedToday, remainingToday: budget.remainingToday },
      warnings,
    });

    // computedAt reflects the data's freshness: the last successful sync.
    if (lastSync) report.meta.computedAt = lastSync;

    res.status(200).json(report);
  },
  { auth: "user", cacheTtl: 0 }
);
