import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../lib/http.js";
import { getAdminClient } from "../lib/supabase-admin.js";
import { budgetStatus } from "../lib/budget.js";

// Observability for the CA-call cap and today's sync usage. No CA call.
export default withApi(
  async (_req: VercelRequest, res: VercelResponse) => {
    const admin = getAdminClient();
    const [b, lastRuns] = await Promise.all([
      budgetStatus(admin),
      admin
        .from("sync_runs")
        .select("id,trigger,status,started_at,finished_at,calls_made,records_synced,error")
        .order("started_at", { ascending: false })
        .limit(5),
    ]);
    res.status(200).json({
      capDaily: b.capDaily,
      usedToday: b.usedToday,
      remainingToday: b.remainingToday,
      planDailyLimit: b.planDailyLimit,
      capPct: b.capPct,
      recentRuns: lastRuns.data ?? [],
    });
  },
  { auth: "user", cacheTtl: 0 }
);
