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
import {
  MANUAL_METRICS,
  fetchCoachesWithSettings,
  fetchLastSyncedAt,
  fetchManualMetrics,
  fetchMentorCoachIds,
  fetchRangeAppointments,
  fetchResolvedOutcomes,
  type CoachWithSettings,
  type DiscoveryOutcomeValue,
  type ManualMetricRow,
  type RangeAppt,
  type ResolvedOutcome,
} from "../db";
import { ExploreModal } from "../components/ExploreModal";
import { downloadCsv } from "../csv";
import { num, pct } from "../format";

type ChartCardCell = string | number;
type ChartCardTable = { columns: string[]; rows: ChartCardCell[][] };
type ChartCardView = "graph" | "table" | "both";

const AXIS = "#94a3b8";
const GRID = "#1e293b";
const TOOLTIP = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" };
const C = { phone: "#38bdf8", zoom: "#34d399", meetings: "#a78bfa", mentees: "#38bdf8", mentors: "#f59e0b" };
const PALETTE = ["#38bdf8", "#34d399", "#a78bfa", "#f59e0b", "#f472b6", "#22d3ee", "#fb7185", "#a3e635"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortType(name: string): string {
  const n = name.replace(/^\*\s*/, "").trim();
  return n.length > 26 ? `${n.slice(0, 26)}…` : n;
}

const OUTCOME_LABELS: Record<DiscoveryOutcomeValue, string> = {
  converted: "Converted",
  not_converted: "Not converted",
  pending: "Pending",
  no_show: "No show",
};

const axisProps = { tick: { fill: AXIS, fontSize: 12 }, stroke: GRID } as const;

const PRESETS = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "this_year", label: "This year" },
  { key: "last_12", label: "Last 12 mo" },
  { key: "all", label: "All" },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "this_month":
      return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
    case "last_month":
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "this_quarter": {
      const qs = Math.floor(m / 3) * 3;
      return { from: ymd(new Date(y, qs, 1)), to: ymd(now) };
    }
    case "last_quarter": {
      const qs = Math.floor(m / 3) * 3;
      return { from: ymd(new Date(y, qs - 3, 1)), to: ymd(new Date(y, qs, 0)) };
    }
    case "this_year":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(now) };
    case "last_12":
      return { from: ymd(new Date(y, m - 11, 1)), to: ymd(now) };
    case "all":
      // Only the last three years are synced, so "all" spans that window.
      return { from: `${y - 2}-01-01`, to: ymd(now) };
  }
}

function monthBuckets(from: string, to: string): { key: string; label: string }[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !ty || fy > ty || (fy === ty && fm > tm)) return [];
  const multiYear = fy !== ty;
  const out: { key: string; label: string }[] = [];
  let y = fy;
  let mo = fm;
  while (y < ty || (y === ty && mo <= tm)) {
    const label = SHORT[mo - 1] + (multiYear ? ` ’${String(y).slice(2)}` : "");
    out.push({ key: `${y}-${pad2(mo)}`, label });
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
    if (out.length > 60) break; // safety
  }
  return out;
}

