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

// --- Mentee meetings (individual mentoring appointments, for type filtering) ---

export interface MeetingAppt {
  id: number;
  name: string;
  month: number | null;
  date: string | null;
  clientId: number | null;
  clientName: string;
  coachId: number | null;
  coachName: string;
}

// Mentoring-category appointments for a year (status active), with placeholder /
// group clients excluded — the same population the menteeMeetings count uses,
// but kept per-row (with prospect/mentor names) so the dashboard can break them
// down by type and drill into the raw rows.
export async function fetchMentoringAppointments(year: number): Promise<MeetingAppt[]> {
  const pageSize = 1000;
  const rows: {
    id: number;
    name: string;
    start_month: number | null;
    start_date: string | null;
    client_id: number | null;
    coach_id: number | null;
  }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select("id,name,start_month,start_date,client_id,coach_id")
      .eq("category", "mentoring")
      .eq("start_year", year)
      .eq("status", "A")
      .order("start_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

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
      name: r.name,
      month: r.start_month,
      date: r.start_date,
      clientId: r.client_id,
      clientName: (r.client_id != null ? clientMap.get(r.client_id)?.name : null) ?? (r.client_id != null ? `#${r.client_id}` : "Unknown"),
      coachId: r.coach_id,
      coachName: (r.coach_id != null ? coachMap.get(r.coach_id) : null) ?? (r.coach_id != null ? `#${r.coach_id}` : "Unknown"),
    }));
}

// --- Raw data viewer ---

export const RAW_TABLES = [
  "ca_appointments",
  "ca_clients",
  "ca_coaches",
  "ca_offerings",
  "ca_offering_submissions",
  "discovery_outcomes",
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
