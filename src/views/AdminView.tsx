import { useEffect, useMemo, useState } from "react";
import { triggerSync } from "../api";
import { useAuth } from "../auth";
import {
  MANUAL_METRICS,
  fetchCoachesWithSettings,
  fetchManualMetrics,
  fetchManualMetricsForMonth,
  fetchSettings,
  listSyncRuns,
  updateSetting,
  upsertCoachSettings,
  upsertManualMetric,
  type CoachWithSettings,
  type ManualMetricRow,
  type SyncRun,
} from "../db";

function fmtTime(s: string | null): string {
  return s ? new Date(s).toLocaleString() : "—";
}

function currentMonthYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function AdminView() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [planLimit, setPlanLimit] = useState("");
  const [capPct, setCapPct] = useState("");
  const [interval, setIntervalHours] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const [mmMonth, setMmMonth] = useState(currentMonthYm());
  const [mmValues, setMmValues] = useState<Record<string, string>>({});
  const [mmSaving, setMmSaving] = useState(false);
  const [mmMsg, setMmMsg] = useState<string | null>(null);
  const [mmRecent, setMmRecent] = useState<ManualMetricRow[]>([]);

  // --- Mentor capacity editor state ---
  // `coaches` is the canonical roster joined with current saved settings.
  // `mcEdits` mirrors what's in the inputs; rows are saved by Save changes.
  const [coaches, setCoaches] = useState<CoachWithSettings[]>([]);
  const [mcEdits, setMcEdits] = useState<Record<number, { isMentor: boolean; capacity: string; notes: string; payStart: string }>>({});
  const [mcDirty, setMcDirty] = useState<Set<number>>(new Set());
  const [mcSaving, setMcSaving] = useState(false);
  const [mcMsg, setMcMsg] = useState<string | null>(null);
  const [mcShowOnly, setMcShowOnly] = useState<"all" | "mentors">("all");

  async function load() {
    try {
      const [r, s] = await Promise.all([listSyncRuns(), fetchSettings()]);
      setRuns(r);
      setPlanLimit(s.ca_plan_daily_limit == null ? "" : String(s.ca_plan_daily_limit));
      setCapPct(s.daily_cap_pct == null ? "" : String(s.daily_cap_pct));
      setIntervalHours(s.sync_interval_hours == null ? "" : String(s.sync_interval_hours));
      await Promise.all([loadRecentManual(), loadCoaches()]);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadCoaches() {
    const all = await fetchCoachesWithSettings();
    setCoaches(all);
    const edits: Record<number, { isMentor: boolean; capacity: string; notes: string; payStart: string }> = {};
    for (const c of all) {
      edits[c.coachId] = {
        isMentor: c.isMentor,
        capacity: c.capacity == null ? "" : String(c.capacity),
        notes: c.notes ?? "",
        payStart: c.payStartMonth ?? "",
      };
    }
    setMcEdits(edits);
    setMcDirty(new Set());
  }

  function markDirty(coachId: number) {
    setMcDirty((prev) => {
      const next = new Set(prev);
      next.add(coachId);
      return next;
    });
  }

  async function saveCoachSettings() {
    if (mcDirty.size === 0) {
      setMcMsg("Nothing changed.");
      return;
    }
    setMcSaving(true);
    setMcMsg(null);
    setError(null);
    try {
      const dirtyIds = [...mcDirty];
      await Promise.all(
        dirtyIds.map((id) => {
          const e = mcEdits[id];
          const capRaw = e.capacity.trim();
          const cap = capRaw === "" ? null : Math.max(0, Math.floor(Number(capRaw)));
          return upsertCoachSettings(id, {
            isMentor: e.isMentor,
            capacity: Number.isFinite(cap as number) || cap === null ? cap : null,
            notes: e.notes.trim() === "" ? null : e.notes.trim(),
            payStartMonth: e.payStart.trim() === "" ? null : e.payStart.trim(),
          });
        })
      );
      setMcMsg(`Saved ${dirtyIds.length} coach${dirtyIds.length === 1 ? "" : "es"}.`);
      await loadCoaches();
    } catch (e) {
      setError(String(e));
    }
    setMcSaving(false);
  }
  useEffect(() => {
    load();
  }, []);

  // Prefill the editor whenever the selected month changes.
  useEffect(() => {
    let cancelled = false;
    fetchManualMetricsForMonth(mmMonth)
      .then((vals) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const def of MANUAL_METRICS) {
          const v = vals.get(def.key);
          next[def.key] = v == null ? "" : String(v);
        }
        setMmValues(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [mmMonth]);

  async function loadRecentManual() {
    const now = new Date();
    const from = `${now.getFullYear() - 2}-01-01`;
    const to = `${now.getFullYear() + 1}-12-31`;
    setMmRecent(await fetchManualMetrics(from, to));
  }

  async function saveManual() {
    const entries = MANUAL_METRICS.map((def) => ({ def, raw: (mmValues[def.key] ?? "").trim() })).filter(
      (e) => e.raw !== ""
    );
    if (entries.length === 0) {
      setMmMsg("Enter at least one count to save.");
      return;
    }
    setMmSaving(true);
    setMmMsg(null);
    setError(null);
    try {
      await Promise.all(
        entries.map(({ def, raw }) => {
          const n = Number(raw);
          const value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
          return upsertManualMetric(user?.id ?? "", def.key, mmMonth, value);
        })
      );
      setMmMsg(`Saved ${fmtMonth(mmMonth)}.`);
      await loadRecentManual();
    } catch (e) {
      setError(String(e));
    }
    setMmSaving(false);
  }

  async function doSync() {
    setSyncing(true);
    setMsg(null);
    setError(null);
    try {
      const r = await triggerSync();
      setMsg(
        r.status === "success"
          ? `Synced ${r.recordsSynced} records (${r.callsMade} CoachAccountable calls) for ${r.years.join(", ")}.`
          : `Sync finished with an error: ${r.error ?? "unknown"}`
      );
      await load();
    } catch (e) {
      setError(String(e));
    }
    setSyncing(false);
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsMsg(null);
    setError(null);
    try {
      const limit = planLimit.trim() === "" ? null : Number(planLimit);
      const pct = capPct.trim() === "" ? null : Number(capPct);
      const hours = interval.trim() === "" ? null : Number(interval);
      await Promise.all([
        updateSetting("ca_plan_daily_limit", limit),
        updateSetting("daily_cap_pct", pct),
        updateSetting("sync_interval_hours", hours),
      ]);
      setSettingsMsg("Settings saved.");
    } catch (e) {
      setError(String(e));
    }
    setSavingSettings(false);
  }

  const cap =
    planLimit && capPct && Number(planLimit) > 0 && Number(capPct) > 0
      ? Math.max(1, Math.floor((Number(planLimit) * Number(capPct)) / 100))
      : null;

  // Recent manual entries pivoted to one row per month (newest first).
  const recentByMonth = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of mmRecent) {
      const k = r.periodMonth.slice(0, 7);
      let inner = m.get(k);
      if (!inner) {
        inner = new Map();
        m.set(k, inner);
      }
      inner.set(r.metric, r.value);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [mmRecent]);

  return (
    <section>
      <div className="card">
        <h2>Sync</h2>
        <p className="view__hint">
          Pull the latest data from CoachAccountable into the dashboard. Read-only toward CoachAccountable; capped
          at the daily call budget below.
        </p>
        <button className="btn btn--primary" onClick={doSync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        {msg && <div className="notice notice--info">{msg}</div>}
        {error && <div className="notice notice--warn">{error}</div>}

        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Trigger</th>
                <th>Status</th>
                <th className="num">CA calls</th>
                <th className="num">Records</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtTime(r.started_at)}</td>
                  <td className="muted">{r.trigger}</td>
                  <td>
                    <span className={`pill pill--${r.status}`}>{r.status}</span>
                    {r.error && <div className="muted">{r.error}</div>}
                  </td>
                  <td className="num">{r.calls_made}</td>
                  <td className="num">{r.records_synced}</td>
                  <td className="muted">{fmtTime(r.finished_at)}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No syncs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Manual metrics</h2>
        <p className="view__hint">
          Board numbers that don&apos;t come from CoachAccountable. Pick a month and enter the count for each; the
          Metrics tab sums them over its date range. Saving overwrites that month&apos;s value. Leave a field blank to
          leave it unchanged.
        </p>
        <div className="entry">
          <label className="field">
            <span>Month</span>
            <input type="month" value={mmMonth} onChange={(e) => setMmMonth(e.target.value)} />
          </label>
          {MANUAL_METRICS.map((def) => (
            <label className="field" key={def.key}>
              <span>{def.label}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={mmValues[def.key] ?? ""}
                placeholder="—"
                onChange={(e) => setMmValues((prev) => ({ ...prev, [def.key]: e.target.value }))}
              />
            </label>
          ))}
          <button className="btn btn--primary" onClick={saveManual} disabled={mmSaving}>
            {mmSaving ? "Saving…" : "Save counts"}
          </button>
        </div>
        {mmMsg && <div className="notice notice--info">{mmMsg}</div>}

        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                {MANUAL_METRICS.map((def) => (
                  <th className="num" key={def.key}>
                    {def.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentByMonth.map(([ym, vals]) => (
                <tr key={ym}>
                  <td>{fmtMonth(ym)}</td>
                  {MANUAL_METRICS.map((def) => {
                    const v = vals.get(def.key);
                    return (
                      <td className="num" key={def.key}>
                        {v == null ? "—" : v.toLocaleString("en-US")}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {recentByMonth.length === 0 && (
                <tr>
                  <td colSpan={MANUAL_METRICS.length + 1} className="muted">
                    No manual metrics entered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card__head">
          <h2>Mentor capacity</h2>
          <div className="seg">
            <button
              className={`seg__btn ${mcShowOnly === "all" ? "seg__btn--active" : ""}`}
              onClick={() => setMcShowOnly("all")}
            >
              All coaches ({coaches.length})
            </button>
            <button
              className={`seg__btn ${mcShowOnly === "mentors" ? "seg__btn--active" : ""}`}
              onClick={() => setMcShowOnly("mentors")}
            >
              Mentors only ({coaches.filter((c) => mcEdits[c.coachId]?.isMentor).length})
            </button>
          </div>
        </div>
        <p className="view__hint">
          Mark which CoachAccountable coaches actually count as mentors, and set how many concurrent mentees each can
          take. <strong>Pay start</strong> anchors the staff-payment ramp (35→50→60%) to a mentor&apos;s true first
          month of work — leave it blank to infer from their earliest engagement. The Metrics tab&apos;s Mentors metric
          is filtered to flagged mentors once any are set, and the
          <strong> Mentor capacity utilization </strong>card reads these capacities. Saves write to the HJG-owned
          <code> coach_settings</code> table, untouched by CA sync.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Coach</th>
                <th>Mentor?</th>
                <th className="num">Capacity</th>
                <th>Pay start</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {coaches
                .filter((c) => mcShowOnly === "all" || mcEdits[c.coachId]?.isMentor)
                .map((c) => {
                  const e = mcEdits[c.coachId] ?? { isMentor: false, capacity: "", notes: "", payStart: "" };
                  return (
                    <tr key={c.coachId}>
                      <td>
                        {c.name}
                        {mcDirty.has(c.coachId) && <span className="muted"> · unsaved</span>}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={e.isMentor}
                          onChange={(ev) => {
                            setMcEdits((prev) => ({
                              ...prev,
                              [c.coachId]: { ...e, isMentor: ev.target.checked },
                            }));
                            markDirty(c.coachId);
                          }}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={e.capacity}
                          placeholder="—"
                          style={{ width: 80, textAlign: "right" }}
                          onChange={(ev) => {
                            setMcEdits((prev) => ({
                              ...prev,
                              [c.coachId]: { ...e, capacity: ev.target.value },
                            }));
                            markDirty(c.coachId);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="month"
                          value={e.payStart}
                          title="Mentor's first month of work — anchors the 35/50/60 pay ramp. Blank = inferred from earliest engagement."
                          style={{ width: 130 }}
                          onChange={(ev) => {
                            setMcEdits((prev) => ({
                              ...prev,
                              [c.coachId]: { ...e, payStart: ev.target.value },
                            }));
                            markDirty(c.coachId);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={e.notes}
                          placeholder=""
                          style={{ width: "100%" }}
                          onChange={(ev) => {
                            setMcEdits((prev) => ({
                              ...prev,
                              [c.coachId]: { ...e, notes: ev.target.value },
                            }));
                            markDirty(c.coachId);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              {coaches.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No coaches synced yet. Run a sync first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn--primary" onClick={saveCoachSettings} disabled={mcSaving || mcDirty.size === 0}>
            {mcSaving ? "Saving…" : `Save changes${mcDirty.size > 0 ? ` (${mcDirty.size})` : ""}`}
          </button>
          {mcMsg && <span className="muted">{mcMsg}</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Settings</h2>
        <p className="view__hint">
          The daily CoachAccountable call cap is{" "}
          <strong>{cap === null ? "—" : `${cap} calls/day`}</strong> (plan limit × cap %). Leave the sync interval
          blank to keep syncing manual; set a number of hours to enable the scheduled sync.
        </p>
        <div className="entry">
          <label className="field">
            <span>CA plan daily limit</span>
            <input type="number" min={1} value={planLimit} onChange={(e) => setPlanLimit(e.target.value)} />
          </label>
          <label className="field">
            <span>Cap %</span>
            <input type="number" min={1} max={100} value={capPct} onChange={(e) => setCapPct(e.target.value)} />
          </label>
          <label className="field">
            <span>Sync interval (hours)</span>
            <input
              type="number"
              min={1}
              value={interval}
              placeholder="Manual"
              onChange={(e) => setIntervalHours(e.target.value)}
            />
          </label>
          <button className="btn btn--primary" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? "Saving…" : "Save settings"}
          </button>
        </div>
        {settingsMsg && <div className="notice notice--info">{settingsMsg}</div>}
      </div>
    </section>
  );
}
