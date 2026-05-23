import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi, sendError } from "../lib/http";
import { getCap, setCap, defaultCap } from "../lib/budget";
import { BUDGET_DEFAULTS } from "../lib/config";

// GET  -> current effective cap and where it came from.
// PUT  -> { capDaily: number | null }  (null reverts to the env-derived default).
// Writes only to our own KV; never touches CoachAccountable.
export default withApi(
  async (req: VercelRequest, res: VercelResponse) => {
    if (req.method === "PUT") {
      const body = (req.body ?? {}) as { capDaily?: number | null };
      const raw = body.capDaily;

      if (raw === null) {
        await setCap(null);
      } else if (
        typeof raw === "number" &&
        Number.isInteger(raw) &&
        raw >= 1 &&
        raw <= BUDGET_DEFAULTS.planDailyLimit
      ) {
        await setCap(raw);
      } else {
        sendError(
          res,
          400,
          `capDaily must be an integer between 1 and ${BUDGET_DEFAULTS.planDailyLimit}, or null to reset`
        );
        return;
      }
    }

    const { capDaily, source } = await getCap();
    res.status(200).json({
      capDaily,
      source,
      defaultCap: defaultCap(),
      planDailyLimit: BUDGET_DEFAULTS.planDailyLimit,
      capPct: BUDGET_DEFAULTS.capPct,
    });
  },
  { methods: ["GET", "PUT"], cacheTtl: 0 }
);
