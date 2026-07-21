import { useEffect, useMemo, useState } from "react";
import { fetchPaystubs, fetchPaystubHtml, deletePaystub, type PaystubListItem } from "../db";
import { fmtDateTime } from "../format";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);

// Pay staff → HISTORY (207): the archive of every printed pay stub — mentor
// engine stubs and hourly timesheet stubs — stored as the exact HTML document
// that was generated. Open one to review (or re-print) precisely what was sent,
// even if the underlying data has changed since.
export function PayHistoryView({ onBack }: { onBack?: () => void }) {
  const [stubs, setStubs] = useState<PaystubListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function reload() {
    setStubs(await fetchPaystubs());
  }

  useEffect(() => {
    let live = true;
    reload()
      .then(() => live && setError(null))
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return stubs;
    return stubs.filter(
      (s) => s.staffName.toLowerCase().includes(needle) || s.periodMonth.includes(needle) || s.kind.includes(needle)
    );
  }, [stubs, q]);

  async function openStub(s: PaystubListItem) {
    setBusyId(s.id);
    try {
      const html = await fetchPaystubHtml(s.id);
      const w = window.open("", "_blank");
      if (!w) {
        setFlash("Popup blocked — allow popups for this site to view the stub.");
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch (e) {
      setFlash(`Open failed: ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: PaystubListItem) {
    if (!confirm(`Delete the archived ${s.periodMonth} stub for ${s.staffName}? This can't be undone.`)) return;
    setBusyId(s.id);
    try {
      await deletePaystub(s.id);
      await reload();
      setFlash("Archived stub deleted.");
    } catch (e) {
      setFlash(`Delete failed: ${String(e)} (you can only delete stubs you archived)`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Pay stub history <HelpButton id="pay.history" label="Pay stub history" />
              <SectionId id="pay.history" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Every printed pay stub, archived as the <strong>exact document that was generated</strong> — open one to
              review or re-print precisely what was sent, even if the data behind it has changed since. Stubs are
              archived automatically when you print from Build payout or Hourly staff.
            </div>
          </div>
          {onBack && (
            <button className="btn btn--sm" onClick={onBack} title="Back to the Pay staff overview">
              ← Pay staff
            </button>
          )}
        </div>

        {error && (
          <p className="notice notice--warn" style={{ marginTop: 8 }}>
            {error} — the archive table needs migration <code>9970_staff_hourly_pay.sql</code> applied.
          </p>
        )}
        {flash && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{flash}</div>}

        <div className="filter-bar" style={{ padding: "12px 0 0", borderBottom: "none" }}>
          <label className="filter">
            <span>Search</span>
            <input
              type="text"
              placeholder="name, month (2026-06), mentor/hourly…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 260 }}
            />
          </label>
          <span className="muted" style={{ fontSize: 12, alignSelf: "end", paddingBottom: 6 }}>
            {filtered.length} of {stubs.length} stub{stubs.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <div className="table-scroll" style={{ marginTop: 10 }}>
            <table className="table table--center">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Archived</th>
                  <th style={{ textAlign: "left" }}>Staff</th>
                  <th>Kind</th>
                  <th>Period</th>
                  <th>Status when printed</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: "left" }}>{fmtDateTime(s.createdAt)}</td>
                    <td style={{ textAlign: "left", fontWeight: 500 }}>{s.staffName}</td>
                    <td>
                      <span className={`pill ${s.kind === "mentor" ? "pill--mentee" : "pill--running"}`}>{s.kind}</span>
                    </td>
                    <td>{s.periodMonth}</td>
                    <td>
                      <span className={`pill ${s.status === "approved" ? "pill--success" : "pill--pending"}`}>
                        {s.status === "approved" ? "approved" : "review copy"}
                      </span>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtUsd(s.total)}</td>
                    <td>
                      <span style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button className="linkbtn" onClick={() => openStub(s)} disabled={busyId === s.id} title="Open the archived stub (then print from the window if needed)">
                          view
                        </button>
                        <button className="linkbtn" onClick={() => remove(s)} disabled={busyId === s.id} title="Delete this archived stub">
                          delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No archived stubs{q ? " match the search" : " yet — print one from Build payout or Hourly staff"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
