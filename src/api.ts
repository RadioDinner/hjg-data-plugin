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

// Refreshes just the engagement-template mirror (Company options → Payment groups
// "Refresh templates"), without a full sync. Requires a signed-in session.
export async function refreshEngagementTemplates(): Promise<{ count: number }> {
  const res = await fetch(`/api/sync-templates`, { method: "POST", headers: await authHeader() });
  const body = (await res.json().catch(() => ({}))) as { count?: number; message?: string };
  if (!res.ok) throw new Error(body.message || `Refresh failed (${res.status})`);
  return { count: body.count ?? 0 };
}

export interface SendPaystubResult {
  ok: true;
  to: string;
  source: string;
  providerId: string | null;
  sentAt: string;
  logged: boolean;
}

// Emails one archived, approved pay stub (its stored PDF) to the person it
// belongs to. The server decides the recipient and re-checks the stub against
// the approved build — the browser only names the archived stub.
export async function sendPaystubEmail(paystubId: string): Promise<SendPaystubResult> {
  const res = await fetch(`/api/send-paystub`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ paystubId }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SendPaystubResult> & {
    message?: string;
  };
  if (!res.ok) throw new Error(body.message || `Email failed (${res.status})`);
  return body as SendPaystubResult;
}
