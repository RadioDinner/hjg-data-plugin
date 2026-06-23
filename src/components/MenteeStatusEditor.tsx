import { useEffect, useMemo, useState } from "react";
import {
  clearMenteeOutcome,
  setMenteeOutcome,
  type MenteeJourney,
  type MenteeStatus,
  type ResolvedMenteeStatus,
} from "../db";

// A standalone mentee status editor (active / graduated / quit / fired + date +
// notes). Pick a mentee, set the real outcome — this writes a manual override to
// mentee_outcomes that ALWAYS wins over synced CoachAccountable data and is never
// touched by a re-sync. "Clear" reverts to the automatic (synced) status.
//
// Used on the Metrics "Meetings to Freedom!" card so graduations can be corrected
// right where they're measured; the same override powers the Journeys tab.

const STATUS_LABEL: Record<ResolvedMenteeStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  quit: "Quit",
  fired: "Fired",
  inactive: "Inactive",
};

const OVERRIDE_OPTIONS: { value: MenteeStatus; label: string }[] = [
  { value: "graduated", label: "Graduated" },
  { value: "active", label: "Active" },
  { value: "quit", label: "Quit" },
  { value: "fired", label: "Fired" },
];

export function MenteeStatusEditor({
  journeys,
  userId,
  onSaved,
  onError,
}: {
  journeys: MenteeJourney[];
  userId: string;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const sorted = useMemo(() => [...journeys].sort((a, b) => a.name.localeCompare(b.name)), [journeys]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [status, setStatus] = useState<MenteeStatus | "">("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const selected = useMemo(() => sorted.find((j) => j.clientId === clientId) ?? null, [sorted, clientId]);

  // Prefill the editor when a DIFFERENT mentee is picked (not on the post-save
  // data refresh, so the "Saved ✓" confirmation isn't wiped instantly).
  useEffect(() => {
    const j = sorted.find((x) => x.clientId === clientId) ?? null;
    setStatus(j?.override ?? "");
    setDate(j?.overrideDate ?? "");
    setNotes(j?.notes ?? "");
    setSavedMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const dirty =
    !!selected &&
    ((selected.override ?? "") !== status ||
      (selected.overrideDate ?? "") !== date ||
      (selected.notes ?? "") !== notes);
  const canSave = !!selected && status !== "" && dirty && !saving;

  async function save() {
    if (!selected || status === "") return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await setMenteeOutcome(userId, selected.clientId, { status, statusDate: date || null, notes: notes || null });
      setSavedMsg("Saved ✓ — overrides sync");
      onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function clear() {
    if (!selected) return;
    setClearing(true);
    setSavedMsg(null);
    try {
      await clearMenteeOutcome(selected.clientId);
      setSavedMsg("Reverted to synced");
      onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="card card--inset grad-editor">
      <h3>Edit graduation status</h3>
      <p className="view__hint">
        Pick a mentee and set their real outcome. A manual override here <strong>always wins over synced data</strong> and
        is never overwritten by a re-sync — the synced data still comes in, your override just takes precedence.{" "}
        <strong>Clear</strong> reverts to the automatic (synced) status.
      </p>
      <div className="journey__status-row">
        <label>
          Mentee
          <select
            value={clientId ?? ""}
            onChange={(e) => setClientId(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Select a mentee…</option>
            {sorted.map((j) => (
              <option key={j.clientId} value={j.clientId}>
                {j.name} — {STATUS_LABEL[j.resolvedStatus]}
                {j.source === "manual" ? " (override)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Outcome
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MenteeStatus | "")}
            disabled={!selected}
          >
            <option value="">{selected ? `Auto (${STATUS_LABEL[selected.resolvedStatus]})` : "Auto"}</option>
            {OVERRIDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!selected || status === "active" || status === ""}
          />
        </label>
        <label className="journey__notes">
          Notes
          <input
            type="text"
            value={notes}
            placeholder="e.g. graduated early, moved away"
            onChange={(e) => setNotes(e.target.value)}
            disabled={!selected}
          />
        </label>
        <div className="journey__status-actions">
          <button className="btn btn--primary btn--sm" onClick={save} disabled={!canSave}>
            {saving ? "Saving…" : selected?.overrideId ? "Update" : "Save"}
          </button>
          {selected?.overrideId && (
            <button className="btn btn--sm" onClick={clear} disabled={clearing}>
              {clearing ? "…" : "Clear"}
            </button>
          )}
          {savedMsg && <span className="muted" style={{ alignSelf: "center" }}>{savedMsg}</span>}
        </div>
      </div>
    </div>
  );
}
