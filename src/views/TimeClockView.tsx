import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  fetchTimeEntries,
  clockIn,
  clockOut,
  updateTimeEntryNote,
  deleteTimeEntry,
  submitTimeEntries,
  type TimeEntry,
} from "../db";
import { fmtDateTime } from "../format";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";

const round2 = (n: number) => Math.round(n * 100) / 100;

function entryHours(e: TimeEntry, now: number): number {
  const start = Date.parse(e.clockIn);
  const end = e.clockOut ? Date.parse(e.clockOut) : now;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return (end - start) / 3_600_000;
}

function fmtHours(h: number): string {
  return `${round2(h)} h`;
}

function startOfWeekMs(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

// Time clock (§208) — staff/mentors clock in and out, track their time, and
// submit it for payroll. Every entry lands in `time_entries` (migration 9966),
// so this data can fuel metrics later. Entries are matched to people by their
// sign-in email; submitted entries are locked.
export function TimeClockView() {
  const { user } = useAuth();
  const myEmail = (user?.email ?? "").toLowerCase();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ticks the running-clock display once a minute.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  async function load() {
    try {
      setEntries(await fetchTimeEntries());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = useMemo(() => entries.filter((e) => e.userEmail.toLowerCase() === myEmail), [entries, myEmail]);
  const open = useMemo(() => mine.find((e) => !e.clockOut) ?? null, [mine]);

  const totals = useMemo(() => {
    const weekStart = startOfWeekMs(new Date(now));
    const monthKey = new Date(now).toISOString().slice(0, 7);
    let week = 0;
    let month = 0;
    let unsubmitted = 0;
    for (const e of mine) {
      const h = entryHours(e, now);
      const start = Date.parse(e.clockIn);
      if (start >= weekStart) week += h;
      if (e.clockIn.slice(0, 7) === monthKey) month += h;
      if (!e.submittedAt && e.clockOut) unsubmitted += h;
    }
    return { week: round2(week), month: round2(month), unsubmitted: round2(unsubmitted) };
  }, [mine, now]);

  // All-staff roll-up (everyone's hours this month) — the "fuel our metrics" seed.
  const staffTotals = useMemo(() => {
    const monthKey = new Date(now).toISOString().slice(0, 7);
    const m = new Map<string, { month: number; open: boolean }>();
    for (const e of entries) {
      const rec = m.get(e.userEmail) ?? { month: 0, open: false };
      if (e.clockIn.slice(0, 7) === monthKey) rec.month += entryHours(e, now);
      if (!e.clockOut) rec.open = true;
      m.set(e.userEmail, rec);
    }
    return [...m.entries()]
      .map(([email, v]) => ({ email, month: round2(v.month), open: v.open }))
      .sort((a, b) => b.month - a.month);
  }, [entries, now]);

  async function doClockIn() {
    setBusy(true);
    setFlash(null);
    try {
      await clockIn(user?.id ?? "", user?.email ?? "");
      await load();
      setFlash("Clocked in — the clock is running.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doClockOut() {
    if (!open) return;
    setBusy(true);
    setFlash(null);
    try {
      await clockOut(open.id);
      await load();
      setFlash("Clocked out.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSubmit() {
    const n = mine.filter((e) => !e.submittedAt && e.clockOut).length;
    if (!n) return;
    if (!confirm(`Submit ${n} completed entr${n === 1 ? "y" : "ies"} (${fmtHours(totals.unsubmitted)}) for payroll? Submitted entries lock.`)) return;
    setBusy(true);
    try {
      const count = await submitTimeEntries(user?.email ?? "");
      await load();
      setFlash(`${count} entr${count === 1 ? "y" : "ies"} submitted for payroll.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(e: TimeEntry, note: string) {
    const v = note.trim() || null;
    if (v === e.note) return;
    try {
      await updateTimeEntryNote(e.id, v);
      setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, note: v } : x)));
    } catch (err) {
      setError(String(err));
    }
  }

  async function remove(e: TimeEntry) {
    if (!confirm("Delete this time entry?")) return;
    try {
      await deleteTimeEntry(e.id);
      setEntries((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      setError(String(err));
    }
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Time clock <SectionId id="timeclock.screen" />
              <HelpButton id="timeclock.screen" label="Time clock" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Clock in when you start, out when you stop, add a note about what you worked on, and{" "}
              <strong>submit your completed entries for payroll</strong>. Everything recorded here also feeds the
              org's metrics over time. Needs migration <code>9966_time_entries.sql</code>.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {open ? (
              <>
                <span className="pill pill--running" title={`Clocked in ${fmtDateTime(open.clockIn)}`}>
                  on the clock · {fmtHours(entryHours(open, now))}
                </span>
                <button className="btn btn--primary" onClick={doClockOut} disabled={busy}>
                  Clock out
                </button>
              </>
            ) : (
              <button className="btn btn--primary" onClick={doClockIn} disabled={busy || !myEmail}>
                Clock in
              </button>
            )}
          </div>
        </div>
        {error && <div className="notice notice--warn">{error}</div>}
        {flash && !error && <div className="notice notice--info">{flash}</div>}

        <div className="stat-row">
          <div className="stat">
            <span className="stat__value">{fmtHours(totals.week)}</span>
            <span className="stat__label">My hours this week</span>
          </div>
          <div className="stat">
            <span className="stat__value">{fmtHours(totals.month)}</span>
            <span className="stat__label">My hours this month</span>
          </div>
          <div className="stat">
            <span className="stat__value">{fmtHours(totals.unsubmitted)}</span>
            <span className="stat__label">Completed, not yet submitted</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 style={{ fontSize: 15 }}>
            My entries <SectionId id="timeclock.entries" />
          </h2>
          <button
            className="btn btn--sm btn--primary"
            onClick={doSubmit}
            disabled={busy || totals.unsubmitted === 0}
            title="Marks every completed, unsubmitted entry as submitted for payroll (locks them)"
          >
            Submit for payroll
          </button>
        </div>
        <div className="table-scroll">
          <table className="table table--center">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Clock in</th>
                <th style={{ textAlign: "left" }}>Clock out</th>
                <th>Hours</th>
                <th style={{ textAlign: "left" }}>Note</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine.slice(0, 50).map((e) => (
                <tr key={e.id}>
                  <td style={{ textAlign: "left" }}>{fmtDateTime(e.clockIn)}</td>
                  <td style={{ textAlign: "left" }}>{e.clockOut ? fmtDateTime(e.clockOut) : <em>on the clock</em>}</td>
                  <td className="num">{fmtHours(entryHours(e, now))}</td>
                  <td style={{ textAlign: "left" }}>
                    <input
                      className="input--inline input--note"
                      type="text"
                      defaultValue={e.note ?? ""}
                      placeholder="what were you working on…"
                      disabled={!!e.submittedAt}
                      onBlur={(ev) => saveNote(e, ev.target.value)}
                      aria-label="Entry note"
                    />
                  </td>
                  <td>
                    {e.submittedAt ? (
                      <span className="pill pill--success" title={`Submitted ${fmtDateTime(e.submittedAt)}`}>submitted</span>
                    ) : e.clockOut ? (
                      <span className="pill">open</span>
                    ) : (
                      <span className="pill pill--running">running</span>
                    )}
                  </td>
                  <td className="num">
                    {!e.submittedAt && (
                      <button className="btn btn--sm btn--danger" onClick={() => remove(e)} disabled={busy}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {mine.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">No entries yet — hit Clock in to start your first one.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15 }}>All staff — hours this month</h2>
        <div className="table-scroll">
          <table className="table table--center">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Person</th>
                <th>Hours this month</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {staffTotals.map((s) => (
                <tr key={s.email}>
                  <td style={{ textAlign: "left" }}>{s.email}</td>
                  <td className="num">{fmtHours(s.month)}</td>
                  <td>{s.open ? <span className="pill pill--running">on the clock</span> : ""}</td>
                </tr>
              ))}
              {staffTotals.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">Nobody has clocked time yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
