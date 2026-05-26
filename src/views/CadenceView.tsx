import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { addCadence, listCadence, type CadenceEntry, type CadenceTier } from "../db";
import { today, useClients } from "./shared";

const TIERS: { value: CadenceTier; label: string }[] = [
  { value: "4x", label: "4× / month" },
  { value: "2x", label: "2× / month" },
  { value: "1x", label: "1× / month" },
  { value: "graduated", label: "Graduated" },
];

const TIER_LABEL: Record<string, string> = Object.fromEntries(TIERS.map((t) => [t.value, t.label]));

export function CadenceView() {
  const { user } = useAuth();
  const { clients, nameOf, error: clientsError } = useClients();
  const [rows, setRows] = useState<CadenceEntry[]>([]);
  const [clientId, setClientId] = useState<number | "">("");
  const [tier, setTier] = useState<CadenceTier>("4x");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await listCadence());
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (clientId === "" || !user) return;
    setBusy(true);
    setError(null);
    try {
      await addCadence(user.id, { client_id: Number(clientId), tier, effective_from: date, notes: notes || null });
      setClientId("");
      setTier("4x");
      setDate(today());
      setNotes("");
      await load();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <h2>Cadence changes</h2>
      <p className="view__hint">
        Log each meeting-cadence change (4× → 2× → 1× → graduated). This is an append-only history, so the
        latest entry per mentee is their current tier.
      </p>

      <form className="entry" onSubmit={submit}>
        <label className="field">
          <span>Mentee</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value === "" ? "" : Number(e.target.value))} required>
            <option value="">Select…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? `#${c.id}`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>New tier</span>
          <select value={tier} onChange={(e) => setTier(e.target.value as CadenceTier)}>
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Effective from</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field field--grow">
          <span>Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </label>
        <button className="btn btn--primary" disabled={busy || clientId === ""}>
          {busy ? "Saving…" : "Add"}
        </button>
      </form>

      {(error || clientsError) && <div className="notice notice--warn">{error || clientsError}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Mentee</th>
              <th>Tier</th>
              <th>Effective from</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{nameOf(r.client_id)}</td>
                <td>{TIER_LABEL[r.tier] ?? r.tier}</td>
                <td>{r.effective_from}</td>
                <td className="muted">{r.notes ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No cadence changes recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
