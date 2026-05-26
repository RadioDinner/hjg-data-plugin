import { supabase } from "./lib/supabase";

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
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

// Monthly scorecard metrics (length-12 arrays), computed server-side from the
// Supabase mirror. Mirrors the existing /api/reports/funnel response.
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
    endMonth: number;
    computedAt: string;
    appointmentsConsidered: number;
    uncategorizedAppointmentNames: string[];
  };
}

export interface Report {
  year: number;
  metrics: MonthlyMetrics;
  meta: {
    computedAt: string;
    budget: { capDaily: number; usedToday: number; remainingToday: number };
    warnings: string[];
  };
}

export async function fetchReport(year: number): Promise<Report> {
  const res = await fetch(`/api/reports/funnel?year=${year}`, { headers: await authHeader() });
  const body = (await res.json().catch(() => ({}))) as Report & { message?: string };
  if (!res.ok) throw new Error(body.message || `Failed to load metrics (${res.status})`);
  return body;
}
