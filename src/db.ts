// Browser-side data access. The dashboard reads the CA mirror and reads/writes
// the HJG-owned tables directly via supabase-js; row-level security enforces
// that only signed-in staff can touch them.

import { supabase } from "./lib/supabase";

export interface ClientOption {
  id: number;
  name: string | null;
  is_excluded: boolean;
}

export interface Graduation {
  id: string;
  client_id: number;
  graduated_on: string;
  notes: string | null;
  created_at: string;
}

export type DiscoveryOutcomeValue = "converted" | "not_converted" | "pending" | "no_show";

export interface DiscoveryOutcome {
  id: string;
  client_id: number;
  appointment_id: number | null;
  outcome: DiscoveryOutcomeValue;
  follow_up_on: string | null;
  notes: string | null;
  created_at: string;
}

export type CadenceTier = "4x" | "2x" | "1x" | "graduated";

export interface CadenceEntry {
  id: string;
  client_id: number;
  tier: CadenceTier;
  effective_from: string;
  notes: string | null;
  created_at: string;
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

export interface AppSetting {
  key: string;
  value: number | null;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

// --- CA mirror (read-only) ---

export async function fetchClients(includeExcluded = false): Promise<ClientOption[]> {
  let q = supabase.from("ca_clients").select("id,name,is_excluded").order("name", { ascending: true });
  if (!includeExcluded) q = q.eq("is_excluded", false);
  return unwrap<ClientOption[]>(await q);
}

// --- Graduations ---

export async function listGraduations(): Promise<Graduation[]> {
  return unwrap<Graduation[]>(
    await supabase.from("graduations").select("*").order("graduated_on", { ascending: false })
  );
}

export async function addGraduation(
  createdBy: string,
  row: { client_id: number; graduated_on: string; notes: string | null }
): Promise<void> {
  const { error } = await supabase.from("graduations").insert({ ...row, created_by: createdBy });
  if (error) throw new Error(error.message);
}

export async function deleteGraduation(id: string): Promise<void> {
  const { error } = await supabase.from("graduations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- Discovery outcomes ---

export async function listDiscoveryOutcomes(): Promise<DiscoveryOutcome[]> {
  return unwrap<DiscoveryOutcome[]>(
    await supabase.from("discovery_outcomes").select("*").order("created_at", { ascending: false })
  );
}

export async function addDiscoveryOutcome(
  createdBy: string,
  row: {
    client_id: number;
    outcome: DiscoveryOutcomeValue;
    follow_up_on: string | null;
    notes: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("discovery_outcomes").insert({ ...row, created_by: createdBy });
  if (error) throw new Error(error.message);
}

export async function deleteDiscoveryOutcome(id: string): Promise<void> {
  const { error } = await supabase.from("discovery_outcomes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- Cadence status (append-only history) ---

export async function listCadence(): Promise<CadenceEntry[]> {
  return unwrap<CadenceEntry[]>(
    await supabase
      .from("cadence_status_log")
      .select("*")
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false })
  );
}

export async function addCadence(
  createdBy: string,
  row: { client_id: number; tier: CadenceTier; effective_from: string; notes: string | null }
): Promise<void> {
  const { error } = await supabase.from("cadence_status_log").insert({ ...row, created_by: createdBy });
  if (error) throw new Error(error.message);
}

// --- Sync runs + settings (Admin) ---

export async function listSyncRuns(limit = 10): Promise<SyncRun[]> {
  return unwrap<SyncRun[]>(
    await supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(limit)
  );
}

export async function fetchSettings(): Promise<Record<string, number | null>> {
  const rows = unwrap<AppSetting[]>(await supabase.from("app_settings").select("key,value"));
  const out: Record<string, number | null> = {};
  for (const r of rows) out[r.key] = (r.value as number | null) ?? null;
  return out;
}

export async function updateSetting(key: string, value: number | null): Promise<void> {
  const { error } = await supabase.from("app_settings").update({ value }).eq("key", key);
  if (error) throw new Error(error.message);
}
