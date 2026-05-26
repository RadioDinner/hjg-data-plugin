import type { FunnelReport, DataSource } from "./types";
import { mockReport } from "./mock";
import { supabase } from "./lib/supabase";

const USE_MOCK = (import.meta.env.VITE_USE_MOCK as string | undefined) === "1";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ReportResult {
  report: FunnelReport;
  source: DataSource;
  error?: string;
}

// Fetches the live report (computed server-side from the Supabase mirror); falls
// back to bundled mock data when forced via VITE_USE_MOCK or when the API is
// unreachable.
export async function fetchFunnelReport(year: number): Promise<ReportResult> {
  if (USE_MOCK) return { report: mockReport(year), source: "mock" };
  try {
    const res = await fetch(`/api/reports/funnel?year=${year}`, { headers: await authHeader() });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    const report = (await res.json()) as FunnelReport;
    return { report, source: "live" };
  } catch (e) {
    return { report: mockReport(year), source: "mock", error: String(e) };
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

// Triggers a CoachAccountable -> Supabase sync. Requires a signed-in session.
export async function triggerSync(): Promise<SyncResult> {
  const res = await fetch(`/api/sync`, { method: "POST", headers: await authHeader() });
  const body = (await res.json().catch(() => ({}))) as Partial<SyncResult> & { message?: string };
  if (!res.ok) throw new Error(body.message || `Sync failed (${res.status})`);
  return body as SyncResult;
}
