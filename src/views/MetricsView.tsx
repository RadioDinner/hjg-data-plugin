import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  COMPARE_PRESETS,
  MANUAL_METRICS,
  derivePeriodB,
  delta,
  fetchCoachesWithSettings,
  fetchPrimaryCoachByClient,
  fetchLastSyncedAt,
  fetchFreedomReport,
  fetchJyfVsMentoring,
  fetchManualMetrics,
  fetchMentorCoachIds,
  fetchRangeAppointments,
  fetchResolvedOutcomes,
  fetchCompanyOptions,
  oneOnOneMenteesByCoach,
  parseTrendWindow,
  rollingConversionTrend,
  trendWindowLabel,
  DEFAULT_TREND_WINDOW,
  type CapacityAppt,
  type CompareKey,
  type CoachWithSettings,
  type DiscoveryOutcomeValue,
  type FreedomReport,
  type JyfVsMentoring,
  type ManualMetricRow,
  type RangeAppt,
  type ResolvedOutcome,
  type TrendCall,
  type TrendWindow,
} from "../db";
import { ExploreModal } from "../components/ExploreModal";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";
import { useChartTokens } from "../theme";
import { downloadCsv } from "../csv";
import { num, pct, signed, signedPct, signedPp, fmtDate, fmtDateTime } from "../format";

type ChartCardCell = string | number;
type ChartCardTable = { columns: string[]; rows: ChartCardCell[][] };
type ChartCardView = "graph" | "table" | "both";

const C = { phone: "#38bdf8", zoom: "#34d399", meetings: "#a78bfa", mentees: "#38bdf8", mentors: "#f59e0b", converted: "#34d399", rate: "#f472b6" };
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

// Color per discovery outcome — a soft, cohesive range (sea-green → gold → coral →
// slate-blue) rather than stark primaries, used to color-code the stacked bars on
// the Discovery calls → conversion card. Phone segments render as a grid pattern of
// the same color; zoom segments render solid (see the chart's <defs>).
const OUTCOME_COLORS: Record<DiscoveryOutcomeValue, string> = {
  converted: "#6cc4a1", // soft sea-green
  pending: "#e3c06a", // muted gold
  not_converted: "#dd9183", // soft coral
  no_show: "#8a93b3", // muted slate-blue
};
// Stacking order (best → inactive) + the data-key prefix for each outcome's
// phone/zoom split in convData.
const OUTCOME_ORDER: DiscoveryOutcomeValue[] = ["converted", "pending", "not_converted", "no_show"];
const OUTCOME_KEYBASE: Record<DiscoveryOutcomeValue, string> = {
  converted: "Converted",
  pending: "Pending",
  not_converted: "NotConverted",
  no_show: "NoShow",
};

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

// --- per-period reductions (shared by Period A and Period B so a comparison is
// always apples-to-apples — identical logic, just different inputs) ---

interface MonthRow {
  month: string;
  Phone: number;
  Zoom: number;
  Meetings: number;
  Mentees: number;
  Mentors: number;
}

function groupByMonth(appts: RangeAppt[]): Map<string, RangeAppt[]> {
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
}

function reduceMonthRows(
  buckets: { key: string; label: string }[],
  byMonth: Map<string, RangeAppt[]>,
  selectedTypes: Set<string> | null,
  isMentor: (coachId: number | null) => boolean
): MonthRow[] {
  return buckets.map((b) => {
    const items = byMonth.get(b.key) ?? [];
    let phone = 0;
    let zoom = 0;
    let meetings = 0;
    const mentees = new Set<number>();
    const mentors = new Set<number>();
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
  });
}

// Per-month converted count + conversion rate (%) — enough to overlay Period B's
// rate line on the conversion card.
function reduceConvRate(
  buckets: { key: string; label: string }[],
  byMonth: Map<string, RangeAppt[]>,
  outcomes: Map<number, ResolvedOutcome>
): { month: string; Rate: number }[] {
  return buckets.map((b) => {
    const items = (byMonth.get(b.key) ?? []).filter((a) => a.category !== "mentoring");
    let converted = 0;
    for (const a of items) {
      if (outcomes.get(a.id)?.outcome === "converted") converted++;
    }
    const total = items.length;
    return { month: b.label, Rate: total > 0 ? Math.round((converted / total) * 100) : 0 };
  });
}

function rangeLabel(from: string, to: string): string {
  return `${fmtDate(from)} → ${fmtDate(to)}`;
}

// A per-month Δ table for a single metric, zipping Period A and Period B by month
// index (presets keep the spans equal; custom ranges align as far as they go).
function buildCompareTable(
  label: string,
  aRows: { month: string; value: number }[],
  bRows: { month: string; value: number }[],
  deltaFmt: (a: number, b: number) => string
): ChartCardTable {
  const n = Math.max(aRows.length, bRows.length);
  const rows: ChartCardCell[][] = [];
  for (let i = 0; i < n; i++) {
    const a = aRows[i];
    const b = bRows[i];
    const av = a?.value ?? 0;
    const bv = b?.value ?? 0;
    rows.push([a?.month ?? "—", av, b?.month ?? "—", bv, deltaFmt(av, bv)]);
  }
  return { columns: ["Month (A)", `A ${label}`, "Month (B)", `B ${label}`, "Δ"], rows };
}

