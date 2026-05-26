import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../lib/http.js";
import { getAdminClient, hasSupabaseAdminEnv } from "../lib/supabase-admin.js";
import { budgetStatus } from "../lib/budget.js";

export default withApi(
  async (_req: VercelRequest, res: VercelResponse) => {
    const env = {
      hasSupabase: hasSupabaseAdminEnv(),
      hasCAApiId: Boolean(process.env.CA_API_ID),
      hasCAApiKey: Boolean(process.env.CA_API_KEY),
    };

    let budget: { capDaily: number; usedToday: number; remainingToday: number } | null = null;
    let lastSync: { finished_at: string | null; status: string } | null = null;

    if (env.hasSupabase) {
      try {
        const admin = getAdminClient();
        const [b, sync] = await Promise.all([
          budgetStatus(admin),
          admin
            .from("sync_runs")
            .select("status,finished_at")
            .order("started_at", { ascending: false })
            .limit(1),
        ]);
        budget = { capDaily: b.capDaily, usedToday: b.usedToday, remainingToday: b.remainingToday };
        const row = sync.data?.[0];
        if (row) lastSync = { finished_at: (row.finished_at as string | null) ?? null, status: row.status as string };
      } catch {
        // health stays "ok:true" but with null budget/lastSync if the DB is unreachable
      }
    }

    res.status(200).json({
      ok: true,
      service: "hjg-data-hub",
      env,
      budget,
      lastSync,
      timestamp: new Date().toISOString(),
    });
  },
  { auth: "none", cacheTtl: 0 }
);
