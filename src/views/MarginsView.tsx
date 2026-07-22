import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../auth";
import { useChartTokens } from "../theme";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";
import { downloadCsv } from "../csv";
import { fmtDate } from "../format";
import {
  PROGRAMS,
  PROGRAM_MEETING_HOURS,
  mergeProgramMonths,
  programMonthTotals,
  fetchProgramSessionsByMonth,
  fetchAllProgramHours,
  setProgramHours,
  type ProgramHoursRow,
  type ProgramMonthRow,
  type ProgramSession,
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

// One editable staff-hours cell: local draft, saves on blur if changed. A save
// that fails REVERTS the cell (so a value that didn't persist never keeps
// looking entered — that was the "my numbers don't save" trap) and the parent
// shows the error; a successful save flashes ✓.
function StaffHoursCell({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (hours: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  async function commit(el?: HTMLInputElement) {
    // type=number inputs report non-numeric text as an EMPTY value with
    // validity.badInput — treat that as a rejected edit, not a "clear".
    if (el?.validity.badInput) {
      setDraft(value == null ? "" : String(value));
      return;
    }
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
      setFlash(true);
      window.setTimeout(() => setFlash(false), 1500);
    } catch {
      setDraft(value == null ? "" : String(value)); // didn't persist — show that
    } finally {
      setSaving(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        type="number"
        min={0}
        step="any"
        className="margins__hours-input"
        value={draft}
        placeholder="—"
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {saving && <span className="muted" style={{ fontSize: 11 }}>…</span>}
      {flash && !saving && <span style={{ fontSize: 11, color: "var(--ok-text, #16a34a)" }}>✓</span>}
    </span>
  );
}

export function MarginsView() {
  const { user } = useAuth();
  const ct = useChartTokens();
  const TOOLTIP = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText } as const;

  const [programKey, setProgramKey] = useState(PROGRAMS[0].key);
  const def = PROGRAMS.find((p) => p.key === programKey) ?? PROGRAMS[0];

  const [sessionsByMonth, setSessionsByMonth] = useState<Map<string, ProgramSession[]>>(new Map());
  const [staffRows, setStaffRows] = useState<ProgramHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Staff-hours storage problem (table missing / RLS) — shown prominently so a
  // broken save path never fails silently again.
  const [storageError, setStorageError] = useState<string | null>(null);
  const [drillMonth, setDrillMonth] = useState<string | null>(null); // month whose meetings the modal shows

  useEffect(() => {
    let live = true;
    setLoading(true);
    setDrillMonth(null);
    Promise.all([fetchProgramSessionsByMonth(def.tiers), fetchAllProgramHours()])
      .then(([s, hrs]) => {
        if (!live) return;
        setSessionsByMonth(s);
        setStaffRows(hrs.rows);
        setStorageError(hrs.error);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey]);

  const delivered = useMemo(() => programMonthTotals(sessionsByMonth), [sessionsByMonth]);
  const staffMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of staffRows) if (r.program === programKey && r.staffHours != null) m.set(r.month, r.staffHours);
    return m;
  }, [staffRows, programKey]);

  const rows = useMemo(() => mergeProgramMonths(delivered, staffMap, [currentYm()]), [delivered, staffMap]);
  // Oldest -> newest for the time axis. `ym` rides along so a bar click can drill in.
  const chartData = useMemo(
    () => [...rows].reverse().map((r) => ({ ym: r.month, month: monthLabel(r.month), Staff: r.staffHours ?? 0, Delivered: r.deliveredHours })),
    [rows]
  );

  async function saveHours(month: string, hours: number | null) {
    try {
      await setProgramHours(user?.id ?? "", programKey, month, hours);
      // Reflect locally without a full reload (chart + ratio update immediately).
      setStaffRows((prev) => {
        const next = prev.filter((r) => !(r.program === programKey && r.month === month));
        next.push({ program: programKey, month, staffHours: hours, notes: null });
        return next;
      });
      setError(null);
    } catch (e) {
      setError(`Staff hours did NOT save: ${String(e)}`);
      throw e; // let the cell revert so the number never LOOKS saved
    }
  }

  function exportCsv() {
    downloadCsv(
      `margins-${programKey}`,
      ["Month", "Delivered sessions", "Delivered hours", "Staff hours", "Delivered ÷ staff"],
      rows.map((r) => [r.month, r.sessions, r.deliveredHours, r.staffHours ?? "", r.ratio == null ? "" : Math.round(r.ratio * 100) / 100])
    );
  }

  // Clicking a month's column drills into that month's delivered meetings. recharts'
  // click state isn't cleanly typed; read the active row's `ym` defensively.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChartClick = (s: any) => {
    const ym = s?.activePayload?.[0]?.payload?.ym as string | undefined;
    if (ym) setDrillMonth(ym);
  };

  // The meetings behind the clicked month's delivered bar.
  const drillSessions = useMemo(() => (drillMonth ? sessionsByMonth.get(drillMonth) ?? [] : []), [drillMonth, sessionsByMonth]);
  const drillTotals = useMemo(() => {
    let hours = 0;
    for (const s of drillSessions) hours += s.hours;
    return { sessions: drillSessions.length, hours: Math.round(hours * 100) / 100 };
  }, [drillSessions]);

  function exportDrillCsv() {
    if (!drillMonth) return;
    downloadCsv(
      `margins-${programKey}-${drillMonth}`,
      ["Date", "Time", "Coach", "Meeting", "Attendees", "Hours", "Duration source"],
      drillSessions.map((s) => [s.date, s.time ?? "", s.coachName, s.name, s.attendees, s.hours, s.realDuration ? "actual" : "fallback"])
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
              {def.blurb} Delivered hours use each meeting's <strong>actual duration</strong> (end − start) when recorded,
              falling back to <strong>{PROGRAM_MEETING_HOURS} h/session</strong> otherwise. A session = a distinct coach +
              start-time slot, so a group meeting counts once. Dollar figures come later.
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
        {storageError && (
          <div className="notice notice--warn">
            <strong>Staff-hours entry is unavailable:</strong> {storageError}. Numbers typed into the Staff hrs column
            will not persist until this is fixed.
          </div>
        )}

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
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }} onClick={onChartClick} style={{ cursor: "pointer" }}>
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
                      <tr
                        key={r.month}
                        className={r.sessions > 0 ? "margins__row--drill" : undefined}
                        onClick={r.sessions > 0 ? () => setDrillMonth(r.month) : undefined}
                        title={r.sessions > 0 ? "Show the meetings behind this month" : undefined}
                      >
                        <td>{monthLabel(r.month)}</td>
                        <td className="num">{r.sessions}</td>
                        <td className="num">{fmtHours(r.deliveredHours)}</td>
                        <td className="num" onClick={(e) => e.stopPropagation()}>
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
              <strong>Click a bar (or a table row)</strong> to see the meetings behind that month. Enter staff hours in the
              table (saves on blur). Needs migration <code>9981_program_hours.sql</code> applied to persist, and a re-sync
              after <code>9980_ca_appointments_end.sql</code> for real meeting durations (until then delivered hours use the
              {" "}{PROGRAM_MEETING_HOURS} h/session fallback). “Delivered ÷ staff” is delivered hours per staff hour for
              months where staff hours are entered.
            </p>
          </>
        )}
      </section>

      {drillMonth && (
        <div className="modal" onClick={() => setDrillMonth(null)}>
          <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>
                {def.label} — meetings in {monthLabel(drillMonth)} <SectionId id="modal.marginsDrill" />
              </h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn--sm" onClick={exportDrillCsv} disabled={drillSessions.length === 0}>
                  Export CSV
                </button>
                <button className="btn btn--sm" onClick={() => setDrillMonth(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="modal__body">
              {drillSessions.length === 0 ? (
                <p className="muted">No delivered {def.label} meetings recorded for {monthLabel(drillMonth)}.</p>
              ) : (
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Coach</th>
                      <th>Meeting</th>
                      <th>Attendees</th>
                      <th>Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillSessions.map((s, i) => (
                      <tr key={i}>
                        <td className="num">{fmtDate(s.date)}</td>
                        <td className="num">{s.time ?? "—"}</td>
                        <td>{s.coachName}</td>
                        <td>
                          {s.name}
                          {s.attendees > 1 && <span className="pill" style={{ marginLeft: 6 }}>group ×{s.attendees}</span>}
                        </td>
                        <td className="num">{s.attendees}</td>
                        <td className="num">
                          {Math.round(s.hours * 100) / 100}
                          {!s.realDuration && (
                            <span className="muted" title="No end time recorded — using the per-session fallback">
                              {" "}*
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal__foot muted">
              {drillTotals.sessions} session{drillTotals.sessions === 1 ? "" : "s"} · {Math.round(drillTotals.hours * 100) / 100} delivered hours
              {drillSessions.some((s) => !s.realDuration) && <> · * = fallback {PROGRAM_MEETING_HOURS} h (no end time recorded)</>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
