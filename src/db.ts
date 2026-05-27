// Browser-side data access. The dashboard reads the CA mirror and reads/writes
// discovery outcomes directly via supabase-js; row-level security enforces that
// only signed-in staff can touch them.

import { supabase } from "./lib/supabase";

export type DiscoveryOutcomeValue = "converted" | "not_converted" | "pending" | "no_show";

// A discovery-call appointment pulled from the CA mirror, joined with whatever
// outcome staff have recorded against it.
export interface DiscoveryCall {
  appointmentId: number;
  clientId: number | null;
  prospect: string;
  type: "phone" | "zoom" | "other";
  date: string | null; // YYYY-MM-DD (account-local)
  month: number | null;
  outcomeId: string | null;
  outcome: DiscoveryOutcomeValue | null;
  followUpOn: string | null;
  notes: string | null;
}

export interface SyncRun {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  calls_made: number;
  records_synced: number;
  error: string | null;
}

function err<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

// --- Discovery calls (mirror appointments + recorded outcomes) ---

export async function fetchDiscoveryCalls(year: number): Promise<DiscoveryCall[]> {
  const appts = err<
    { id: number; client_id: number | null; category: string; start_date: string | null; start_month: number | null }[]
  >(
    await supabase
      .from("ca_appointments")
      .select("id,client_id,category,start_date,start_month")
      .in("category", ["discoveryPhone", "discoveryZoom"])
      .eq("start_year", year)
      .eq("status", "A")
      .order("start_date", { ascending: false })
  );

  const clientIds = [...new Set(appts.map((a) => a.client_id).filter((x): x is number => x != null))];
  const clientRows = clientIds.length
    ? err<{ id: number; name: string | null; is_excluded: boolean }[]>(
        await supabase.from("ca_clients").select("id,name,is_excluded").in("id", clientIds)
      )
    : [];
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));

  const apptIds = appts.map((a) => a.id);
  const outcomeRows = apptIds.length
    ? err<
        { id: string; appointment_id: number; outcome: DiscoveryOutcomeValue; follow_up_on: string | null; notes: string | null }[]
      >(
        await supabase
          .from("discovery_outcomes")
          .select("id,appointment_id,outcome,follow_up_on,notes")
          .in("appointment_id", apptIds)
      )
    : [];
  const outcomeMap = new Map(outcomeRows.map((o) => [o.appointment_id, o]));

  const calls: DiscoveryCall[] = [];
  for (const a of appts) {
    const client = a.client_id != null ? clientMap.get(a.client_id) : undefined;
    if (client?.is_excluded) continue; // skip placeholder / group "clients"
    const o = outcomeMap.get(a.id);
    calls.push({
      appointmentId: a.id,
      clientId: a.client_id,
      prospect: client?.name ?? (a.client_id != null ? `#${a.client_id}` : "Unknown"),
      type: a.category === "discoveryPhone" ? "phone" : a.category === "discoveryZoom" ? "zoom" : "other",
      date: a.start_date,
      month: a.start_month,
      outcomeId: o?.id ?? null,
      outcome: o?.outcome ?? null,
      followUpOn: o?.follow_up_on ?? null,
      notes: o?.notes ?? null,
    });
  }
  return calls;
}

