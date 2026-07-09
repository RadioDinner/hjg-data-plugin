import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../lib/http.js";
import { syncEngagementTemplates } from "../lib/sync.js";

// POST /api/sync-templates — refresh just the CoachAccountable engagement-template
// mirror (ca_engagement_templates), for the Company options "Refresh templates"
// button. A signed-in staff member only; one CA call, budget-guarded.
export default withApi(
  async (_req: VercelRequest, res: VercelResponse) => {
    const result = await syncEngagementTemplates();
    res.status(200).json(result);
  },
  { methods: ["POST"], auth: "user", cacheTtl: 0 }
);
