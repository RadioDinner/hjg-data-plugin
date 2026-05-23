import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../lib/http";
import { budgetStatus } from "../lib/budget";

export default withApi(
  async (_req: VercelRequest, res: VercelResponse) => {
    const b = await budgetStatus();
    res.status(200).json(b);
  },
  { cacheTtl: 0 }
);
