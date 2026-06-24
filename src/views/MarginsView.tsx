import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../auth";
import { useChartTokens } from "../theme";
import { HelpButton } from "../components/HelpDrawer";
import { downloadCsv } from "../csv";
import {
  PROGRAMS,
  PROGRAM_MEETING_HOURS,
  mergeProgramMonths,
  fetchDeliveredHoursByMonth,
  fetchAllProgramHours,
  setProgramHours,
  type ProgramHoursRow,
  type ProgramMonthRow,
} from "../db";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${SHORT[m - 1]} ${y}`;
}
function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const fmtHours = (n: number | null) => (n == null ? "—" : `${Math.round(n * 10) / 10} h`);

// One editable staff-hours cell: local draft, saves on blur if changed.
function StaffHoursCell({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (hours: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  async function commit() {
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      setDraft(value == null ? "" : String(value)); // reject bad input
      return;
    }
    if (parsed === value) return; // unchanged
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="number"
      min={0}
      step="any"
      className="margins__hours-input"
      value={draft}
      placeholder="—"
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function MarginsView() {
  const { user } = useAuth();
  const ct = useChartTokens();
  const TOOLTIP = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText } as const;

  const [programKey, setProgramKey] = useState(PROGRAMS[0].key);
  const def = PROGRAMS.find((p) => p.key === programKey) ?? PROGRAMS[0];

  const [delivered, setDelivered] = useState<Map<string, { sessions: number; hours: number }>>(new Map());
  const [staffRows, setStaffRows] = useState<ProgramHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([fetchDeliveredHoursByMonth(def.tiers), fetchAllProgramHours()])
      .then(([d, s]) => {
        if (!live) return;
        setDelivered(d);
        setStaffRows(s);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey]);

  const staffMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of staffRows) if (r.program === programKey && r.staffHours != null) m.set(r.month, r.staffHours);
    return m;
  }, [staffRows, programKey]);

  const rows = useMemo(() => mergeProgramMonths(delivered, staffMap, [currentYm()]), [delivered, staffMap]);
  // Oldest -> newest for the time axis.
  const chartData = useMemo(
    () => [...rows].reverse().map((r) => ({ month: monthLabel(r.month), Staff: r.staffHours ?? 0, Delivered: r.deliveredHours })),
    [rows]
  );

  async function saveHours(month: string, hours: number | null) {
    try {
      await setProgramHours(user?.id ?? "", programKey, month, hours);
      // Reflect locally without a full reload.
      setStaffRows((prev) => {
        const next = prev.filter((r) => !(r.program === programKey && r.month === month));
        next.push({ program: programKey, month, staffHours: hours, notes: null });
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }

  function exportCsv() {
    downloadCsv(
      `margins-${programKey}`,
      ["Month", "Delivered sessions", "Delivered hours", "Staff hours", "Delivered ÷ staff"],
      rows.map((r) => [r.month, r.sessions, r.deliveredHours, r.staffHours ?? "", r.ratio == null ? "" : Math.round(r.ratio * 100) / 100])
    );
  }

  const totals = useMemo(() => {
    let sessions = 0;
    let deliveredHours = 0;
    let staffHours = 0;
    let staffMonths = 0;
    for (const r of rows) {
      sessions += r.sessions;
      deliveredHours += r.deliveredHours;
      if (r.staffHours != null) {
        staffHours += r.staffHours;
        staffMonths++;
      }
    }
    return { sessions, deliveredHours, staffHours, staffMonths };
  }, [rows]);

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Margins <HelpButton id="margins.tab" label="Margins" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {def.blurb} Delivered hours are an estimate: <strong>{PROGRAM_MEETING_HOURS} h per session</strong> (a
              distinct coach + start-time slot, so a group meeting counts once). Dollar figures come later.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="seg" role="tablist" aria-label="Program">
              {PROGRAMS.map((p) => (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={programKey === p.key}
                  className={`seg__btn ${programKey === p.key ? "seg__btn--active" : ""}`}
                  onClick={() => setProgramKey(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button className="btn btn--sm" onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </button>
          </div>
        </div>

        {error && <div className="notice notice--warn">{error}</div>}

        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat__value">{totals.sessions}</span>
                <span className="stat__label">Delivered sessions (all time)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{fmtHours(totals.deliveredHours)}</span>
                <span className="stat__label">Delivered hours</span>
              </div>
              <div className="stat">
                <span className="stat__value">{totals.staffMonths > 0 ? fmtHours(totals.staffHours) : "—"}</span>
                <span className="stat__label">Staff hours entered ({totals.staffMonths} mo)</span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {totals.staffHours > 0 ? `${Math.round((totals.deliveredHours / totals.staffHours) * 100) / 100}×` : "—"}
                </span>
                <span className="stat__label">Delivered ÷ staff (entered mo)</span>
              </div>
            </div>

            <div className="chart-card__split chart-card__split--both">
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
                    <YAxis tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} unit="h" />
                    <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Delivered" fill={ct.accent} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Staff" fill={ct.cmp} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="table-scroll" style={{ width: "100%" }}>
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Sessions</th>
                      <th>Delivered hrs</th>
                      <th>Staff hrs</th>
                      <th>Delivered ÷ staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: ProgramMonthRow) => (
                      <tr key={r.month}>
                        <td>{monthLabel(r.month)}</td>
                        <td className="num">{r.sessions}</td>
                        <td className="num">{fmtHours(r.deliveredHours)}</td>
                        <td className="num">
                          <StaffHoursCell value={r.staffHours} onSave={(h) => saveHours(r.month, h)} />
                        </td>
                        <td className="num">{r.ratio == null ? "—" : `${Math.round(r.ratio * 100) / 100}×`}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted">
                          No {def.label} meetings found yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="view__hint" style={{ marginTop: 10 }}>
              Enter staff hours in the table (saves on blur). Needs migration <code>9981_program_hours.sql</code> applied to
              persist. “Delivered ÷ staff” is delivered hours per staff hour for months where staff hours are entered.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
