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
