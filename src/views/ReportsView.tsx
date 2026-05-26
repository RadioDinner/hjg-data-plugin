import { useEffect, useState } from "react";
import { fetchFunnelReport, type ReportResult } from "../api";
import { BudgetGauge } from "../components/BudgetGauge";
import { FunnelChart } from "../components/FunnelChart";
import { SalesPanel } from "../components/SalesPanel";
import { MetricsTable } from "../components/MetricsTable";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const WARNING_TEXT: Record<string, string> = {
  graduation_undefined:
    "Graduation isn’t a CoachAccountable field — record graduations on the Graduations tab.",
  uncategorized_appointment_types_present:
    "Some appointment types fell into the “other” bucket and were not counted. Add their patterns to lib/config.ts.",
  no_sync_yet:
    "No sync has run yet — open the Admin tab and click “Sync now” to pull data from CoachAccountable.",
};

export function ReportsView() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFunnelReport(year).then((r) => {
      if (!cancelled) {
        setResult(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const report = result?.report;

  return (
    <section>
      <div className="view__controls">
        <label className="year-select">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        {report && (
          <BudgetGauge
            capDaily={report.meta.budget.capDaily}
            usedToday={report.meta.budget.usedToday}
            remainingToday={report.meta.budget.remainingToday}
          />
        )}
      </div>

      {result && (
        <div className="badges">
          <span className={`badge badge--${result.source}`}>
            {result.source === "live" ? "Live data" : "Demo data"}
          </span>
          {report && (
            <span className="badge badge--muted">
              Data as of {new Date(report.meta.computedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {result?.error && (
        <div className="notice notice--info">
          Showing demo data — could not reach the API ({result.error}).
        </div>
      )}

      {report?.meta.warnings
        .filter((w) => WARNING_TEXT[w])
        .map((w) => (
          <div className="notice notice--warn" key={w}>
            {WARNING_TEXT[w]}
          </div>
        ))}

      {loading && !report ? (
        <div className="loading">Loading…</div>
      ) : report ? (
        <main className="grid">
          <FunnelChart funnel={report.funnel} leadsToConverted={report.conversionRates.leadsToConverted} />
          <SalesPanel
            sales={report.sales}
            shortMonths={report.metrics.shortMonths}
            endMonth={report.metrics.meta.endMonth}
          />
          <div className="grid__full">
            <MetricsTable metrics={report.metrics} />
          </div>
        </main>
      ) : null}
    </section>
  );
}