function ChartCard({
  title,
  children,
  extra,
  table,
  onExplore,
}: {
  title: string;
  children: ReactElement;
  extra?: ReactElement;
  table?: ChartCardTable;
  onExplore?: () => void;
}) {
  const storageKey = `hjg.chartcard.view:${title}`;
  const [view, setView] = useState<ChartCardView>(() => {
    if (!table || typeof window === "undefined") return "both";
    const saved = window.localStorage.getItem(storageKey);
    return saved === "graph" || saved === "table" || saved === "both" ? saved : "both";
  });
  useEffect(() => {
    if (!table || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, view);
  }, [storageKey, view, table]);

  const showGraph = !table || view !== "table";
  const showTable = !!table && view !== "graph";

  return (
    <section className="card">
      <div className="card__head">
        <h2>{title}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {table && (
            <button
              className="btn btn--sm"
              onClick={() => downloadCsv(title, table.columns, table.rows)}
              title="Download the per-month aggregated table as CSV"
            >
              Export CSV
            </button>
          )}
          {onExplore && (
            <button className="btn btn--sm" onClick={onExplore}>
              Explore
            </button>
          )}
          {table && (
            <div className="seg" role="tablist" aria-label="Card view">
              {(["graph", "table", "both"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={view === k}
                  className={`seg__btn ${view === k ? "seg__btn--active" : ""}`}
                  onClick={() => setView(k)}
                >
                  {k === "graph" ? "Graph" : k === "table" ? "Table" : "Both"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {extra}
      <div className={`chart-card__split ${showGraph && showTable ? "chart-card__split--both" : ""}`}>
        {showGraph && (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
          </div>
        )}
        {showTable && table && (
          <div className="table-scroll" style={{ width: "100%" }}>
            <ChartDataTable columns={table.columns} rows={table.rows} />
          </div>
        )}
      </div>
    </section>
  );
}

function ChartDataTable({ columns, rows }: ChartCardTable) {
  return (
    <table className="table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className={typeof cell === "number" ? "num" : ""}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="muted">
              No rows.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
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

const INITIAL = presetRange("this_year");

export function MetricsView() {
  const [from, setFrom] = useState(INITIAL.from);
  const [to, setTo] = useState(INITIAL.to);
  const [preset, setPreset] = useState<PresetKey | "custom">("this_year");
  const [appts, setAppts] = useState<RangeAppt[]>([]);
  const [manual, setManual] = useState<ManualMetricRow[]>([]);
  const [outcomes, setOutcomes] = useState<Map<number, ResolvedOutcome>>(new Map());
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null);
  const [meetingsMode, setMeetingsMode] = useState<"total" | "compare">("total");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [mentorIds, setMentorIds] = useState<Set<number>>(new Set());
  const [coachSettings, setCoachSettings] = useState<CoachWithSettings[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [explore, setExplore] = useState<{ title: string; columns: string[]; rows: (string | number)[][] } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRangeAppointments(from, to)
      .then(async (rows) => {
        const discoveryAppts = rows
          .filter((a) => a.category !== "mentoring")
          .map((a) => ({ id: a.id, clientId: a.clientId, date: a.date }));
        const out = await fetchResolvedOutcomes(discoveryAppts);
        if (cancelled) return;
        setAppts(rows);
        setOutcomes(out);
        setSelectedTypes(new Set(rows.filter((a) => a.category === "mentoring").map((a) => a.name)));
        setReady(true);
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
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    fetchManualMetrics(from, to)
      .then((rows) => {
        if (!cancelled) setManual(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    fetchLastSyncedAt()
      .then((t) => {
        if (!cancelled) setLastSync(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Mentor roster + capacities (HJG-owned). Loaded once per view mount; the
  // Admin tab updates these and the dashboard reflects on next visit.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMentorCoachIds(), fetchCoachesWithSettings()])
      .then(([ids, all]) => {
        if (cancelled) return;
        setMentorIds(ids);
        setCoachSettings(all);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function applyPreset(key: PresetKey) {
    const r = presetRange(key);
    setFrom(r.from);
    setTo(r.to);
    setPreset(key);
  }

  const mentoring = useMemo(() => appts.filter((a) => a.category === "mentoring"), [appts]);
  const discovery = useMemo(() => appts.filter((a) => a.category !== "mentoring"), [appts]);

  const meetingTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of mentoring) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [mentoring]);

  const selectedMentoring = useMemo(
    () => mentoring.filter((a) => !selectedTypes || selectedTypes.has(a.name)),
    [mentoring, selectedTypes]
  );

  const buckets = useMemo(() => monthBuckets(from, to), [from, to]);

  const byMonth = useMemo(() => {
    const m = new Map<string, RangeAppt[]>();
    for (const a of appts) {
      if (!a.date) continue;
      const k = a.date.slice(0, 7);
      let arr = m.get(k);
      if (!arr) {
        arr = [];
        m.set(k, arr);
      }
      arr.push(a);
    }
    return m;
  }, [appts]);

  // When staff have flagged any coaches as is_mentor, restrict the Mentors
  // metric to that whitelist (fixes the long-standing inflated-mentor-count
  // problem from CA's broader "coach" roster). Empty set = no filter.
  const isMentor = (coachId: number | null): boolean =>
    mentorIds.size === 0 || (coachId != null && mentorIds.has(coachId));

  const data = useMemo(
    () =>
      buckets.map((b) => {
        const items = byMonth.get(b.key) ?? [];
        let phone = 0;
        let zoom = 0;
        const mentees = new Set<number>();
        const mentors = new Set<number>();
        let meetings = 0;
        for (const a of items) {
          if (a.category === "discoveryPhone") phone++;
          else if (a.category === "discoveryZoom") zoom++;
          else if (a.category === "mentoring" && (!selectedTypes || selectedTypes.has(a.name))) {
            meetings++;
            mentees.add(a.clientId ?? -1);
            if (isMentor(a.coachId)) mentors.add(a.coachId ?? -1);
          }
        }
        return { month: b.label, Phone: phone, Zoom: zoom, Meetings: meetings, Mentees: mentees.size, Mentors: mentors.size };
      }),
    [byMonth, buckets, selectedTypes, mentorIds]
  );

  const selectedTypeList = useMemo(
    () => meetingTypes.filter((t) => selectedTypes?.has(t.name)).map((t) => t.name),
    [meetingTypes, selectedTypes]
  );

  const compareData = useMemo(
    () =>
      buckets.map((b) => {
        const items = byMonth.get(b.key) ?? [];
        const row: Record<string, number | string> = { month: b.label };
        for (const n of selectedTypeList) row[n] = 0;
        for (const a of items) {
          if (a.category === "mentoring" && selectedTypes?.has(a.name)) {
            row[a.name] = ((row[a.name] as number) ?? 0) + 1;
          }
        }
        return row;
      }),
    [byMonth, buckets, selectedTypeList, selectedTypes]
  );

  const manualByMonth = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of manual) {
      const k = r.periodMonth.slice(0, 7);
      let inner = m.get(k);
      if (!inner) {
        inner = new Map();
        m.set(k, inner);
      }
      inner.set(r.metric, (inner.get(r.metric) ?? 0) + r.value);
    }
    return m;
  }, [manual]);

  const manualData = useMemo(
    () =>
      buckets.map((b) => {
        const inner = manualByMonth.get(b.key);
        const row: Record<string, number | string> = { month: b.label };
        for (const def of MANUAL_METRICS) row[def.key] = inner?.get(def.key) ?? 0;
        return row;
      }),
    [buckets, manualByMonth]
  );

  const manualTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const def of MANUAL_METRICS) totals.set(def.key, 0);
    for (const r of manual) totals.set(r.metric, (totals.get(r.metric) ?? 0) + r.value);
    return totals;
  }, [manual]);

  const kpis = {
    discoveryTotal: discovery.length,
    meetingsTotal: selectedMentoring.length,
    mentees: new Set(selectedMentoring.map((a) => a.clientId ?? -1)).size,
    mentors: new Set(selectedMentoring.filter((a) => isMentor(a.coachId)).map((a) => a.coachId ?? -1)).size,
  };

  // Per-mentor capacity utilization in the selected range. Rows include every
  // flagged mentor (is_mentor=true) plus, even when capacity is unset, the
  // count of mentees they're actively meeting with — so unfilled capacity
  // jumps out. Sorted by utilization desc so the most-loaded mentors are top.
  const capacityRows = useMemo(() => {
    const menteesByCoach = new Map<number, Set<number>>();
    for (const a of selectedMentoring) {
      if (a.coachId == null) continue;
      if (!isMentor(a.coachId)) continue;
      let set = menteesByCoach.get(a.coachId);
      if (!set) {
        set = new Set();
        menteesByCoach.set(a.coachId, set);
      }
      if (a.clientId != null) set.add(a.clientId);
    }
    return coachSettings
      .filter((c) => c.isMentor)
      .map((c) => {
        const mentees = menteesByCoach.get(c.coachId)?.size ?? 0;
        const capacity = c.capacity ?? null;
        const utilization = capacity != null && capacity > 0 ? mentees / capacity : null;
        return { coachId: c.coachId, name: c.name, mentees, capacity, utilization };
      })
      .sort((a, b) => {
        const au = a.utilization ?? -1;
        const bu = b.utilization ?? -1;
        if (bu !== au) return bu - au;
        return b.mentees - a.mentees;
      });
  }, [coachSettings, selectedMentoring, mentorIds]);

  const capacityTotals = useMemo(() => {
    const totalCapacity = capacityRows.reduce((s, r) => s + (r.capacity ?? 0), 0);
    const totalMentees = capacityRows.reduce((s, r) => s + r.mentees, 0);
    const mentorsWithCapacity = capacityRows.filter((r) => r.capacity != null).length;
    return {
      mentors: capacityRows.length,
      mentorsWithCapacity,
      totalCapacity,
      totalMentees,
      rate: totalCapacity > 0 ? totalMentees / totalCapacity : null,
    };
  }, [capacityRows]);

  function exploreCapacityRaw() {
    setExplore({
      title: "Mentor capacity utilization — source data",
      columns: ["Mentor", "Mentees", "Capacity", "Utilization", "Notes"],
      rows: capacityRows.map((r) => [
        r.name,
        r.mentees,
        r.capacity ?? "—",
        r.utilization != null ? `${Math.round(r.utilization * 100)}%` : "—",
        coachSettings.find((c) => c.coachId === r.coachId)?.notes ?? "",
      ]),
    });
  }

  const conv = useMemo(() => {
    const counts: Record<DiscoveryOutcomeValue, number> = { converted: 0, not_converted: 0, pending: 0, no_show: 0 };
    let manualCount = 0;
    for (const a of discovery) {
      const o = outcomes.get(a.id);
      if (o) {
        counts[o.outcome]++;
        if (o.source === "manual") manualCount++;
      }
    }
    const total = discovery.length;
    return { total, counts, manualCount, rate: total > 0 ? counts.converted / total : null };
  }, [discovery, outcomes]);

  function toggleType(name: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Each table mirrors the exact per-month numbers that build its chart, so the
  // graph + table panels on every card stay in sync as filters and ranges move.
  const discoveryTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Month", "Phone", "Zoom", "Total"],
      rows: data.map((d) => [d.month, d.Phone, d.Zoom, d.Phone + d.Zoom]),
    }),
    [data]
  );
  const meetingsTable = useMemo<ChartCardTable>(
    () =>
      meetingsMode === "compare"
        ? {
            columns: ["Month", ...selectedTypeList.map(shortType)],
            rows: compareData.map((r) => [r.month as string, ...selectedTypeList.map((n) => (r[n] as number) ?? 0)]),
          }
        : {
            columns: ["Month", "Meetings"],
            rows: data.map((d) => [d.month, d.Meetings]),
          },
    [meetingsMode, data, compareData, selectedTypeList]
  );
  const menteesTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Month", "Active mentees"],
      rows: data.map((d) => [d.month, d.Mentees]),
    }),
    [data]
  );
  const mentorsTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Month", "Mentors"],
      rows: data.map((d) => [d.month, d.Mentors]),
    }),
    [data]
  );
  const manualTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Month", ...MANUAL_METRICS.map((m) => m.label)],
      rows: manualData.map((r) => [r.month as string, ...MANUAL_METRICS.map((m) => (r[m.key] as number) ?? 0)]),
    }),
    [manualData]
  );

  // Explore = raw underlying data the chart was built from (a CA-style audit
  // view). Sorted newest-first so it lines up with how CA shows appointments.
  function exploreDiscoveryRaw() {
    const rows = [...discovery]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .map((a) => {
        const o = outcomes.get(a.id);
        return [
          a.date ?? "",
          a.clientName,
          a.category === "discoveryPhone" ? "phone" : a.category === "discoveryZoom" ? "zoom" : a.category,
          o ? `${OUTCOME_LABELS[o.outcome]} (${o.source})` : "—",
          o?.reason ?? "",
        ] as (string | number)[];
      });
    setExplore({
      title: "Discovery calls — source data",
      columns: ["Signup date", "Prospect", "Type", "Outcome", "Reason"],
      rows,
    });
  }
  function exploreMeetingsRaw() {
    const rows = [...selectedMentoring]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .map((a) => [a.date ?? "", a.clientName, a.coachName, a.name] as (string | number)[]);
    setExplore({
      title: "Mentee meetings — source data",
      columns: ["Date", "Mentee", "Mentor", "Meeting type"],
      rows,
    });
  }
  function exploreMenteesRaw() {
    const byClient = new Map<string, { count: number; first: string; last: string }>();
    for (const a of selectedMentoring) {
      const key = a.clientName;
      const cur = byClient.get(key);
      const d = a.date ?? "";
      if (!cur) byClient.set(key, { count: 1, first: d, last: d });
      else {
        cur.count++;
        if (d && (!cur.first || d < cur.first)) cur.first = d;
        if (d && d > cur.last) cur.last = d;
      }
    }
    const rows = [...byClient.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, v]) => [name, v.count, v.first, v.last] as (string | number)[]);
    setExplore({
      title: "Active mentees — source data",
      columns: ["Mentee", "Meetings", "First meeting", "Last meeting"],
      rows,
    });
  }
  function exploreMentorsRaw() {
    // Group by coachId so we can pin the mentor flag accurately even when two
    // coaches share a name. Falls back to coachName for display.
    const byCoach = new Map<number, { name: string; count: number; mentees: Set<string>; first: string; last: string }>();
    for (const a of selectedMentoring) {
      const id = a.coachId ?? -1;
      const d = a.date ?? "";
      const cur = byCoach.get(id);
      if (!cur) byCoach.set(id, { name: a.coachName, count: 1, mentees: new Set([a.clientName]), first: d, last: d });
      else {
        cur.count++;
        cur.mentees.add(a.clientName);
        if (d && (!cur.first || d < cur.first)) cur.first = d;
        if (d && d > cur.last) cur.last = d;
      }
    }
    const rows = [...byCoach.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, v]) => [
        v.name,
        mentorIds.size === 0 ? "—" : mentorIds.has(id) ? "Yes" : "No",
        v.mentees.size,
        v.count,
        v.first,
        v.last,
      ] as (string | number)[]);
    setExplore({
      title: "Mentors — source data",
      columns: ["Mentor", "Flagged is_mentor?", "Mentees", "Meetings", "First meeting", "Last meeting"],
      rows,
    });
  }
  function exploreManualRaw() {
    const labelByKey = new Map(MANUAL_METRICS.map((m) => [m.key, m.label]));
    const rows = [...manual]
      .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth))
      .map((r) => [
        r.periodMonth.slice(0, 7),
        labelByKey.get(r.metric) ?? r.metric,
        r.value,
        r.notes ?? "",
      ] as (string | number)[]);
    setExplore({
      title: "Resource engagement — source data",
      columns: ["Month", "Metric", "Value", "Notes"],
      rows,
    });
  }

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
        {meetingTypes.length === 0 && <span className="muted">No mentoring appointments in this range.</span>}
      </div>
    </div>
  );

  const meetingsExtra = (
    <div>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button
          className={`seg__btn ${meetingsMode === "total" ? "seg__btn--active" : ""}`}
          onClick={() => setMeetingsMode("total")}
        >
          Total
        </button>
        <button
          className={`seg__btn ${meetingsMode === "compare" ? "seg__btn--active" : ""}`}
          onClick={() => setMeetingsMode("compare")}
        >
          Compare types
        </button>
      </div>
      {meetingsMode === "compare" && (
        <p className="view__hint" style={{ marginTop: 0 }}>
          Each checked type below is drawn as its own bar — check just the ones you want to compare.
        </p>
      )}
      {typeFilter}
    </div>
  );

  const meetingsChart =
    meetingsMode === "total" ? (
      <BarChart data={data}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis allowDecimals={false} width={28} {...axisProps} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
        <Bar dataKey="Meetings" fill={C.meetings} radius={[4, 4, 0, 0]} />
      </BarChart>
    ) : (
      <BarChart data={compareData}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis allowDecimals={false} width={28} {...axisProps} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {selectedTypeList.map((n, i) => (
          <Bar key={n} dataKey={n} name={shortType(n)} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    );

  return (
    <section>
      <div className="range">
        <div className="range__presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`chip ${preset === p.key ? "chip--active" : ""}`}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="range__dates">
          <label className="field field--inline">
            <span>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
            />
          </label>
          <label className="field field--inline">
            <span>To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
            />
          </label>
          {loading && <span className="muted">Loading…</span>}
        </div>
      </div>

      {lastSync && (
        <p className="view__hint" style={{ marginTop: 4 }}>
          Data as of {new Date(lastSync).toLocaleString()} — re-sync on the Admin tab to refresh.
        </p>
      )}

      {error && <div className="notice notice--warn">{error}</div>}

      {!ready && loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          <section className="card">
            <div className="stat-row">
              <div className="stat">
                <span className="stat__value">{num(kpis.discoveryTotal)}</span>
                <span className="stat__label">Discovery calls</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(kpis.meetingsTotal)}</span>
                <span className="stat__label">Mentee meetings</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(kpis.mentees)}</span>
                <span className="stat__label">Active mentees</span>
              </div>
              <div className="stat">
                <span className="stat__value">{num(kpis.mentors)}</span>
                <span className="stat__label">Mentors</span>
              </div>
            </div>
          </section>

          <div style={{ marginTop: 18 }}>
            <ChartCard title="Discovery calls" table={discoveryTable} onExplore={exploreDiscoveryRaw}>
              <BarChart data={data}>
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
            <ChartCard title="Mentee meetings" extra={meetingsExtra} table={meetingsTable} onExplore={exploreMeetingsRaw}>
              {meetingsChart}
            </ChartCard>
          </div>

          <div className="grid" style={{ marginTop: 18 }}>
            <ChartCard title="Active mentees" table={menteesTable} onExplore={exploreMenteesRaw}>
              <LineChart data={data}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} />
                <Line type="monotone" dataKey="Mentees" stroke={C.mentees} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartCard>

            <ChartCard title="Mentors" table={mentorsTable} onExplore={exploreMentorsRaw}>
              <BarChart data={data}>
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
              Auto-computed: a call converts when the prospect buys JumpStart Your Freedom (Waiting List) on or after the
              call. With no purchase it stays pending for 30 days, then becomes not converted. Staff overrides on the
              Discovery tab take precedence. Conversion rate: <strong>{pct(conv.rate)}</strong>
              {conv.manualCount > 0 && <> · {num(conv.manualCount)} set manually</>}
            </p>
            <div className="stat-row">
              {(Object.keys(OUTCOME_LABELS) as DiscoveryOutcomeValue[]).map((k) => (
                <div className="stat" key={k}>
                  <span className="stat__value">{num(conv.counts[k])}</span>
                  <span className="stat__label">{OUTCOME_LABELS[k]}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" style={{ marginTop: 18 }}>
            <div className="card__head">
              <h2>Mentor capacity utilization</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn--sm"
                  onClick={() =>
                    downloadCsv(
                      "Mentor capacity utilization",
                      ["Mentor", "Mentees", "Capacity", "Utilization %"],
                      capacityRows.map((r) => [
                        r.name,
                        r.mentees,
                        r.capacity ?? "",
                        r.utilization != null ? Math.round(r.utilization * 100) : "",
                      ])
                    )
                  }
                  disabled={capacityRows.length === 0}
                  title="Download the per-mentor utilization table as CSV"
                >
                  Export CSV
                </button>
                <button
                  className="btn btn--sm"
                  onClick={exploreCapacityRaw}
                  disabled={capacityRows.length === 0}
                >
                  Explore
                </button>
              </div>
            </div>
            <p className="view__hint">
              Active mentees per mentor in the selected range vs the capacity set on the Admin tab. Mark coaches as
              mentors and set a capacity in <strong>Admin → Mentor capacity</strong>.
            </p>
            {capacityRows.length === 0 ? (
              <p className="muted">
                No coaches are flagged as mentors yet. Go to Admin → Mentor capacity to mark mentors and set
                capacities.
              </p>
            ) : (
              <>
                <div className="stat-row">
                  <div className="stat">
                    <span className="stat__value">{num(capacityTotals.mentors)}</span>
                    <span className="stat__label">Mentors flagged</span>
                  </div>
                  <div className="stat">
                    <span className="stat__value">{num(capacityTotals.totalMentees)}</span>
                    <span className="stat__label">Mentees in range</span>
                  </div>
                  <div className="stat">
                    <span className="stat__value">
                      {capacityTotals.totalCapacity > 0 ? num(capacityTotals.totalCapacity) : "—"}
                    </span>
                    <span className="stat__label">Total capacity</span>
                  </div>
                  <div className="stat">
                    <span className="stat__value">{pct(capacityTotals.rate)}</span>
                    <span className="stat__label">Overall utilization</span>
                  </div>
                </div>
                <div className="table-scroll" style={{ marginTop: 4 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Mentor</th>
                        <th className="num">Mentees</th>
                        <th className="num">Capacity</th>
                        <th className="num">Utilization</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capacityRows.map((r) => (
                        <tr key={r.coachId}>
                          <td>{r.name}</td>
                          <td className="num">{num(r.mentees)}</td>
                          <td className="num">{r.capacity == null ? "—" : num(r.capacity)}</td>
                          <td className="num">{r.utilization == null ? "—" : pct(r.utilization)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <div style={{ marginTop: 18 }}>
            <ChartCard
              title="Resource engagement"
              table={manualTable}
              onExplore={exploreManualRaw}
              extra={
                <div className="stat-row" style={{ marginBottom: 12 }}>
                  {MANUAL_METRICS.map((m) => (
                    <div className="stat" key={m.key}>
                      <span className="stat__value">{num(manualTotals.get(m.key) ?? 0)}</span>
                      <span className="stat__label">{m.short}</span>
                    </div>
                  ))}
                </div>
              }
            >
              <BarChart data={manualData}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {MANUAL_METRICS.map((m, i) => (
                  <Bar key={m.key} dataKey={m.key} name={m.label} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ChartCard>
          </div>
        </>
      )}

      {explore && <ExploreModal {...explore} onClose={() => setExplore(null)} />}
    </section>
  );
}
