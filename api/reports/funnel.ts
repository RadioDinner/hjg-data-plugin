import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withApi } from "../../lib/http";
import { getAppointments, getClients, getOfferingSubmissions } from "../../lib/ca";
import { computeFunnelReport } from "../../lib/funnel";
import { budgetStatus } from "../../lib/budget";
import { getOrRefresh } from "../../lib/snapshot";
import { BUDGET_DEFAULTS } from "../../lib/config";
import type { CAClient, FunnelReport } from "../../lib/types";

function nowParts(): { year: number; month1: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUDGET_DEFAULTS.tz,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [y, m] = fmt.split("-");
  return { year: Number(y), month1: Number(m) };
}

function parseIntParam(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

export default withApi(
  async (req: VercelRequest, res: VercelResponse) => {
    const now = nowParts();
    const year = parseIntParam(req.query.year) ?? now.year;
    const defaultEndMonth = year === now.year ? now.month1 : 12;
    const endMonth = Math.min(12, Math.max(1, parseIntParam(req.query.endMonth) ?? defaultEndMonth));

    const snapshotKey = `report:funnel:${year}:${endMonth}`;

    // Each refresh = 3 budgeted CA calls (appointments + clients + submissions).
    const result = await getOrRefresh<FunnelReport>(
      snapshotKey,
      BUDGET_DEFAULTS.snapshotTtlSeconds,
      async () => {
        const [appointments, clientList, submissions] = await Promise.all([
          getAppointments({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }),
          getClients(true),
          getOfferingSubmissions({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }),
        ]);
        const clients = new Map<number, CAClient>(clientList.map((c) => [c.ID, c]));
        return computeFunnelReport(appointments, clients, submissions, { year, endMonth });
      }
    );

    const report = result.data;
    const budget = await budgetStatus();
    report.meta.stale = result.stale;
    report.meta.snapshotAgeSeconds = Number.isFinite(result.ageSeconds) ? result.ageSeconds : 0;
    report.meta.budget = {
      capDaily: budget.capDaily,
      usedToday: budget.usedToday,
      remainingToday: budget.remainingToday,
    };

    res.status(200).json(report);
  },
  { cacheTtl: 300 }
);
