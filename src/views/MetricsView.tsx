import { useEffect, useMemo, useState } from "react";
import { fetchDiscoveryCalls, type DiscoveryCall, type DiscoveryOutcomeValue } from "../db";
import { num, pct } from "../format";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const OUTCOME_LABELS: Record<DiscoveryOutcomeValue, string> = {
  converted: "Converted",
  not_converted: "Not converted",
  pending: "Pending",
  no_show: "No show",
};

export function MetricsView() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [calls, setCalls] = useState<DiscoveryCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDiscoveryCalls(year)
      .then((c) => {
        if (!cancelled) setCalls(c);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const stats = useMemo(() => {
    const list = calls ?? [];
    const total = list.length;
    const counts: Record<DiscoveryOutcomeValue, number> = {
      converted: 0,
      not_converted: 0,
      pending: 0,
      no_show: 0,
    };
    let recorded = 0;
    for (const c of list) {
      if (c.outcome) {
        counts[c.outcome]++;
        recorded++;
      }
    }
    const converted = counts.converted;
    return {
      total,
      converted,
      counts,
      notRecorded: total - recorded,
      conversion: total > 0 ? converted / total : null,
    };
  }, [calls]);

  const max = Math.max(1, stats.total);
  const convWidth = (stats.converted / max) * 100;

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
      </div>

      {error && <div className="notice notice--warn">{error}</div>}

      {loading && !calls ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          <section className="card">
            <h2>Discovery → conversion</h2>
            <p className="view__hint">
              Discovery calls pulled from CoachAccountable, and how many converted based on the outcomes recorded on
              the Discovery tab.
            </p>
            <div className="funnel">
              <div className="funnel__row">
                <div className="funnel__meta">
                  <span className="funnel__label">Discovery calls</span>
                  <span className="funnel__count">{num(stats.total)}</span>
                </div>
                <div className="funnel__track">
                  <div className="funnel__bar funnel__bar--leads" style={{ width: "100%" }} />
                </div>
              </div>
              <div className="funnel__row">
                <div className="funnel__meta">
                  <span className="funnel__label">Converted</span>
                  <span className="funnel__count">{num(stats.converted)}</span>
                </div>
                <div className="funnel__track">
                  <div
                    className="funnel__bar funnel__bar--converted"
                    style={{ width: `${Math.max(convWidth, stats.converted > 0 ? 4 : 0)}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="funnel__conversion">
              Conversion rate: <strong>{pct(stats.conversion)}</strong>
            </div>
          </section>

          <section className="card" style={{ marginTop: 18 }}>
            <h2>Outcomes</h2>
            <div className="stat-row">
              {(Object.keys(OUTCOME_LABELS) as DiscoveryOutcomeValue[]).map((k) => (
                <div className="stat" key={k}>
                  <span className="stat__value">{num(stats.counts[k])}</span>
                  <span className="stat__label">{OUTCOME_LABELS[k]}</span>
                </div>
              ))}
              <div className="stat">
                <span className="stat__value">{num(stats.notRecorded)}</span>
                <span className="stat__label">Not yet recorded</span>
              </div>
            </div>
            {stats.notRecorded > 0 && (
              <p className="view__hint">
                {num(stats.notRecorded)} of {num(stats.total)} discovery calls don’t have an outcome yet — record them
                on the Discovery tab to sharpen the conversion rate.
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
