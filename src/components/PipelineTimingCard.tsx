import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchMentees,
  fetchCompanyOptions,
  stageColorsFromRaw,
  toEffectiveMentee,
  aggregateLegDurations,
  inStartWindow,
  summarizeCohort,
  startWindowLabel,
  COHORT_TIERS,
  DEFAULT_STAGE_COLORS,
  type EffectiveMentee,
  type CohortStats,
  type StartWindow,
  type CohortTier,
} from "../db";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";
import { useChartTokens } from "../theme";
import { pct, signed, signedPp } from "../format";

// Pipeline-timing leg -> stage-palette index of the stage the leg leads INTO.
// (0 Discovery, 1 JumpStart, 2 4x, 3 2x, 4 1x, 5 Graduation.)
const LEG_COLOR_INDEX: Record<string, number> = { dc_js: 1, js_4x: 2, "4x_2x": 3, "2x_1x": 4, "1x_grad": 5 };
const TIER_LABEL: Record<CohortTier, string> = { jumpstart: "JumpStart", "4x": "4x", "2x": "2x", "1x": "1x", graduated: "Graduated" };
const EXIT_STATUSES = ["quit", "fired", "no_mentoring", "declined"];

function humanizeDays(n: number | null): string {
  if (n == null || n < 0) return "—";
  if (n < 60) return `${n} day${n === 1 ? "" : "s"}`;
  const months = Math.round(n / 30.44);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years}y`;
}
function ymdToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const toCohortInput = (m: EffectiveMentee) => ({
  startDate: m.startDate,
  daysInSystem: m.daysInSystem,
  resolvedStatus: m.resolvedStatus,
  currentTier: m.currentTier,
  excluded: m.isTest,
  inSourceOfTruth: true,
});

// Board-level pipeline-leg timing (the former Journeys §102), now a Metrics card
// reading the materialized mentees table. Includes the start-date cohort compare.
export function PipelineTimingCard() {
  const ct = useChartTokens();
  const [mentees, setMentees] = useState<EffectiveMentee[]>([]);
  const [stageColors, setStageColors] = useState<string[]>(DEFAULT_STAGE_COLORS);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => ymdToday(), []);

  useEffect(() => {
    let cancelled = false;
    fetchMentees()
      .then((rows) => !cancelled && setMentees(rows.map((r) => toEffectiveMentee(r, today))))
      .catch((e) => !cancelled && setError(String(e)));
    fetchCompanyOptions()
      .then((o) => !cancelled && setStageColors(stageColorsFromRaw(o.journeys_stage_colors)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [today]);

  const legColor = (key: string) => stageColors[LEG_COLOR_INDEX[key] ?? 0] ?? ct.accent;
  const TOOLTIP = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText };

  // Filters
  const [statusF, setStatusF] = useState("all");
  const [tierF, setTierF] = useState("all");
  const [ownerF, setOwnerF] = useState("all");
  const [compareMode, setCompareMode] = useState(false);
  const [aFrom, setAFrom] = useState(0);
  const [aTo, setATo] = useState(3);
  const [bFrom, setBFrom] = useState(4);
  const [bTo, setBTo] = useState(6);
  const clampMo = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const anyFilter = statusF !== "all" || tierF !== "all" || ownerF !== "all";

  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const m of mentees) if (!m.isTest && m.ownerCoachName) s.add(m.ownerCoachName);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [mentees]);

  // Base population (filters, minus the start-date split).
  const cohort = useMemo(() => {
    return mentees.filter((m) => {
      if (m.isTest) return false;
      if (statusF === "exited") {
        if (!EXIT_STATUSES.includes(m.resolvedStatus)) return false;
      } else if (statusF !== "all" && m.resolvedStatus !== statusF) return false;
      if (tierF !== "all" && m.currentTier !== tierF) return false;
      if (ownerF !== "all" && m.ownerCoachName !== ownerF) return false;
      return true;
    });
  }, [mentees, statusF, tierF, ownerF]);

  const legs = useMemo(() => aggregateLegDurations(cohort), [cohort]);
  const counts = useMemo(() => {
    let active = 0;
    let graduated = 0;
    for (const m of cohort) {
      if (m.resolvedStatus === "active") active++;
      if (m.resolvedStatus === "graduated") graduated++;
    }
    return { total: cohort.length, active, graduated };
  }, [cohort]);
  const rosterTotal = useMemo(() => mentees.filter((m) => !m.isTest).length, [mentees]);
  const grad = legs.find((l) => l.key === "dc_grad");
  const displayLegs = legs.filter((l) => l.key !== "dc_grad");
  const chartData = displayLegs.map((l) => ({ leg: l.label, avg: l.avgDays, color: legColor(l.key) }));

  // Compare cohorts by start date.
  const winA: StartWindow = { fromMonths: aFrom, toMonths: aTo };
  const winB: StartWindow = { fromMonths: bFrom, toMonths: bTo };
  const labelA = startWindowLabel(winA);
  const labelB = startWindowLabel(winB);
  const cohortA = useMemo(() => cohort.filter((m) => inStartWindow(m.startDate, winA, today)), [cohort, aFrom, aTo, today]);
  const cohortB = useMemo(() => cohort.filter((m) => inStartWindow(m.startDate, winB, today)), [cohort, bFrom, bTo, today]);
  const legsA = useMemo(() => aggregateLegDurations(cohortA), [cohortA]);
  const legsB = useMemo(() => aggregateLegDurations(cohortB), [cohortB]);
  const statsA: CohortStats = useMemo(() => summarizeCohort(cohortA.map(toCohortInput)), [cohortA]);
  const statsB: CohortStats = useMemo(() => summarizeCohort(cohortB.map(toCohortInput)), [cohortB]);
  const gradA = legsA.find((l) => l.key === "dc_grad");
  const gradB = legsB.find((l) => l.key === "dc_grad");
  const cmpLegs = useMemo(() => {
    const ad = legsA.filter((l) => l.key !== "dc_grad");
    const bd = legsB.filter((l) => l.key !== "dc_grad");
    return ad.map((l, i) => ({ key: l.key, leg: l.label, avgA: l.avgDays, nA: l.n, avgB: bd[i]?.avgDays ?? null, nB: bd[i]?.n ?? 0 }));
  }, [legsA, legsB]);
  const dDelta = (a: number | null, b: number | null) => (a != null && b != null ? `${signed(a - b)}d` : "—");
  const ppDelta = (a: number | null, b: number | null) => (a != null && b != null ? signedPp((a - b) * 100) : "—");
  const tierPct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

  if (error) return <div className="error">{error}</div>;

  return (
    <div className="card card--inset" style={{ marginBottom: 18 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Pipeline timing — {compareMode ? "comparing start-date cohorts" : `${anyFilter ? "filtered" : "all"} mentees`}{" "}
        <HelpButton id="metrics.pipelineTiming" label="Pipeline timing" />
        <SectionId id="metrics.pipelineTiming" />
      </h2>
      <p className="view__hint">
        Average time each leg of the journey takes (Discovery → JumpStart → 4x → 2x → 1x → Graduation), across every mentee where
        both ends are known (n shown per leg). Off the Mentees source of truth (effective dates); test mentees excluded. All-time.
      </p>

      <div className="journey-filters">
        <label className="journey-filters__field">
          <span>Status</span>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="all">Any</option>
            <option value="active">Active</option>
            <option value="graduated">Graduated</option>
            <option value="exited">Exited (declined / quit / fired / no mentoring)</option>
            <option value="imn">IMN</option>
          </select>
        </label>
        <label className="journey-filters__field">
          <span>Current tier</span>
          <select value={tierF} onChange={(e) => setTierF(e.target.value)}>
            <option value="all">Any</option>
            <option value="jumpstart">JumpStart</option>
            <option value="4x">4x</option>
            <option value="2x">2x</option>
            <option value="1x">1x</option>
            <option value="graduated">Graduated</option>
          </select>
        </label>
        {owners.length > 0 && (
          <label className="journey-filters__field">
            <span>Owner</span>
            <select value={ownerF} onChange={(e) => setOwnerF(e.target.value)}>
              <option value="all">Any</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="journey-filters__check" title="Split the roster into two start-date bands and compare how each is doing">
          <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
          <span>Compare start-date cohorts</span>
        </label>
        <span className="journey-filters__count muted">
          {compareMode ? (
            <>
              A: {statsA.total} · B: {statsB.total}
            </>
          ) : (
            <>
              Showing {counts.total} of {rosterTotal}
            </>
          )}
        </span>
      </div>

      {compareMode && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, margin: "4px 0 14px", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            “Start” = system start (discovery → JumpStart → JYF → first meeting), the basis for days in system.
          </span>
          {(
            [
              { tag: "A", color: ct.accent, from: aFrom, to: aTo, setFrom: setAFrom, setTo: setATo, n: statsA.total },
              { tag: "B", color: ct.cmp, from: bFrom, to: bTo, setFrom: setBFrom, setTo: setBTo, n: statsB.total },
            ] as const
          ).map((c) => (
            <span key={c.tag} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: c.color, display: "inline-block" }} />
              <strong>Cohort {c.tag}</strong> — started
              <input type="number" min={0} value={c.from} onChange={(e) => c.setFrom(clampMo(e.target.value))} style={{ width: 52 }} />
              to
              <input type="number" min={0} value={c.to} onChange={(e) => c.setTo(clampMo(e.target.value))} style={{ width: 52 }} />
              months ago
              <span className="muted">· {c.n} mentees</span>
            </span>
          ))}
        </div>
      )}

      {compareMode ? (
        <>
          <div className="table-scroll" style={{ marginBottom: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>How they’re doing</th>
                  <th>
                    <span style={{ color: ct.accent }}>● </span>A · {labelA}
                  </th>
                  <th>
                    <span style={{ color: ct.cmp }}>● </span>B · {labelB}
                  </th>
                  <th>Δ (A − B)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Mentees</td>
                  <td className="num">{statsA.total}</td>
                  <td className="num">{statsB.total}</td>
                  <td className="num">{signed(statsA.total - statsB.total)}</td>
                </tr>
                <tr>
                  <td>Avg days in system</td>
                  <td className="num">{humanizeDays(statsA.avgDaysInSystem)}</td>
                  <td className="num">{humanizeDays(statsB.avgDaysInSystem)}</td>
                  <td className="num">{dDelta(statsA.avgDaysInSystem, statsB.avgDaysInSystem)}</td>
                </tr>
                <tr>
                  <td>Avg time to graduate</td>
                  <td className="num">{humanizeDays(gradA?.avgDays ?? null)}</td>
                  <td className="num">{humanizeDays(gradB?.avgDays ?? null)}</td>
                  <td className="num">{dDelta(gradA?.avgDays ?? null, gradB?.avgDays ?? null)}</td>
                </tr>
                <tr>
                  <td>% graduated</td>
                  <td className="num">{pct(statsA.pctGraduated)}</td>
                  <td className="num">{pct(statsB.pctGraduated)}</td>
                  <td className="num">{ppDelta(statsA.pctGraduated, statsB.pctGraduated)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="chart-card__split chart-card__split--both">
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cmpLegs} layout="vertical" margin={{ left: 8, right: 56 }} barGap={2}>
                  <CartesianGrid stroke={ct.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} unit="d" />
                  <YAxis type="category" dataKey="leg" width={150} tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
                  <Tooltip
                    contentStyle={TOOLTIP}
                    cursor={{ fill: "rgba(148,163,184,0.08)" }}
                    formatter={(v, n) => [v == null ? "—" : `${v}d`, n === "avgA" ? labelA : labelB]}
                  />
                  <Bar dataKey="avgA" fill={ct.accent} radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="avgA" position="right" style={{ fill: ct.axis, fontSize: 10 }} formatter={(v) => (v == null ? "" : `${v}d`)} />
                  </Bar>
                  <Bar dataKey="avgB" fill={ct.cmp} radius={[0, 3, 3, 0]}>
                    <LabelList dataKey="avgB" position="right" style={{ fill: ct.axis, fontSize: 10 }} formatter={(v) => (v == null ? "" : `${v}d`)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="table-scroll" style={{ width: "100%" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Stage leg</th>
                    <th>A n</th>
                    <th>A avg</th>
                    <th>B n</th>
                    <th>B avg</th>
                    <th>Δ (A − B)</th>
                  </tr>
                </thead>
                <tbody>
                  {cmpLegs.map((l) => (
                    <tr key={l.key}>
                      <td>{l.leg}</td>
                      <td className="num">{l.nA}</td>
                      <td className="num">{humanizeDays(l.avgA)}</td>
                      <td className="num">{l.nB}</td>
                      <td className="num">{humanizeDays(l.avgB)}</td>
                      <td className="num">{dDelta(l.avgA, l.avgB)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <h3 style={{ margin: "8px 0 6px", fontSize: 14 }}>Current-tier mix (how far each cohort has progressed)</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Current tier</th>
                  <th>
                    <span style={{ color: ct.accent }}>● </span>A — {labelA}
                  </th>
                  <th>
                    <span style={{ color: ct.cmp }}>● </span>B — {labelB}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COHORT_TIERS.map((t: CohortTier) => (
                  <tr key={t}>
                    <td>{TIER_LABEL[t]}</td>
                    <td className="num">
                      {statsA.tierMix[t]} ({tierPct(statsA.tierMix[t], statsA.total)}%)
                    </td>
                    <td className="num">
                      {statsB.tierMix[t]} ({tierPct(statsB.tierMix[t], statsB.total)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="stat__value">{counts.total}</span>
              <span className="stat__label">Mentees</span>
            </div>
            <div className="stat">
              <span className="stat__value">{counts.active}</span>
              <span className="stat__label">Active</span>
            </div>
            <div className="stat">
              <span className="stat__value">{counts.graduated}</span>
              <span className="stat__label">Graduated</span>
            </div>
            <div className="stat">
              <span className="stat__value">{humanizeDays(grad?.avgDays ?? null)}</span>
              <span className="stat__label">Avg time to graduate</span>
            </div>
          </div>
          <div className="chart-card__split chart-card__split--both">
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 48 }}>
                  <CartesianGrid stroke={ct.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} unit="d" />
                  <YAxis type="category" dataKey="leg" width={150} tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
                  <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} formatter={(v) => [v == null ? "—" : `${v}d`, "Avg"]} />
                  <Bar dataKey="avg" radius={[0, 3, 3, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                    <LabelList dataKey="avg" position="right" style={{ fill: ct.axis, fontSize: 11 }} formatter={(v) => (v == null ? "" : `${v}d`)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="table-scroll" style={{ width: "100%" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Stage leg</th>
                    <th>Mentees</th>
                    <th>Average</th>
                    <th>Median</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLegs.map((l) => (
                    <tr key={l.key}>
                      <td>
                        <span
                          style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: legColor(l.key), marginRight: 6, verticalAlign: "middle" }}
                        />
                        {l.label}
                      </td>
                      <td className="num">{l.n}</td>
                      <td className="num">{humanizeDays(l.avgDays)}</td>
                      <td className="num">{humanizeDays(l.medianDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
