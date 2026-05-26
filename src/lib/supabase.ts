// Browser Supabase client using the public ANON/publishable key. Safe to ship to
// the browser: row-level security in the database governs what each signed-in
// user can read and write. This client carries the logged-in user's session.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// When env is missing (e.g. a misconfigured deploy) we still construct a client
// with placeholder values so imports don't throw at module load; calls will fail
// clearly and the UI surfaces a "not configured" message instead.
export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key"
);