function ChartCard({
  title,
  children,
  extra,
  table,
  onExplore,
  helpId,
  sectionId,
}: {
  title: string;
  children: ReactElement;
  extra?: ReactElement;
  table?: ChartCardTable;
  onExplore?: () => void;
  helpId?: string;
  sectionId?: string;
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
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {title}
          {sectionId && <SectionId id={sectionId} />}
        </h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {helpId && <HelpButton id={helpId} label={title} />}
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
    <table className="table table--center">
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
  // Discovery → conversion card view toggles (both default on = current behavior).
  // Outcome coloring stacks the bars by converted/pending/not-converted/no-show;
  // channel split textures each segment (Zoom solid, Phone grid). Either can be
  // turned off independently — see the bar-builder near the chart render.
  const [convColorByOutcome, setConvColorByOutcome] = useState(true);
  const [convSplitByChannel, setConvSplitByChannel] = useState(true);
  // Trailing window for the conversion-rate trend line (Company option
  // `metrics_conversion_trend_window`). Org-wide; loaded once on mount.
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(DEFAULT_TREND_WINDOW);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [mentorIds, setMentorIds] = useState<Set<number>>(new Set());
  const [coachSettings, setCoachSettings] = useState<CoachWithSettings[]>([]);
  // clientId -> owner (CA primary coach). Capacity buckets each mentee under their
  // owner, not whoever ran each meeting. Empty until 9984 is applied + a re-sync.
  const [primaryCoach, setPrimaryCoach] = useState<Map<number, number>>(new Map());
  // "Meetings to Freedom!" report, loaded once (all-history, computed in db.ts off
  // the new mentees table — not scoped to the date range).
  const [freedomReport, setFreedomReport] = useState<FreedomReport | null>(null);
  const [jyfVsMentoring, setJyfVsMentoring] = useState<JyfVsMentoring | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [explore, setExplore] = useState<{ title: string; columns: string[]; rows: (string | number)[][] } | null>(
    null
  );

  // --- Compare mode (period vs period). Period A is the primary from/to above;
  // Period B is derived from A by the active preset (or free in "custom"). B's
  // data is fetched separately and only while compare mode is on. ---
  const [compareMode, setCompareMode] = useState(false);
  const [compareKey, setCompareKey] = useState<CompareKey>("yoy");
  const cmpInit = derivePeriodB("yoy", { from: INITIAL.from, to: INITIAL.to })!;
  const [cmpFrom, setCmpFrom] = useState(cmpInit.from); // custom-mode store / last derived
  const [cmpTo, setCmpTo] = useState(cmpInit.to);
  const [apptsB, setApptsB] = useState<RangeAppt[]>([]);
  const [manualB, setManualB] = useState<ManualMetricRow[]>([]);
  const [outcomesB, setOutcomesB] = useState<Map<number, ResolvedOutcome>>(new Map());
  const [loadingB, setLoadingB] = useState(false);

  // Theme-aware chart colors (recharts needs concrete values, not CSS vars).
  const ct = useChartTokens();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const CMP = ct.cmp;
  const TOOLTIP = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText } as const;
  const axisProps = { tick: { fill: AXIS, fontSize: 12 }, stroke: GRID } as const;

  // Effective Period B range: derived from A while a preset is active, otherwise
  // the user-edited custom range.
  const periodB = useMemo<{ from: string; to: string }>(() => {
    if (compareKey !== "custom") {
      const d = derivePeriodB(compareKey, { from, to });
      if (d) return d;
    }
    return { from: cmpFrom, to: cmpTo };
  }, [compareKey, from, to, cmpFrom, cmpTo]);

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

  // "Meetings to Freedom!" loads once (all-history). Not date-scoped, so it doesn't
  // re-fetch as the range changes.
  useEffect(() => {
    let cancelled = false;
    fetchFreedomReport()
      .then((r) => {
        if (!cancelled) setFreedomReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "JYF vs Active Mentoring" — current-state cohort snapshot (all-time, not
  // range-scoped), so it loads once like the journeys above.
  useEffect(() => {
    let cancelled = false;
    fetchJyfVsMentoring()
      .then((r) => {
        if (!cancelled) setJyfVsMentoring(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Period B (comparison) data — mirrors the Period A fetches, only while compare
  // mode is on. Clearing on toggle-off guarantees the view returns to the exact
  // single-period state.
  useEffect(() => {
    if (!compareMode) {
      setApptsB([]);
      setOutcomesB(new Map());
      return;
    }
    let cancelled = false;
    setLoadingB(true);
    fetchRangeAppointments(periodB.from, periodB.to)
      .then(async (rows) => {
        const disc = rows
          .filter((a) => a.category !== "mentoring")
          .map((a) => ({ id: a.id, clientId: a.clientId, date: a.date }));
        const out = await fetchResolvedOutcomes(disc);
        if (cancelled) return;
        setApptsB(rows);
        setOutcomesB(out);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingB(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareMode, periodB.from, periodB.to]);

  useEffect(() => {
    if (!compareMode) {
      setManualB([]);
      return;
    }
    let cancelled = false;
    fetchManualMetrics(periodB.from, periodB.to)
      .then((rows) => {
        if (!cancelled) setManualB(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [compareMode, periodB.from, periodB.to]);

  // Load the org-wide conversion-rate trend window (Company option). Fail-soft:
  // keep the default if app_settings / the key isn't there yet.
  useEffect(() => {
    let cancelled = false;
    fetchCompanyOptions()
      .then((opts) => {
        if (!cancelled) setTrendWindow(parseTrendWindow(opts["metrics_conversion_trend_window"]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    Promise.all([fetchMentorCoachIds(), fetchCoachesWithSettings(), fetchPrimaryCoachByClient()])
      .then(([ids, all, owners]) => {
        if (cancelled) return;
        setMentorIds(ids);
        setCoachSettings(all);
        setPrimaryCoach(owners);
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

  function applyComparePreset(key: CompareKey) {
    setCompareKey(key);
    const p = COMPARE_PRESETS.find((x) => x.key === key);
    if (p?.base) {
      const a = presetRange(p.base);
      setFrom(a.from);
      setTo(a.to);
      setPreset("custom");
      const b = derivePeriodB(key, a);
      if (b) {
        setCmpFrom(b.from);
        setCmpTo(b.to);
      }
    }
    // "custom": keep the current Period A and Period B as-is.
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

  const byMonth = useMemo(() => groupByMonth(appts), [appts]);

  // When staff have flagged any coaches as is_mentor, restrict the Mentors
  // metric to that whitelist (fixes the long-standing inflated-mentor-count
  // problem from CA's broader "coach" roster). Empty set = no filter.
  const isMentor = (coachId: number | null): boolean =>
    mentorIds.size === 0 || (coachId != null && mentorIds.has(coachId));

  const data = useMemo(
    () => reduceMonthRows(buckets, byMonth, selectedTypes, isMentor),
    [byMonth, buckets, selectedTypes, mentorIds]
  );

  // --- Period B equivalents (compare mode). Same reducers as A, fed B's data. ---
  const bBuckets = useMemo(() => monthBuckets(periodB.from, periodB.to), [periodB.from, periodB.to]);
  const bByMonth = useMemo(() => groupByMonth(apptsB), [apptsB]);
  const bData = useMemo(
    () => reduceMonthRows(bBuckets, bByMonth, selectedTypes, isMentor),
    [bBuckets, bByMonth, selectedTypes, mentorIds]
  );
  const bConvRate = useMemo(() => reduceConvRate(bBuckets, bByMonth, outcomesB), [bBuckets, bByMonth, outcomesB]);

  const bSelectedMentoring = useMemo(
    () => apptsB.filter((a) => a.category === "mentoring" && (!selectedTypes || selectedTypes.has(a.name))),
    [apptsB, selectedTypes]
  );
  const bDiscovery = useMemo(() => apptsB.filter((a) => a.category !== "mentoring"), [apptsB]);
  const bKpis = useMemo(
    () => ({
      discoveryTotal: bDiscovery.length,
      meetingsTotal: bSelectedMentoring.length,
      mentees: new Set(bSelectedMentoring.map((a) => a.clientId ?? -1)).size,
      mentors: new Set(bSelectedMentoring.filter((a) => isMentor(a.coachId)).map((a) => a.coachId ?? -1)).size,
    }),
    [bDiscovery, bSelectedMentoring, mentorIds]
  );
  const bConvRateTotal = useMemo(() => {
    let converted = 0;
    for (const a of bDiscovery) {
      if (outcomesB.get(a.id)?.outcome === "converted") converted++;
    }
    return bDiscovery.length > 0 ? converted / bDiscovery.length : null;
  }, [bDiscovery, outcomesB]);
  const bManualTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const def of MANUAL_METRICS) totals.set(def.key, 0);
    for (const r of manualB) totals.set(r.metric, (totals.get(r.metric) ?? 0) + r.value);
    return totals;
  }, [manualB]);

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
    // Distinct 1-on-1 mentees per coach, excluding both named group formats
    // (In Depth / Tracking Together) AND unnamed multi-client time slots — a
    // coach with 2+ mentees booked at the same start time is running a group,
    // not several 1-on-1s. Both otherwise inflate capacity (the "Arthur Nisly"
    // bug + its residual weekly-slot case). Capacity-only; these still count as
    // mentoring meetings/active mentees everywhere else.
    const byApptCoach = oneOnOneMenteesByCoach(
      selectedMentoring.map<CapacityAppt>((a) => ({
        coachId: a.coachId,
        clientId: a.clientId,
        isGroup: a.isGroup,
        slot: a.startRaw,
      }))
    );
    // Group-slot detection runs on the coach who actually ran each meeting (above),
    // then each surviving 1-on-1 mentee is bucketed under their OWNER (CA primary
    // coach) so a mentee counts once, under their owner — not under every coach
    // they happened to meet. Falls back to the meeting coach until owners are synced.
    const menteesByCoach = new Map<number, Set<number>>();
    for (const [apptCoach, clients] of byApptCoach) {
      for (const cid of clients) {
        const owner = primaryCoach.get(cid) ?? apptCoach;
        let set = menteesByCoach.get(owner);
        if (!set) {
          set = new Set();
          menteesByCoach.set(owner, set);
        }
        set.add(cid);
      }
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
  }, [coachSettings, selectedMentoring, primaryCoach]);

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
    let phone = 0;
    let zoom = 0;
    for (const a of discovery) {
      if (a.category === "discoveryPhone") phone++;
      else if (a.category === "discoveryZoom") zoom++;
      const o = outcomes.get(a.id);
      if (o) {
        counts[o.outcome]++;
        if (o.source === "manual") manualCount++;
      }
    }
    const total = discovery.length;
    return { total, counts, manualCount, phone, zoom, rate: total > 0 ? counts.converted / total : null };
  }, [discovery, outcomes]);

  // Per-month conversion series for the Discovery → conversion ChartCard. Each
  // discovery call is bucketed by signup month (same basis as the Discovery
  // calls card) and its resolved outcome tallied, so the converted-count bars
  // and the conversion-rate line track together as the range/filters move.
  const convData = useMemo(
    () =>
      buckets.map((b) => {
        const items = (byMonth.get(b.key) ?? []).filter((a) => a.category !== "mentoring");
        const counts: Record<DiscoveryOutcomeValue, number> = { converted: 0, not_converted: 0, pending: 0, no_show: 0 };
        // Per-outcome split by channel (phone vs zoom) so the bars can show both
        // the outcome (color) and the channel (phone = grid pattern, zoom = solid).
        const phone: Record<DiscoveryOutcomeValue, number> = { converted: 0, not_converted: 0, pending: 0, no_show: 0 };
        const zoom: Record<DiscoveryOutcomeValue, number> = { converted: 0, not_converted: 0, pending: 0, no_show: 0 };
        // Channel totals across all outcomes — for the "no color coding, split by
        // channel" view (one Phone bar + one Zoom bar per month).
        let totalPhone = 0;
        let totalZoom = 0;
        for (const a of items) {
          const o = outcomes.get(a.id);
          if (!o) continue;
          counts[o.outcome]++;
          if (a.category === "discoveryPhone") {
            phone[o.outcome]++;
            totalPhone++;
          } else {
            zoom[o.outcome]++; // zoom + any non-phone channel render solid
            totalZoom++;
          }
        }
        const total = items.length;
        return {
          month: b.label,
          _key: b.key, // YYYY-MM bucket key, for click-to-drill-down (not charted)
          Converted: counts.converted,
          Pending: counts.pending,
          "Not converted": counts.not_converted,
          "No show": counts.no_show,
          Converted_phone: phone.converted,
          Converted_zoom: zoom.converted,
          Pending_phone: phone.pending,
          Pending_zoom: zoom.pending,
          NotConverted_phone: phone.not_converted,
          NotConverted_zoom: zoom.not_converted,
          NoShow_phone: phone.no_show,
          NoShow_zoom: zoom.no_show,
          Total_phone: totalPhone,
          Total_zoom: totalZoom,
          Total: total,
          Rate: total > 0 ? Math.round((counts.converted / total) * 100) : 0,
        };
      }),
    [buckets, byMonth, outcomes]
  );

  const conversionTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Month", "Converted", "Pending", "Not converted", "No show", "Total", "Rate %"],
      rows: convData.map((d) => [d.month, d.Converted, d.Pending, d["Not converted"], d["No show"], d.Total, d.Rate]),
    }),
    [convData]
  );

  // Conversion-rate TREND line: a trailing-window rate (org-configured weeks/months)
  // instead of each month's raw rate. The table above keeps the exact per-month
  // rates; only the charted line is the windowed trend. Computed from the calls
  // loaded for the range, so the earliest buckets warm up over a shorter window.
  const trendLabel = useMemo(() => trendWindowLabel(trendWindow), [trendWindow]);
  const convCalls = useMemo<TrendCall[]>(
    () => discovery.filter((a) => a.date).map((a) => ({ date: a.date!, converted: outcomes.get(a.id)?.outcome === "converted" })),
    [discovery, outcomes]
  );
  const convTrend = useMemo(() => rollingConversionTrend(convCalls, buckets, trendWindow), [convCalls, buckets, trendWindow]);
  const convChartData = useMemo(
    () => convData.map((d, i) => ({ ...d, RateTrend: convTrend[i]?.rate ?? null })),
    [convData, convTrend]
  );
  // Period B's trend (compare mode), same window.
  const bConvCalls = useMemo<TrendCall[]>(
    () => bDiscovery.filter((a) => a.date).map((a) => ({ date: a.date!, converted: outcomesB.get(a.id)?.outcome === "converted" })),
    [bDiscovery, outcomesB]
  );
  const bConvTrend = useMemo(() => rollingConversionTrend(bConvCalls, bBuckets, trendWindow), [bConvCalls, bBuckets, trendWindow]);

  // "Meetings to Freedom!" — 1-on-1 mentoring sessions from JumpStart completion to
  // graduation, per graduated mentee. Computed in db.ts off the new mentees table
  // (all-history; test mentees dropped); loaded once into `freedomReport`.
  const freedomBars = useMemo(
    () => (freedomReport ? freedomReport.rows.map((r) => ({ name: r.name, meetings: r.meetings })) : []),
    [freedomReport]
  );
  const freedomTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Mentee", "JumpStart completed", "Graduated", "1-on-1 sessions"],
      rows: freedomReport ? freedomReport.rows.map((r) => [r.name, fmtDate(r.windowStart), fmtDate(r.graduationDate), r.meetings]) : [],
    }),
    [freedomReport]
  );

  // "JYF vs Active Mentoring" — two bars (distinct people per phase). The table
  // adds the per-tier mentoring breakdown + the de-duplicated pipeline total.
  const jyfBars = useMemo(
    () =>
      jyfVsMentoring
        ? [
            { phase: "JumpStart (JYF)", people: jyfVsMentoring.jyf },
            { phase: "Active Mentoring", people: jyfVsMentoring.mentoring },
          ]
        : [],
    [jyfVsMentoring]
  );
  const jyfTable = useMemo<ChartCardTable>(
    () => ({
      columns: ["Cohort", "People"],
      rows: jyfVsMentoring
        ? [
            ["JumpStart (JYF) — open", jyfVsMentoring.jyf],
            ["Active Mentoring (4x + 2x + 1x) — open", jyfVsMentoring.mentoring],
            ["• 4x", jyfVsMentoring.byTier["4x"]],
            ["• 2x", jyfVsMentoring.byTier["2x"]],
            ["• 1x", jyfVsMentoring.byTier["1x"]],
            ["Total in pipeline (distinct)", jyfVsMentoring.total],
          ]
        : [],
    }),
    [jyfVsMentoring]
  );

  // --- Compare-mode derived views: a board scorecard (all KPIs A vs B with Δ),
  // per-chart Period-B overlay datasets (aligned to A by month index), and
  // per-card Δ tables. All inert unless compareMode is on. ---
  const scoreBars = useMemo(
    () => [
      { metric: "Discovery", A: kpis.discoveryTotal, B: bKpis.discoveryTotal },
      { metric: "Meetings", A: kpis.meetingsTotal, B: bKpis.meetingsTotal },
      { metric: "Mentees", A: kpis.mentees, B: bKpis.mentees },
      { metric: "Mentors", A: kpis.mentors, B: bKpis.mentors },
    ],
    [kpis, bKpis]
  );

  const scoreTable = useMemo<ChartCardTable>(() => {
    const rows: ChartCardCell[][] = [];
    const countRow = (label: string, a: number, b: number) => {
      const d = delta(a, b);
      rows.push([label, a, b, signed(d.abs), signedPct(d.pct)]);
    };
    countRow("Discovery calls", kpis.discoveryTotal, bKpis.discoveryTotal);
    countRow("Mentee meetings", kpis.meetingsTotal, bKpis.meetingsTotal);
    countRow("Active mentees", kpis.mentees, bKpis.mentees);
    countRow("Mentors", kpis.mentors, bKpis.mentors);
    const aRate = Math.round((conv.rate ?? 0) * 100);
    const bRate = Math.round((bConvRateTotal ?? 0) * 100);
    rows.push(["Conversion rate", `${aRate}%`, `${bRate}%`, signedPp(aRate - bRate), "—"]);
    for (const m of MANUAL_METRICS) {
      countRow(m.label, manualTotals.get(m.key) ?? 0, bManualTotals.get(m.key) ?? 0);
    }
    return { columns: ["Metric", "Period A", "Period B", "Δ", "Δ%"], rows };
  }, [kpis, bKpis, conv.rate, bConvRateTotal, manualTotals, bManualTotals]);

  // Overlay datasets: A's per-month rows carry a `cmp` field = Period B's value
  // for the same metric at the same month index (presets keep spans equal).
  const cmpMentees = useMemo(() => data.map((d, i) => ({ ...d, cmp: bData[i]?.Mentees ?? 0 })), [data, bData]);
  const cmpMentors = useMemo(() => data.map((d, i) => ({ ...d, cmp: bData[i]?.Mentors ?? 0 })), [data, bData]);
  const cmpConv = useMemo(
    () =>
      convChartData.map((d, i) => ({
        ...d,
        cmp: bConvRate[i]?.Rate ?? 0,
        cmpTrend: bConvTrend[i]?.rate ?? null,
      })),
    [convChartData, bConvRate, bConvTrend]
  );

  // The conversion bars adapt to the two card toggles:
  //   • outcome coloring  → stack by converted/pending/not-converted/no-show (one color each)
  //   • channel split     → texture each segment (Zoom solid, Phone grid)
  // Off ⇒ the bars collapse: no coloring → a single neutral series; no channel
  // split → one solid bar per segment. All four combinations are covered below.
  const convBars = useMemo<ReactElement[]>(() => {
    const NEUTRAL = ct.accent;
    if (convColorByOutcome && convSplitByChannel) {
      // Default — per-outcome color × channel texture (Zoom solid + Phone grid).
      return OUTCOME_ORDER.flatMap((k, oi) => {
        const top = oi === OUTCOME_ORDER.length - 1;
        return [
          <Bar
            key={`${k}-zoom`}
            yAxisId="left"
            stackId="calls"
            dataKey={`${OUTCOME_KEYBASE[k]}_zoom`}
            name={OUTCOME_LABELS[k]}
            fill={OUTCOME_COLORS[k]}
          />,
          <Bar
            key={`${k}-phone`}
            yAxisId="left"
            stackId="calls"
            dataKey={`${OUTCOME_KEYBASE[k]}_phone`}
            legendType="none"
            fill={`url(#ptn-${k})`}
            radius={top ? [4, 4, 0, 0] : undefined}
          />,
        ];
      });
    }
    if (convColorByOutcome) {
      // Outcome color only — one solid bar per outcome, no channel texture.
      return OUTCOME_ORDER.map((k, oi) => (
        <Bar
          key={k}
          yAxisId="left"
          stackId="calls"
          dataKey={OUTCOME_LABELS[k]}
          name={OUTCOME_LABELS[k]}
          fill={OUTCOME_COLORS[k]}
          radius={oi === OUTCOME_ORDER.length - 1 ? [4, 4, 0, 0] : undefined}
        />
      ));
    }
    if (convSplitByChannel) {
      // Channel split only — a neutral Zoom bar (solid) + Phone bar (grid).
      return [
        <Bar key="total-zoom" yAxisId="left" stackId="calls" dataKey="Total_zoom" name="Zoom" fill={NEUTRAL} />,
        <Bar
          key="total-phone"
          yAxisId="left"
          stackId="calls"
          dataKey="Total_phone"
          name="Phone"
          fill="url(#ptn-total)"
          radius={[4, 4, 0, 0]}
        />,
      ];
    }
    // Neither — one neutral solid bar of total discovery calls.
    return [
      <Bar key="total" yAxisId="left" dataKey="Total" name="Discovery calls" fill={NEUTRAL} radius={[4, 4, 0, 0]} />,
    ];
  }, [convColorByOutcome, convSplitByChannel, ct.accent]);

  const meetingsCompareTable = useMemo(
    () =>
      buildCompareTable(
        "meetings",
        data.map((d) => ({ month: d.month, value: d.Meetings })),
        bData.map((d) => ({ month: d.month, value: d.Meetings })),
        (a, b) => signed(a - b)
      ),
    [data, bData]
  );
  const menteesCompareTable = useMemo(
    () =>
      buildCompareTable(
        "mentees",
        data.map((d) => ({ month: d.month, value: d.Mentees })),
        bData.map((d) => ({ month: d.month, value: d.Mentees })),
        (a, b) => signed(a - b)
      ),
    [data, bData]
  );
  const mentorsCompareTable = useMemo(
    () =>
      buildCompareTable(
        "mentors",
        data.map((d) => ({ month: d.month, value: d.Mentors })),
        bData.map((d) => ({ month: d.month, value: d.Mentors })),
        (a, b) => signed(a - b)
      ),
    [data, bData]
  );
  const conversionCompareTable = useMemo(
    () =>
      buildCompareTable(
        "rate %",
        convData.map((d) => ({ month: d.month, value: d.Rate })),
        bConvRate.map((d) => ({ month: d.month, value: d.Rate })),
        (a, b) => signedPp(a - b)
      ),
    [convData, bConvRate]
  );

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
  // Drill-down: clicking a bar in the Discovery → conversion chart opens the
  // Explore modal scoped to just that month's discovery calls (same columns as
  // the card-level explore, filtered to the clicked month — built from the exact
  // rows that made the bar, so it always reconciles).
  function exploreConversionMonth(key: string, label: string) {
    const items = (byMonth.get(key) ?? []).filter((a) => a.category !== "mentoring");
    const rows = [...items]
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
      title: `Discovery calls — ${label}`,
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
      <BarChart data={compareMode ? data.map((d, i) => ({ ...d, cmp: bData[i]?.Meetings ?? 0 })) : data}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis allowDecimals={false} width={28} {...axisProps} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
        {compareMode && <Legend wrapperStyle={{ fontSize: 12 }} />}
        <Bar dataKey="Meetings" name="Period A" fill={C.meetings} radius={[4, 4, 0, 0]} />
        {compareMode && <Bar dataKey="cmp" name="Period B" fill={CMP} radius={[4, 4, 0, 0]} />}
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
          {compareMode
            ? COMPARE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`chip ${compareKey === p.key ? "chip--active" : ""}`}
                  onClick={() => applyComparePreset(p.key)}
                >
                  {p.label}
                </button>
              ))
            : PRESETS.map((p) => (
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
          <button
            className={`chip ${compareMode ? "chip--active" : ""}`}
            onClick={() => setCompareMode((v) => !v)}
            title="Compare two periods side by side"
          >
            {compareMode ? "Comparing ✓" : "Compare"}
          </button>
          <label className="field field--inline">
            <span>{compareMode ? "A from" : "From"}</span>
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
            <span>{compareMode ? "A to" : "To"}</span>
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
          {compareMode && (
            <>
              <label className="field field--inline">
                <span>B from</span>
                <input
                  type="date"
                  value={periodB.from}
                  max={periodB.to}
                  onChange={(e) => {
                    // Seed the other endpoint from the currently-shown range so a
                    // preset→custom switch doesn't snap B to a stale value.
                    setCmpTo(periodB.to);
                    setCmpFrom(e.target.value);
                    setCompareKey("custom");
                  }}
                />
              </label>
              <label className="field field--inline">
                <span>B to</span>
                <input
                  type="date"
                  value={periodB.to}
                  min={periodB.from}
                  onChange={(e) => {
                    setCmpFrom(periodB.from);
                    setCmpTo(e.target.value);
                    setCompareKey("custom");
                  }}
                />
              </label>
            </>
          )}
          {(loading || loadingB) && <span className="muted">Loading…</span>}
        </div>
      </div>

      {lastSync && (
        <p className="view__hint" style={{ marginTop: 4 }}>
          Data as of {fmtDateTime(lastSync)} — re-sync on the Admin tab to refresh.
        </p>
      )}

      {error && <div className="notice notice--warn">{error}</div>}

      {!ready && loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          {compareMode && (
            <div style={{ marginBottom: 18 }}>
              <ChartCard
                title="Compare: Period A vs Period B"
                helpId="metrics.compare"
                sectionId="metrics.compare"
                table={scoreTable}
                extra={
                  <p className="view__hint" style={{ marginTop: 0 }}>
                    <strong>Period A</strong> {rangeLabel(from, to)} &nbsp;vs&nbsp; <strong>Period B</strong>{" "}
                    {rangeLabel(periodB.from, periodB.to)}. Bars compare the four headline KPIs; the table covers
                    every metric with Δ (absolute) and Δ% (change vs Period B). Conversion-rate Δ is in percentage
                    points.{loadingB && <> · loading Period B…</>}
                  </p>
                }
              >
                <BarChart data={scoreBars}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="metric" {...axisProps} />
                  <YAxis allowDecimals={false} width={28} {...axisProps} />
                  <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="A" name="Period A" fill={C.mentees} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="B" name="Period B" fill={CMP} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartCard>
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <ChartCard
              title="Discovery calls → conversion"
              helpId="metrics.conversion"
              sectionId="metrics.conversion"
              extra={
                <>
                  <p className="view__hint">
                    Every discovery call and how it resolved. Auto-computed: a call converts when the prospect buys
                    JumpStart Your Freedom (Waiting List) on or after the call. With no purchase it stays pending for 30
                    days, then becomes not converted. Staff overrides on the Discovery tab take precedence. Overall
                    conversion rate: <strong>{pct(conv.rate)}</strong>
                    {conv.manualCount > 0 && <> · {num(conv.manualCount)} set manually</>}
                    {convSplitByChannel && (
                      <> · <span style={{ whiteSpace: "nowrap" }}>bars: solid = Zoom, grid = Phone</span></>
                    )}
                    {!compareMode && <> · <em>click a bar to see that month's calls</em></>}
                    <> · <span style={{ whiteSpace: "nowrap" }}>line = {trendLabel} trailing trend (set in Company options)</span></>
                  </p>
                  <div className="type-filter__head" style={{ marginBottom: 10 }}>
                    <span className="muted">Bar coding:</span>
                    <label className="type-filter__item">
                      <input
                        type="checkbox"
                        checked={convColorByOutcome}
                        onChange={() => setConvColorByOutcome((v) => !v)}
                      />
                      <span>Color by outcome</span>
                    </label>
                    <label className="type-filter__item">
                      <input
                        type="checkbox"
                        checked={convSplitByChannel}
                        onChange={() => setConvSplitByChannel((v) => !v)}
                      />
                      <span>Split by method (Zoom / Phone)</span>
                    </label>
                  </div>
                  <div className="stat-row">
                    <div className="stat">
                      <span className="stat__value">{num(conv.total)}</span>
                      <span className="stat__label">Discovery calls</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{num(conv.phone)}</span>
                      <span className="stat__label">Phone</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{num(conv.zoom)}</span>
                      <span className="stat__label">Zoom</span>
                    </div>
                    {(Object.keys(OUTCOME_LABELS) as DiscoveryOutcomeValue[]).map((k) => (
                      <div className="stat" key={k}>
                        <span className="stat__value" style={{ color: OUTCOME_COLORS[k] }}>{num(conv.counts[k])}</span>
                        <span className="stat__label">{OUTCOME_LABELS[k]}</span>
                      </div>
                    ))}
                  </div>
                </>
              }
              table={compareMode ? conversionCompareTable : conversionTable}
              onExplore={exploreDiscoveryRaw}
            >
              <ComposedChart
                data={compareMode ? cmpConv : convChartData}
                onClick={
                  compareMode
                    ? undefined
                    : // recharts' click state isn't cleanly typed; read the active row defensively.
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (s: any) => {
                        const p = s?.activePayload?.[0]?.payload as { _key?: string; month?: string } | undefined;
                        if (p?._key) exploreConversionMonth(p._key, p.month ?? p._key);
                      }
                }
                style={compareMode ? undefined : { cursor: "pointer" }}
              >
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis yAxisId="left" allowDecimals={false} width={28} {...axisProps} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={40}
                  domain={[0, 100]}
                  unit="%"
                  {...axisProps}
                />
                <defs>
                  {OUTCOME_ORDER.map((k) => (
                    <pattern key={k} id={`ptn-${k}`} width="6" height="6" patternUnits="userSpaceOnUse">
                      <rect width="6" height="6" fill={OUTCOME_COLORS[k]} />
                      <path d="M6 0 V6 M0 6 H6" stroke="rgba(15,23,42,0.55)" strokeWidth="1" />
                    </pattern>
                  ))}
                  {/* Neutral grid for the "split by channel, no coloring" view. */}
                  <pattern id="ptn-total" width="6" height="6" patternUnits="userSpaceOnUse">
                    <rect width="6" height="6" fill={ct.accent} />
                    <path d="M6 0 V6 M0 6 H6" stroke="rgba(15,23,42,0.55)" strokeWidth="1" />
                  </pattern>
                </defs>
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Legend />
                {convBars}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="RateTrend"
                  name={`Conversion rate (${trendLabel} trend)`}
                  unit="%"
                  stroke={C.rate}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                {compareMode && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cmpTrend"
                    name={`Period B (${trendLabel} trend)`}
                    unit="%"
                    stroke={CMP}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 2 }}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ChartCard>
          </div>

          <div style={{ marginTop: 18 }}>
            <ChartCard
              title="Meetings to Freedom!"
              helpId="metrics.freedom"
              sectionId="metrics.freedom"
              table={freedomTable}
              extra={
                <>
                  <p className="view__hint">
                    1-on-1 mentoring sessions (4x / 2x / 1x) from the completion of{" "}
                    <strong>JumpStart Your Freedom</strong> to <strong>graduation</strong>, per graduated mentee. Group
                    sessions don't count. <em>All-time — not affected by the date range above.</em>
                  </p>
                  <div className="stat-row">
                    <div className="stat">
                      <span className="stat__value">{freedomReport?.avg ?? "—"}</span>
                      <span className="stat__label">Avg to freedom</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{freedomReport?.median ?? "—"}</span>
                      <span className="stat__label">Median</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{num(freedomReport?.n ?? 0)}</span>
                      <span className="stat__label">Graduates measured</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">
                        {freedomReport?.min ?? "—"}–{freedomReport?.max ?? "—"}
                      </span>
                      <span className="stat__label">Range</span>
                    </div>
                  </div>
                  {(freedomReport?.unmeasured ?? 0) > 0 && (
                    <p className="view__hint" style={{ marginTop: 4 }}>
                      {num(freedomReport?.unmeasured ?? 0)} graduated mentee{freedomReport?.unmeasured === 1 ? "" : "s"} omitted
                      (missing a JumpStart-completion or graduation date).
                    </p>
                  )}
                </>
              }
            >
              <BarChart data={freedomBars} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={72} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="meetings" name="1-on-1 sessions" fill={C.mentees} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>

          <div style={{ marginTop: 18 }}>
            <ChartCard
              title="JYF vs Active Mentoring"
              helpId="metrics.jyfVsMentoring"
              sectionId="metrics.jyfVsMentoring"
              table={jyfTable}
              extra={
                <>
                  <p className="view__hint">
                    People currently in an <strong>open JumpStart Your Freedom</strong> engagement vs. people in{" "}
                    <strong>open ongoing mentoring</strong> (4x / 2x / 1x). Counts distinct people; completed or canceled
                    engagements drop out. <em>All-time snapshot — not affected by the date range above.</em>
                  </p>
                  <div className="stat-row">
                    <div className="stat">
                      <span className="stat__value" style={{ color: C.mentees }}>
                        {jyfVsMentoring ? num(jyfVsMentoring.jyf) : "—"}
                      </span>
                      <span className="stat__label">In JumpStart (JYF)</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value" style={{ color: C.meetings }}>
                        {jyfVsMentoring ? num(jyfVsMentoring.mentoring) : "—"}
                      </span>
                      <span className="stat__label">In Active Mentoring</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{jyfVsMentoring ? num(jyfVsMentoring.byTier["4x"]) : "—"}</span>
                      <span className="stat__label">4x</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{jyfVsMentoring ? num(jyfVsMentoring.byTier["2x"]) : "—"}</span>
                      <span className="stat__label">2x</span>
                    </div>
                    <div className="stat">
                      <span className="stat__value">{jyfVsMentoring ? num(jyfVsMentoring.byTier["1x"]) : "—"}</span>
                      <span className="stat__label">1x</span>
                    </div>
                  </div>
                </>
              }
            >
              <BarChart data={jyfBars} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="phase" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="people" name="People" radius={[4, 4, 0, 0]}>
                  <Cell fill={C.mentees} />
                  <Cell fill={C.meetings} />
                </Bar>
              </BarChart>
            </ChartCard>
          </div>

          <div style={{ marginTop: 18 }}>
            <ChartCard
              title="Mentee meetings"
              helpId="metrics.meetings"
              sectionId="metrics.meetings"
              extra={meetingsExtra}
              table={compareMode ? meetingsCompareTable : meetingsTable}
              onExplore={exploreMeetingsRaw}
            >
              {meetingsChart}
            </ChartCard>
          </div>

          <div className="grid" style={{ marginTop: 18 }}>
            <ChartCard
              title="Active mentees"
              helpId="metrics.mentees"
              sectionId="metrics.mentees"
              table={compareMode ? menteesCompareTable : menteesTable}
              onExplore={exploreMenteesRaw}
            >
              <LineChart data={compareMode ? cmpMentees : data}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} />
                {compareMode && <Legend wrapperStyle={{ fontSize: 12 }} />}
                <Line type="monotone" dataKey="Mentees" name="Period A" stroke={C.mentees} strokeWidth={2} dot={{ r: 3 }} />
                {compareMode && (
                  <Line
                    type="monotone"
                    dataKey="cmp"
                    name="Period B"
                    stroke={CMP}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 2 }}
                  />
                )}
              </LineChart>
            </ChartCard>

            <ChartCard
              title="Mentors"
              helpId="metrics.mentors"
              sectionId="metrics.mentors"
              table={compareMode ? mentorsCompareTable : mentorsTable}
              onExplore={exploreMentorsRaw}
            >
              <BarChart data={compareMode ? cmpMentors : data}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis allowDecimals={false} width={28} {...axisProps} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                {compareMode && <Legend wrapperStyle={{ fontSize: 12 }} />}
                <Bar dataKey="Mentors" name="Period A" fill={C.mentors} radius={[4, 4, 0, 0]} />
                {compareMode && <Bar dataKey="cmp" name="Period B" fill={CMP} radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ChartCard>
          </div>

          <section className="card" style={{ marginTop: 18 }}>
            <div className="card__head">
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Mentor capacity utilization <HelpButton id="metrics.capacity" label="Mentor capacity utilization" />
                <SectionId id="metrics.capacity" />
              </h2>
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
                  <table className="table table--center">
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
              helpId="metrics.resource"
              sectionId="metrics.resource"
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
