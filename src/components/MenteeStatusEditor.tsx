import { useEffect, useMemo, useState } from "react";
import {
  clearMenteeOutcome,
  setMenteeOutcome,
  type MenteeJourney,
  type MenteeStatus,
  type ResolvedMenteeStatus,
  type StageDates6,
} from "../db";

// The six editable pipeline milestone dates, in rail order.
const STAGE_FIELDS: { key: keyof StageDates6; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "jumpstart", label: "JumpStart" },
  { key: "4x", label: "4x mentoring" },
  { key: "2x", label: "2x mentoring" },
  { key: "1x", label: "1x mentoring" },
  { key: "graduated", label: "Graduation" },
];
type DateForm = Record<keyof StageDates6, string>;
const emptyDates = (): DateForm => ({ discovery: "", jumpstart: "", "4x": "", "2x": "", "1x": "", graduated: "" });
const overridesToForm = (o: StageDates6): DateForm => ({
  discovery: o.discovery ?? "",
  jumpstart: o.jumpstart ?? "",
  "4x": o["4x"] ?? "",
  "2x": o["2x"] ?? "",
  "1x": o["1x"] ?? "",
  graduated: o.graduated ?? "",
});

// The Journeys mentee editor: outcome status (active / graduated / quit / fired +
// ended-on date + notes) AND the six pipeline stage-date overrides (Discovery,
// JumpStart, 4x, 2x, 1x, Graduation). It writes one mentee_outcomes row that
// ALWAYS wins over synced CoachAccountable data and is never touched by a re-sync;
// "Clear" reverts everything to the automatic (synced) values. The selected mentee
// is driven by the Journeys list (shared selection) — picking in the list or this
// dropdown both update it.

const STATUS_LABEL: Record<ResolvedMenteeStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  quit: "Quit",
  fired: "Fired",
  no_mentoring: "No mentoring",
  inactive: "Inactive",
};

const OVERRIDE_OPTIONS: { value: MenteeStatus; label: string }[] = [
  { value: "graduated", label: "Graduated" },
  { value: "active", label: "Active" },
  { value: "quit", label: "Quit" },
  { value: "fired", label: "Fired" },
  { value: "no_mentoring", label: "No mentoring" },
];

export function MenteeStatusEditor({
  journeys,
  selectedClientId,
  onSelect,
  userId,
  onSaved,
  onError,
}: {
  journeys: MenteeJourney[];
  selectedClientId: number | null;
  onSelect: (clientId: number | null) => void;
  userId: string;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const sorted = useMemo(() => [...journeys].sort((a, b) => a.name.localeCompare(b.name)), [journeys]);
  const clientId = selectedClientId;
  const [status, setStatus] = useState<MenteeStatus | "">("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [dates, setDates] = useState<DateForm>(emptyDates());
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const selected = useMemo(() => sorted.find((j) => j.clientId === clientId) ?? null, [sorted, clientId]);

  // Prefill the editor when a DIFFERENT mentee is picked (from the list or this
  // dropdown — both drive the shared selection). Not on the post-save data
  // refresh, so the "Saved ✓" confirmation isn't wiped instantly.
  useEffect(() => {
    const j = sorted.find((x) => x.clientId === clientId) ?? null;
    setStatus(j?.override ?? "");
    setDate(j?.overrideDate ?? "");
    setNotes(j?.notes ?? "");
    setDates(j ? overridesToForm(j.stageOverrides) : emptyDates());
    setSavedMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const datesDirty = !!selected && STAGE_FIELDS.some((f) => (selected.stageOverrides[f.key] ?? "") !== (dates[f.key] ?? ""));
  const dirty =
    !!selected &&
    ((selected.override ?? "") !== status ||
      (selected.overrideDate ?? "") !== date ||
      (selected.notes ?? "") !== notes ||
      datesDirty);
  const canSave = !!selected && dirty && !saving;

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      await setMenteeOutcome(userId, selected.clientId, {
        status: status === "" ? null : status,
        statusDate: date || null,
        notes: notes || null,
        stageDates: {
          discovery: dates.discovery || null,
          jumpstart: dates.jumpstart || null,
          "4x": dates["4x"] || null,
          "2x": dates["2x"] || null,
          "1x": dates["1x"] || null,
          graduated: dates.graduated || null,
        },
      });
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
        Pick a mentee (or select one from the list below) and correct their outcome and/or pipeline dates. Overrides here{" "}
        <strong>always win over synced data</strong> and are never overwritten by a re-sync — the synced data still comes in,
        your override just takes precedence. <strong>Clear</strong> reverts everything to the automatic (synced) values.
      </p>
      <div className="journey__status-row">
        <label>
          Mentee
          <select
            value={clientId ?? ""}
            onChange={(e) => onSelect(e.target.value === "" ? null : Number(e.target.value))}
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
          Ended on
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
      </div>

      <div className="grad-editor__dates">
        <div className="grad-editor__dates-head muted">
          Pipeline dates — correct any milestone on this mentee’s timeline. Leave a field blank to keep the synced
          CoachAccountable date (shown beneath each).
        </div>
        <div className="grad-editor__dates-grid">
          {STAGE_FIELDS.map((f) => (
            <label key={f.key} className="grad-editor__date-field">
              <span>{f.label}</span>
              <input
                type="date"
                value={dates[f.key]}
                disabled={!selected}
                onChange={(e) => setDates((d) => ({ ...d, [f.key]: e.target.value }))}
              />
              <span className="grad-editor__synced muted">synced: {selected?.stageSynced[f.key] ?? "—"}</span>
            </label>
          ))}
        </div>
      </div>

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
  );
}
