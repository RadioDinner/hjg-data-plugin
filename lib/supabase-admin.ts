// Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS and
// must NEVER be imported into browser code. Used by the sync job to write the
// CA mirror tables and by report endpoints to read them.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class SupabaseConfigError extends Error {
  constructor() {
    super("Supabase server credentials are not configured");
    this.name = "SupabaseConfigError";
  }
}

let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SupabaseConfigError();
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function hasSupabaseAdminEnv(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
