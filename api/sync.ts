import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../lib/http.js";
import { runSync } from "../lib/sync.js";

// POST /api/sync — pull CoachAccountable into the Supabase mirror.
// Auth: a signed-in staff member (Admin screen "Sync now"), or the cron secret
// for the (currently dormant) scheduled sync.
export default withApi(
  async (req: VercelRequest, res: VercelResponse) => {
    const fromCron = typeof req.headers["x-sync-secret"] === "string";
    const result = await runSync(fromCron ? "scheduled" : "manual");
    res.status(200).json(result);
  },
  { methods: ["POST"], auth: "user", allowCronSecret: true, cacheTtl: 0 }
);
