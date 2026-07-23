import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { HelpButton } from "../components/HelpDrawer";
import { CollapsibleCard } from "../components/Collapsible";
import { fmtDate } from "../format";
import {
  clearDiscoveryOutcome,
  fetchDiscoveryCalls,
  setDiscoveryOutcome,
  type DiscoveryCall,
  type DiscoveryOutcomeValue,
} from "../db";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const OUTCOMES: { value: DiscoveryOutcomeValue; label: string }[] = [
  { value: "converted", label: "Converted" },
  { value: "not_converted", label: "Not converted" },
  { value: "pending", label: "Pending" },
  { value: "no_show", label: "No show" },
];

const OUTCOME_LABEL: Record<DiscoveryOutcomeValue, string> = {
  converted: "Converted",
  not_converted: "Not converted",
  pending: "Pending",
  no_show: "No show",
};

function DiscoveryRow({
  call,
  userId,
  onSaved,
  onError,
}: {
  call: DiscoveryCall;
  userId: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [outcome, setOutcome] = useState<DiscoveryOutcomeValue | "">(call.outcome ?? "");
  const [followUp, setFollowUp] = useState(call.followUpOn ?? "");
  const [notes, setNotes] = useState(call.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const dirty =
    (call.outcome ?? "") !== outcome ||
    (call.followUpOn ?? "") !== followUp ||
    (call.notes ?? "") !== notes;
  const canSave = outcome !== "" && call.clientId != null && dirty && !saving;

  async function save() {
    if (outcome === "" || call.clientId == null) return;
    setSaving(true);
    try {
      await setDiscoveryOutcome(
        userId,
        { appointmentId: call.appointmentId, clientId: call.clientId, existingId: call.outcomeId },
        { outcome, followUpOn: followUp || null, notes: notes || null }
      );
      onSaved();
    } catch (e) {
      onError(String(e));
      setSaving(false);
    }
  }

  async function clearOverride() {
    if (!call.outcomeId) return;
    setClearing(true);
    try {
      await clearDiscoveryOutcome(call.outcomeId);
      onSaved();
    } catch (e) {
      onError(String(e));
      setClearing(false);
    }
  }

  return (
    <tr>
      <td>{call.date ? fmtDate(call.date) : "—"}</td>
      <td>{call.prospect}</td>
      <td className="muted">{call.type}</td>
      <td>
        <span className={`pill pill--${call.resolvedOutcome}`}>{OUTCOME_LABEL[call.resolvedOutcome]}</span>
        <div className="pill__sub">
          {call.source === "manual" ? "Manual override" : "Auto"} · {call.resolvedReason}
        </div>
      </td>
      <td>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as DiscoveryOutcomeValue | "")}>
          <option value="">Auto ({OUTCOME_LABEL[call.autoOutcome]})</option>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
      </td>
      <td>
        <input
          type="text"
          value={notes}
          placeholder="Notes"
          onChange={(e) => setNotes(e.target.value)}
        />
      </td>
      <td className="num">
        <button className="btn btn--primary btn--sm" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : call.outcomeId ? "Update" : "Save"}
        </button>
        {call.outcomeId && (
          <button className="btn btn--sm" onClick={clearOverride} disabled={clearing} style={{ marginLeft: 6 }}>
            {clearing ? "…" : "Clear"}
          </button>
        )}
      </td>
    </tr>
  );
}

export function DiscoveryView() {
  const { user } = useAuth();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [calls, setCalls] = useState<DiscoveryCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setCalls(await fetchDiscoveryCalls(year));
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  return (
    <CollapsibleCard
      id="discovery.screen"
      title="Discovery calls"
      sectionId="discovery.screen"
      help={<HelpButton id="discovery.tab" label="Discovery calls" />}
    >
      <p className="view__hint" style={{ marginTop: -2 }}>
        Every discovery call synced from CoachAccountable. Status is computed automatically — a call converts when the
        prospect buys JumpStart Your Freedom (Waiting List) on or after the call, stays pending for 30 days otherwise,
        then becomes not converted. Set an outcome here to override (e.g. a no-show), or Clear to revert to automatic.
      </p>

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
        <span className="topbar__user">{calls.length} calls</span>
      </div>

      {error && <div className="notice notice--warn">{error}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Prospect</th>
                <th>Type</th>
                <th>Status</th>
                <th>Override</th>
                <th>Follow up</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <DiscoveryRow
                  key={c.appointmentId}
                  call={c}
                  userId={user?.id ?? ""}
                  onSaved={load}
                  onError={setError}
                />
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No discovery calls for {year}. Run a sync on the Admin tab if you expect some.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleCard>
  );
}
