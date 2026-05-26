import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { addGraduation, deleteGraduation, listGraduations, type Graduation } from "../db";
import { today, useClients } from "./shared";

export function GraduationsView() {
  const { user } = useAuth();
  const { clients, nameOf, error: clientsError } = useClients();
  const [rows, setRows] = useState<Graduation[]>([]);
  const [clientId, setClientId] = useState<number | "">("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await listGraduations());
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
      await addGraduation(user.id, { client_id: Number(clientId), graduated_on: date, notes: notes || null });
      setClientId("");
      setNotes("");
      setDate(today());
      await load();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this graduation record?")) return;
    try {
      await deleteGraduation(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="card">
      <h2>Graduations</h2>
      <p className="view__hint">
        CoachAccountable has no “graduated” field, so record graduations here. One per mentee.
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
          <span>Graduated on</span>
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
      {clients.length === 0 && !clientsError && (
        <div className="notice notice--info">No mentees yet — run a sync on the Admin tab first.</div>
      )}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Mentee</th>
              <th>Graduated</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{nameOf(r.client_id)}</td>
                <td>{r.graduated_on}</td>
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
                <td colSpan={4} className="muted">
                  No graduations recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
