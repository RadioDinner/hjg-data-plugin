import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchReport, type Report } from "../api";
import { fetchDiscoveryCalls, type DiscoveryCall, type DiscoveryOutcomeValue } from "../db";
import { num, pct } from "../format";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const AXIS = "#94a3b8";
const GRID = "#1e293b";
const TOOLTIP = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" };
const C = { phone: "#38bdf8", zoom: "#34d399", meetings: "#a78bfa", mentees: "#38bdf8", mentors: "#f59e0b" };

const OUTCOME_LABELS: Record<DiscoveryOutcomeValue, string> = {
  converted: "Converted",
  not_converted: "Not converted",
  pending: "Pending",
  no_show: "No show",
};

function ChartCard({ title, children }: { title: string; children: ReactElement }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </section>
  );
}

const axisProps = { tick: { fill: AXIS, fontSize: 12 }, stroke: GRID } as const;

export function MetricsView() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [report, setReport] = useState<Report | null>(null);
  const [calls, setCalls] = useState<DiscoveryCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchReport(year), fetchDiscoveryCalls(year)])
      .then(([r, c]) => {
        if (!cancelled) {
          setReport(r);
          setCalls(c);
        }
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

  const charts = useMemo(() => {
    if (!report) return null;
    const m = report.metrics;
    const end = Math.min(12, Math.max(1, m.meta.endMonth));
    const labels = m.shortMonths.slice(0, end);
    const sum = (a: number[]) => a.slice(0, end).reduce((x, y) => x + y, 0);
    return {
      discovery: labels.map((month, i) => ({ month, Phone: m.discoveryPhone[i], Zoom: m.discoveryZoom[i] })),
      meetings: labels.map((month, i) => ({ month, Meetings: m.menteeMeetings[i] })),
      mentees: labels.map((month, i) => ({ month, Mentees: m.activeMentees[i] })),
      mentors: labels.map((month, i) => ({ month, Mentors: m.activeMentors[i] })),
      kpis: {
        discoveryTotal: sum(m.discoveryPhone) + sum(m.discoveryZoom),
        meetingsTotal: sum(m.menteeMeetings),
        latestMentees: m.activeMentees[end - 1] ?? 0,
        latestMentors: m.activeMentors[end - 1] ?? 0,
      },
    };
  }, [report]);

  const conv = useMemo(() => {
    const counts: Record<DiscoveryOutcomeValue, number> = { converted: 0, not_converted: 0, pending: 0, no_show: 0 };
    let recorded = 0;
    for (const c of calls) {
      if (c.outcome) {
        counts[c.outcome]++;
        recorded++;
      }
    }
    const total = calls.length;
    return { total, counts, recorded, notRecorded: total - recorded, rate: total > 0 ? counts.converted / total : null };
  }, [calls]);

  const warnings = report?.meta.warnings ?? [];

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
          <span className="topbar__user">Data as of {new Date(report.meta.computedAt).toLocaleString()}</span>
        )}
      </div>

      {error && <div className="notice notice--warn">{error}</div>}
      {warnings.includes("no_sync_yet") && (
        <div className="notice notice--info">No sync has run yet — open the Admin tab and click “Sync now”.</div>
      )}
      {warnings.includes("uncategorized_appointment_types_present") && (
        <div className="notice notice--warn">
          Some appointment types weren’t recognized and were left out of the counts. Tell me the names and I’ll add them.
        </div>
      )}

      {loading && !report ? (
        <div className="loading">Loading…</div>
      ) : charts ? (
        <>
          <section className="card">
            <div className="stat-row">
              <div className="stat">
                <span className="stat__value">{num(charts.kpis.discoveryTotal)}</span>
                <span className="stat__label">Discovery calls (YTD)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(charts.kpis.meetingsTotal)}</span>
                <span className="stat__label">Mentee meetings (YTD)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(charts.kpis.latestMentees)}</span>
                <span className="stat__label">Active mentees (latest)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(charts.kpis.latestMentors)}</span>
                <span className="stat__label">Mentors (latest)</span>
              </div>
            </div>
          </section>

          <div className="grid" style={{ marginTop: 18 }}>
            <ChartCard title="Discovery calls">
              <BarChart data={charts.discovery}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Phone" fill={C.phone} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Zoom" fill={C.zoom} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Mentee meetings">
              <BarChart data={charts.meetings}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="Meetings" fill={C.meetings} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Active mentees">
              <LineChart data={charts.mentees}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} />
                <Line type="monotone" dataKey="Mentees" stroke={C.mentees} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartCard>

            <ChartCard title="Mentors">
              <BarChart data={charts.mentors}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="Mentors" fill={C.mentors} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>

          <section className="card" style={{ marginTop: 18 }}>
            <h2>Discovery → conversion</h2>
            <p className="view__hint">
              Based on the outcomes recorded on the Discovery tab. Conversion rate:{" "}
              <strong>{pct(conv.rate)}</strong>
            </p>
            <div className="stat-row">
              {(Object.keys(OUTCOME_LABELS) as DiscoveryOutcomeValue[]).map((k) => (
                <div className="stat" key={k}>
                  <span className="stat__value">{num(conv.counts[k])}</span>
                  <span className="stat__label">{OUTCOME_LABELS[k]}</span>
                </div>
              ))}
              <div className="stat">
                <span className="stat__value">{num(conv.notRecorded)}</span>
                <span className="stat__label">Not yet recorded</span>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
