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
import {
  fetchDiscoveryCalls,
  fetchMentoringAppointments,
  type DiscoveryCall,
  type DiscoveryOutcomeValue,
  type MeetingAppt,
} from "../db";
import { ExploreModal } from "../components/ExploreModal";
import { num, pct } from "../format";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const AXIS = "#94a3b8";
const GRID = "#1e293b";
const TOOLTIP = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" };
const C = { phone: "#38bdf8", zoom: "#34d399", total: "#64748b", meetings: "#a78bfa", mentees: "#38bdf8", mentors: "#f59e0b" };

const OUTCOME_LABELS: Record<DiscoveryOutcomeValue, string> = {
  converted: "Converted",
  not_converted: "Not converted",
  pending: "Pending",
  no_show: "No show",
};

const axisProps = { tick: { fill: AXIS, fontSize: 12 }, stroke: GRID } as const;

function ChartCard({
  title,
  children,
  extra,
  onExplore,
}: {
  title: string;
  children: ReactElement;
  extra?: ReactElement;
  onExplore?: () => void;
}) {
  return (
    <section className="card">
      <div className="card__head">
        <h2>{title}</h2>
        {onExplore && (
          <button className="btn btn--sm" onClick={onExplore}>
            Explore
          </button>
        )}
      </div>
      {extra}
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </section>
  );
}

