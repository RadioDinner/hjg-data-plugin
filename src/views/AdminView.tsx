import { useEffect, useState } from "react";
import { triggerSync } from "../api";
import { fetchSettings, listSyncRuns, updateSetting, type SyncRun } from "../db";

function fmtTime(s: string | null): string {
  return s ? new Date(s).toLocaleString() : "—";
}

export function AdminView() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [planLimit, setPlanLimit] = useState("");
  const [capPct, setCapPct] = useState("");
  const [interval, setIntervalHours] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  async function load() {
    try {
      const [r, s] = await Promise.all([listSyncRuns(), fetchSettings()]);
      setRuns(r);
      setPlanLimit(s.ca_plan_daily_limit == null ? "" : String(s.ca_plan_daily_limit));
      setCapPct(s.daily_cap_pct == null ? "" : String(s.daily_cap_pct));
      setIntervalHours(s.sync_interval_hours == null ? "" : String(s.sync_interval_hours));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

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
