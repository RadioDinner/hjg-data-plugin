import type { FunnelReport, DataSource } from "./types";
import { mockReport } from "./mock";

const TOKEN = import.meta.env.VITE_HJG_API_TOKEN as string | undefined;
const USE_MOCK = (import.meta.env.VITE_USE_MOCK as string | undefined) === "1";

export interface ReportResult {
  report: FunnelReport;
  source: DataSource;
  error?: string;
}

// Fetches the live report; falls back to bundled mock data when forced via
// VITE_USE_MOCK or when the API is unreachable (e.g. no backend running locally).
export async function fetchFunnelReport(year: number): Promise<ReportResult> {
  if (USE_MOCK) return { report: mockReport(year), source: "mock" };
  try {
    const res = await fetch(`/api/reports/funnel?year=${year}`, {
      headers: TOKEN ? { "x-hjg-token": TOKEN } : {},
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    const report = (await res.json()) as FunnelReport;
    return { report, source: "live" };
  } catch (e) {
    return { report: mockReport(year), source: "mock", error: String(e) };
  }
}
