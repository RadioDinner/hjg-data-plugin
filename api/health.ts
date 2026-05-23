import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi, authEnabled } from "../lib/http";
import { store } from "../lib/store";
import { budgetStatus } from "../lib/budget";

export default withApi(
  async (_req: VercelRequest, res: VercelResponse) => {
    const budget = await budgetStatus();
    res.status(200).json({
      ok: true,
      service: "hjg-data-hub",
      env: {
        hasCAApiId: Boolean(process.env.CA_API_ID),
        hasCAApiKey: Boolean(process.env.CA_API_KEY),
        authEnabled: authEnabled(),
        hasKV: store.kvActive,
      },
      budget: {
        capDaily: budget.capDaily,
        usedToday: budget.usedToday,
        remainingToday: budget.remainingToday,
      },
      timestamp: new Date().toISOString(),
    });
  },
  { noAuth: true, cacheTtl: 0 }
);
