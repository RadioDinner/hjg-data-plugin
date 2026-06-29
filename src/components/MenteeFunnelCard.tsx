import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchMentees,
  fetchCompanyOptions,
  stageColorsFromRaw,
  toEffectiveMentee,
  computeFunnel,
  DEFAULT_STAGE_COLORS,
  type EffectiveMentee,
} from "../db";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";
import { useChartTokens } from "../theme";
import { pct } from "../format";

function ymdToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mentee funnel + exits, moved out of the Mentees page into Metrics (2026-06-27).
// Built off EFFECTIVE mentees (CA + Notion + hand), so it honors the mixed data
// sources. IMN mentees are kept on the roster but excluded from the funnel.
export function MenteeFunnelCard() {
  const ct = useChartTokens();
  const [mentees, setMentees] = useState<EffectiveMentee[]>([]);
  const [stageColors, setStageColors] = useState<string[]>(DEFAULT_STAGE_COLORS);
  const [error, setError] = useState<string | null>(null);
  const [ownerF, setOwnerF] = useState("all");
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

  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const m of mentees) if (!m.isTest && m.ownerCoachName) s.add(m.ownerCoachName);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [mentees]);

  // A reload can drop the selected coach; reset so the funnel doesn't show zeros.
  useEffect(() => {
    if (ownerF !== "all" && !owners.includes(ownerF)) setOwnerF("all");
  }, [owners, ownerF]);

  const scoped = useMemo(() => (ownerF === "all" ? mentees : mentees.filter((m) => m.ownerCoachName === ownerF)), [mentees, ownerF]);
  const funnel = useMemo(() => computeFunnel(scoped), [scoped]);
  // FUNNEL_STAGES[0] = pre_waiting (no palette slot — neutral); 1..6 map to the
  // 6-color stage palette (Discovery … Graduation).
  const chart = useMemo(
    () => funnel.stages.map((s, i) => ({ stage: s.label, entered: s.entered, color: i === 0 ? "#94a3b8" : stageColors[i - 1] ?? ct.accent })),
    [funnel, stageColors, ct.accent]
  );

  if (error) return <div className="error">{error}</div>;

  return (
    <div className="card card--inset" style={{ marginTop: 18 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Mentee funnel &amp; exits <HelpButton id="metrics.funnel" label="Mentee funnel & exits" />
        <SectionId id="metrics.funnel" />
      </h2>
      <p className="view__hint">
        How many mentees <strong>entered</strong> each stage, who's still <strong>active</strong> there, who <strong>exited</strong> there
        (declined / quit / fired / no&nbsp;mentoring), and the <strong>conversion</strong> to the next stage. Graduation can happen directly
        from 4x or 2x. Built off the effective mentee data (CA + Notion + your edits); test mentees excluded. All-time.{" "}
        {funnel.imnCount > 0 ? <strong>{funnel.imnCount} IMN excluded.</strong> : null}
      </p>

      <div className="journey-filters">
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
        <span className="journey-filters__count muted">
          {funnel.total} mentees{funnel.imnCount > 0 ? ` · ${funnel.imnCount} IMN excluded` : ""}
        </span>
      </div>

      <div className="chart-card__split chart-card__split--both">
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid stroke={ct.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" width={80} tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
              <Tooltip
                contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText }}
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
              />
              <Bar dataKey="entered" radius={[0, 3, 3, 0]}>
                {chart.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
                <LabelList dataKey="entered" position="right" style={{ fill: ct.axis, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="table-scroll" style={{ width: "100%" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Entered</th>
                <th>Active here</th>
                <th>Exited (declined / quit / fired / no&nbsp;mentoring)</th>
                <th>→ Next</th>
              </tr>
            </thead>
            <tbody>
              {funnel.stages.map((s) => (
                <tr key={s.stage}>
                  <td>{s.label}</td>
                  <td className="num">{s.entered}</td>
                  <td className="num">{s.activeHere}</td>
                  <td className="num">
                    {s.exitedHere}
                    {s.exitedHere > 0 ? ` (${s.exits.declined}/${s.exits.quit}/${s.exits.fired}/${s.exits.no_mentoring})` : ""}
                  </td>
                  <td className="num">{s.conversionToNext == null ? "—" : pct(s.conversionToNext)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