// Group mentoring appointments by mentee or mentor into [name, count] rows.
function groupCount(
  items: MeetingAppt[],
  idOf: (a: MeetingAppt) => number | null,
  nameOf: (a: MeetingAppt) => string
): (string | number)[][] {
  const m = new Map<string, { name: string; count: number }>();
  for (const a of items) {
    const id = idOf(a);
    const key = id != null ? `id:${id}` : `n:${nameOf(a)}`;
    const e = m.get(key);
    if (e) e.count++;
    else m.set(key, { name: nameOf(a), count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count).map((e) => [e.name, e.count]);
}

interface TipEntry {
  dataKey?: string | number;
  value?: number;
}

function DiscoveryTooltip({ active, payload, label }: { active?: boolean; payload?: TipEntry[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const get = (k: string) => Number(payload.find((p) => p.dataKey === k)?.value ?? 0);
  const phone = get("Phone");
  const zoom = get("Zoom");
  return (
    <div style={{ ...TOOLTIP, padding: "6px 10px", fontSize: 13 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ color: C.phone }}>Phone: {phone}</div>
      <div style={{ color: C.zoom }}>Zoom: {zoom}</div>
      <div style={{ borderTop: "1px solid #334155", marginTop: 4, paddingTop: 4 }}>Total: {phone + zoom}</div>
    </div>
  );
}

export function MetricsView() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [report, setReport] = useState<Report | null>(null);
  const [calls, setCalls] = useState<DiscoveryCall[]>([]);
  const [meetingAppts, setMeetingAppts] = useState<MeetingAppt[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [explore, setExplore] = useState<{ title: string; columns: string[]; rows: (string | number)[][] } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchReport(year), fetchDiscoveryCalls(year), fetchMentoringAppointments(year)])
      .then(([r, c, m]) => {
        if (cancelled) return;
        setReport(r);
        setCalls(c);
        setMeetingAppts(m);
        setSelectedTypes(new Set(m.map((a) => a.name)));
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

  const end = report ? Math.min(12, Math.max(1, report.metrics.meta.endMonth)) : 0;
  const labels = report ? report.metrics.shortMonths.slice(0, end) : [];

  const meetingTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of meetingAppts) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [meetingAppts]);

  const meetingsData = labels.map((month, i) => {
    let count = 0;
    for (const a of meetingAppts) {
      if (a.month === i + 1 && (!selectedTypes || selectedTypes.has(a.name))) count++;
    }
    return { month, Meetings: count };
  });

  const discoveryData = report
    ? labels.map((month, i) => ({
        month,
        Phone: report.metrics.discoveryPhone[i],
        Zoom: report.metrics.discoveryZoom[i],
      }))
    : [];
  const menteesData = report ? labels.map((month, i) => ({ month, Mentees: report.metrics.activeMentees[i] })) : [];
  const mentorsData = report ? labels.map((month, i) => ({ month, Mentors: report.metrics.activeMentors[i] })) : [];

  const sum = (a: number[]) => a.slice(0, end).reduce((x, y) => x + y, 0);
  const kpis = report
    ? {
        discoveryTotal: sum(report.metrics.discoveryPhone) + sum(report.metrics.discoveryZoom),
        meetingsTotal: meetingsData.reduce((x, d) => x + d.Meetings, 0),
        latestMentees: report.metrics.activeMentees[end - 1] ?? 0,
        latestMentors: report.metrics.activeMentors[end - 1] ?? 0,
      }
    : null;

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
    return { total, counts, notRecorded: total - recorded, rate: total > 0 ? counts.converted / total : null };
  }, [calls]);

  function toggleType(name: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const selectedMeetings = meetingAppts.filter((a) => !selectedTypes || selectedTypes.has(a.name));

  function exploreDiscovery() {
    setExplore({
      title: `Discovery calls — ${year}`,
      columns: ["Date", "Prospect", "Type", "Outcome"],
      rows: calls.map((c) => [
        c.date ?? "—",
        c.prospect,
        c.type,
        c.outcome ? OUTCOME_LABELS[c.outcome] : "—",
      ]),
    });
  }
  function exploreMeetings() {
    setExplore({
      title: `Mentee meetings — ${year}`,
      columns: ["Date", "Prospect", "Meeting type"],
      rows: selectedMeetings.map((a) => [a.date ?? "—", a.clientName, a.name]),
    });
  }
  function exploreMentees() {
    setExplore({
      title: `Active mentees — ${year}`,
      columns: ["Mentee", "Meetings"],
      rows: groupCount(selectedMeetings, (a) => a.clientId, (a) => a.clientName),
    });
  }
  function exploreMentors() {
    setExplore({
      title: `Mentors — ${year}`,
      columns: ["Mentor", "Meetings"],
      rows: groupCount(selectedMeetings, (a) => a.coachId, (a) => a.coachName),
    });
  }

  const warnings = report?.meta.warnings ?? [];

  const typeFilter = (
    <div className="type-filter">
      <div className="type-filter__head">
        <span className="muted">Meeting types counted:</span>
        <button className="linkbtn" onClick={() => setSelectedTypes(new Set(meetingTypes.map((t) => t.name)))}>
          All
        </button>
        <button className="linkbtn" onClick={() => setSelectedTypes(new Set())}>
          None
        </button>
      </div>
      <div className="type-filter__items">
        {meetingTypes.map((t) => (
          <label key={t.name} className="type-filter__item">
            <input type="checkbox" checked={selectedTypes?.has(t.name) ?? false} onChange={() => toggleType(t.name)} />
            <span>{t.name}</span>
            <span className="muted">{t.count}</span>
          </label>
        ))}
        {meetingTypes.length === 0 && <span className="muted">No mentoring appointments for {year}.</span>}
      </div>
    </div>
  );

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
      ) : kpis ? (
        <>
          <section className="card">
            <div className="stat-row">
              <div className="stat">
                <span className="stat__value">{num(kpis.discoveryTotal)}</span>
                <span className="stat__label">Discovery calls (YTD)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(kpis.meetingsTotal)}</span>
                <span className="stat__label">Mentee meetings (YTD)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(kpis.latestMentees)}</span>
                <span className="stat__label">Active mentees (latest)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(kpis.latestMentors)}</span>
                <span className="stat__label">Mentors (latest)</span>
              </div>
            </div>
          </section>

          <div style={{ marginTop: 18 }}>
            <ChartCard title="Discovery calls" onExplore={exploreDiscovery}>
              <BarChart data={discoveryData}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip content={<DiscoveryTooltip />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Phone" stackId="calls" fill={C.phone} />
                <Bar dataKey="Zoom" stackId="calls" fill={C.zoom} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>

          <div style={{ marginTop: 18 }}>
            <ChartCard title="Mentee meetings" extra={typeFilter} onExplore={exploreMeetings}>
              <BarChart data={meetingsData}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="Meetings" fill={C.meetings} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>

          <div className="grid" style={{ marginTop: 18 }}>
            <ChartCard title="Active mentees" onExplore={exploreMentees}>
              <LineChart data={menteesData}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} />
                <Line type="monotone" dataKey="Mentees" stroke={C.mentees} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartCard>

            <ChartCard title="Mentors" onExplore={exploreMentors}>
              <BarChart data={mentorsData}>
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
              Based on the outcomes recorded on the Discovery tab. Conversion rate: <strong>{pct(conv.rate)}</strong>
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

      {explore && <ExploreModal {...explore} onClose={() => setExplore(null)} />}
    </section>
  );
}