export async function setDiscoveryOutcome(
  createdBy: string,
  call: { appointmentId: number; clientId: number; existingId: string | null },
  values: { outcome: DiscoveryOutcomeValue; followUpOn: string | null; notes: string | null }
): Promise<void> {
  if (call.existingId) {
    const { error } = await supabase
      .from("discovery_outcomes")
      .update({ outcome: values.outcome, follow_up_on: values.followUpOn, notes: values.notes })
      .eq("id", call.existingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("discovery_outcomes").insert({
      appointment_id: call.appointmentId,
      client_id: call.clientId,
      outcome: values.outcome,
      follow_up_on: values.followUpOn,
      notes: values.notes,
      created_by: createdBy,
    });
    if (error) throw new Error(error.message);
  }
}

// --- Appointments in a date range (powers the Metrics dashboard) ---

export type ApptCategory = "mentoring" | "discoveryPhone" | "discoveryZoom";

export interface RangeAppt {
  id: number;
  category: ApptCategory;
  name: string;
  date: string | null; // YYYY-MM-DD (account-local)
  clientId: number | null;
  clientName: string;
  coachId: number | null;
  coachName: string;
}

// Page ca_appointments for the given categories, filtering/normalizing on the
// supplied date column. `date` in the result is the column we counted by.
async function pageAppts(
  categories: ApptCategory[],
  dateCol: "start_date" | "date_added",
  from: string,
  to: string
): Promise<{ id: number; category: ApptCategory; name: string; date: string | null; client_id: number | null; coach_id: number | null }[]> {
  const pageSize = 1000;
  const out: { id: number; category: ApptCategory; name: string; date: string | null; client_id: number | null; coach_id: number | null }[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select(`id,category,name,client_id,coach_id,${dateCol}`)
      .in("category", categories)
      .eq("status", "A")
      .gte(dateCol, from)
      .lte(dateCol, to)
      .order(dateCol, { ascending: true })
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    for (const r of batch) {
      out.push({
        id: r.id as number,
        category: r.category as ApptCategory,
        name: r.name as string,
        date: (r[dateCol] as string | null) ?? null,
        client_id: (r.client_id as number | null) ?? null,
        coach_id: (r.coach_id as number | null) ?? null,
      });
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

// Discovery appointments counted by SIGNUP date (date_added), falling back to
// the scheduled date when date_added isn't populated yet (e.g. before a re-sync
// backfills it), so the metric is never blank during the transition.
async function pageDiscovery(
  from: string,
  to: string
): Promise<{ id: number; category: ApptCategory; name: string; date: string | null; client_id: number | null; coach_id: number | null }[]> {
  const pageSize = 1000;
  const out: { id: number; category: ApptCategory; name: string; date: string | null; client_id: number | null; coach_id: number | null }[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select("id,category,name,client_id,coach_id,start_date,date_added")
      .in("category", ["discoveryPhone", "discoveryZoom"])
      .eq("status", "A")
      .or(
        `and(date_added.gte.${from},date_added.lte.${to}),and(date_added.is.null,start_date.gte.${from},start_date.lte.${to})`
      )
      .order("id", { ascending: true })
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    for (const r of batch) {
      out.push({
        id: r.id as number,
        category: r.category as ApptCategory,
        name: r.name as string,
        date: ((r.date_added as string | null) ?? (r.start_date as string | null)) ?? null,
        client_id: (r.client_id as number | null) ?? null,
        coach_id: (r.coach_id as number | null) ?? null,
      });
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

// Appointments that count within [from, to] (inclusive, YYYY-MM-DD), status
// active, placeholder/group clients excluded, enriched with prospect/mentor
// names. Mentee meetings are counted by the SCHEDULED date; discovery calls are
// counted by the SIGNUP/booking date (dateAdded). `date` carries whichever date
// the row is counted by.
export async function fetchRangeAppointments(from: string, to: string): Promise<RangeAppt[]> {
  const [mentoring, discovery] = await Promise.all([
    pageAppts(["mentoring"], "start_date", from, to),
    pageDiscovery(from, to),
  ]);
  const rows = [...mentoring, ...discovery];

  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((x): x is number => x != null))];
  const coachIds = [...new Set(rows.map((r) => r.coach_id).filter((x): x is number => x != null))];

  const clientMap = new Map<number, { name: string | null; is_excluded: boolean }>();
  if (clientIds.length) {
    const { data, error } = await supabase.from("ca_clients").select("id,name,is_excluded").in("id", clientIds);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { id: number; name: string | null; is_excluded: boolean }[]) {
      clientMap.set(c.id, { name: c.name, is_excluded: c.is_excluded });
    }
  }

  const coachMap = new Map<number, string | null>();
  if (coachIds.length) {
    const { data, error } = await supabase.from("ca_coaches").select("id,name").in("id", coachIds);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { id: number; name: string | null }[]) coachMap.set(c.id, c.name);
  }

  return rows
    .filter((r) => r.client_id == null || !clientMap.get(r.client_id)?.is_excluded)
    .map((r) => ({
      id: r.id,
      category: r.category,
      name: r.name,
      date: r.date,
      clientId: r.client_id,
      clientName:
        (r.client_id != null ? clientMap.get(r.client_id)?.name : null) ??
        (r.client_id != null ? `#${r.client_id}` : "Unknown"),
      coachId: r.coach_id,
      coachName: (r.coach_id != null ? coachMap.get(r.coach_id) : null) ?? (r.coach_id != null ? `#${r.coach_id}` : "Unknown"),
    }));
}

// Recorded outcomes for the given appointment ids, keyed by appointment id.
export async function fetchOutcomesByAppointment(apptIds: number[]): Promise<Map<number, DiscoveryOutcomeValue>> {
  const out = new Map<number, DiscoveryOutcomeValue>();
  const chunk = 200;
  for (let i = 0; i < apptIds.length; i += chunk) {
    const slice = apptIds.slice(i, i + chunk);
    if (!slice.length) break;
    const { data, error } = await supabase
      .from("discovery_outcomes")
      .select("appointment_id,outcome")
      .in("appointment_id", slice);
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { appointment_id: number | null; outcome: DiscoveryOutcomeValue }[]) {
      if (o.appointment_id != null) out.set(o.appointment_id, o.outcome);
    }
  }
  return out;
}

// Timestamp of the most recent successful sync (data freshness).
export async function fetchLastSyncedAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.finished_at as string | undefined) ?? null;
}

