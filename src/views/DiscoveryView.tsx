import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import {
  addDiscoveryOutcome,
  deleteDiscoveryOutcome,
  listDiscoveryOutcomes,
  type DiscoveryOutcome,
  type DiscoveryOutcomeValue,
} from "../db";
import { useClients } from "./shared";

const OUTCOMES: { value: DiscoveryOutcomeValue; label: string }[] = [
  { value: "converted", label: "Converted" },
  { value: "not_converted", label: "Not converted" },
  { value: "pending", label: "Pending" },
  { value: "no_show", label: "No show" },
];

const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label]));

export function DiscoveryView() {
  const { user } = useAuth();
  const { clients, nameOf, error: clientsError } = useClients();
  const [rows, setRows] = useState<DiscoveryOutcome[]>([]);
  const [clientId, setClientId] = useState<number | "">("");
  const [outcome, setOutcome] = useState<DiscoveryOutcomeValue>("pending");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await listDiscoveryOutcomes());
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
      await addDiscoveryOutcome(user.id, {
        client_id: Number(clientId),
        outcome,
        follow_up_on: followUp || null,
        notes: notes || null,
      });
      setClientId("");
      setOutcome("pending");
      setFollowUp("");
      setNotes("");
      await load();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this discovery outcome?")) return;
    try {
      await deleteDiscoveryOutcome(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="card">
      <h2>Discovery outcomes</h2>
      <p className="view__hint">Record what happened after a discovery call — whether the prospect converted.</p>

      <form className="entry" onSubmit={submit}>
        <label className="field">
          <span>Prospect</span>
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
          <span>Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as DiscoveryOutcomeValue)}>
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Follow up on</span>
          <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
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
              <th>Prospect</th>
              <th>Outcome</th>
              <th>Follow up</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{nameOf(r.client_id)}</td>
                <td>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
                <td className="muted">{r.follow_up_on ?? "—"}</td>
                <td className="muted">{r.notes ?? "—"}</td>
                <td className="num">
                  <button className="btn btn--danger btn--sm" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No discovery outcomes recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