// --- Manual metrics (board numbers with no CoachAccountable source) ---
// Staff enter one count per metric per month on the Admin tab; the Metrics
// dashboard sums them over its date range. Add a metric here (key must match
// what's stored in manual_metrics.metric) and it shows up in both places — no
// migration needed.

export interface ManualMetricDef {
  key: string;
  label: string; // full label (charts, tables, Admin field)
  short: string; // compact KPI-card label
}

export const MANUAL_METRICS: ManualMetricDef[] = [
  { key: "triggers_pdf_downloads", label: "“Identify Your Triggers” downloads", short: "Triggers PDF downloads" },
  { key: "sast_worksheets", label: "SAST worksheets completed", short: "SAST worksheets" },
];

export interface ManualMetricRow {
  id: string;
  metric: string;
  periodMonth: string; // YYYY-MM-01
  value: number;
  notes: string | null;
}

// First day of the month containing the given YYYY-MM-DD (or YYYY-MM) date.
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

// Every manual-metric entry whose month falls within [from, to] (inclusive).
// period_month is always a day-1 date, so comparing it directly against the
// range bounds buckets each entry into the right month.
export async function fetchManualMetrics(from: string, to: string): Promise<ManualMetricRow[]> {
  const { data, error } = await supabase
    .from("manual_metrics")
    .select("id,metric,period_month,value,notes")
    .gte("period_month", monthStart(from))
    .lte("period_month", to)
    .order("period_month", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; metric: string; period_month: string; value: number; notes: string | null }[]).map(
    (r) => ({ id: r.id, metric: r.metric, periodMonth: r.period_month, value: r.value, notes: r.notes })
  );
}

// Values for a single month (YYYY-MM), keyed by metric — prefills the editor.
export async function fetchManualMetricsForMonth(monthYm: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("manual_metrics")
    .select("metric,value")
    .eq("period_month", monthStart(monthYm));
  if (error) throw new Error(error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { metric: string; value: number }[]) out.set(r.metric, r.value);
  return out;
}

// Insert or update the count for one metric in one month (YYYY-MM).
export async function upsertManualMetric(
  createdBy: string,
  metric: string,
  monthYm: string,
  value: number
): Promise<void> {
  const { error } = await supabase
    .from("manual_metrics")
    .upsert(
      { metric, period_month: monthStart(monthYm), value, created_by: createdBy || null },
      { onConflict: "metric,period_month" }
    );
  if (error) throw new Error(error.message);
}

// --- Raw data viewer ---

export const RAW_TABLES = [
  "ca_appointments",
  "ca_clients",
  "ca_coaches",
  "ca_offerings",
  "ca_offering_submissions",
  "discovery_outcomes",
  "manual_metrics",
  "sync_runs",
] as const;

export type RawTable = (typeof RAW_TABLES)[number];

export async function fetchTable(
  table: RawTable,
  limit = 100
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const { data, error, count } = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return { rows, total: count ?? rows.length };
}

// --- Sync runs + settings (Admin) ---

export async function listSyncRuns(limit = 10): Promise<SyncRun[]> {
  return err<SyncRun[]>(
    await supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(limit)
  );
}

export async function fetchSettings(): Promise<Record<string, number | null>> {
  const rows = err<{ key: string; value: number | null }[]>(await supabase.from("app_settings").select("key,value"));
  const out: Record<string, number | null> = {};
  for (const r of rows) out[r.key] = (r.value as number | null) ?? null;
  return out;
}

export async function updateSetting(key: string, value: number | null): Promise<void> {
  const { error } = await supabase.from("app_settings").update({ value }).eq("key", key);
  if (error) throw new Error(error.message);
}
