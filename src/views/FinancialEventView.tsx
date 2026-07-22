import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import {
  fetchFinancialEvents,
  createFinancialEvent,
  createNotification,
  uploadReceipt,
  receiptUrl,
  type FinancialEvent,
} from "../db";
import { fmtDate, fmtDateTime } from "../format";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";

const PAYMENT_METHODS = ["Card", "Check", "Cash", "ACH / bank transfer", "Melio", "Other"];

// LOCAL calendar date (not UTC — toISOString would default the form to
// "tomorrow" for a US user in the evening).
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Report financial event (§651) — a quick form for logging a transaction: when
// it happened, the vendor, what it was, the payment method, and an optional
// receipt image/PDF (stored in the private `receipts` bucket). Submitting also
// drops a notification into the topbar bell (§907) so org support staff see it.
// Needs migration 9965_financial_events.sql.
export function FinancialEventView({ onSubmitted }: { onSubmitted?: () => void }) {
  const { user } = useAuth();
  const [events, setEvents] = useState<FinancialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state.
  const [happenedOn, setHappenedOn] = useState(todayYmd());
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0); // reset the <input type=file> after submit

  async function load() {
    try {
      setEvents(await fetchFinancialEvents());
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

  async function submit() {
    if (!vendor.trim()) {
      setError("Vendor is required.");
      return;
    }
    if (!happenedOn) {
      setError("Enter when the transaction happened.");
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      let receiptPath: string | null = null;
      if (file) receiptPath = await uploadReceipt(file);
      await createFinancialEvent(user?.id ?? "", user?.email ?? null, {
        happenedOn,
        vendor: vendor.trim(),
        description: description.trim() || null,
        paymentMethod: method || null,
        receiptPath,
      });
      // The alert for org support staff — lands in the topbar bell (§907).
      let notified = true;
      try {
        await createNotification(user?.id ?? "", {
          kind: "financial_event",
          title: `Financial event reported: ${vendor.trim()}`,
          body: `${fmtDate(happenedOn)} · ${method || "method not given"}${description.trim() ? ` · ${description.trim()}` : ""} — reported by ${user?.email ?? "unknown"}`,
          linkTab: "finevent",
        });
      } catch {
        // The event itself saved; a failed notification shouldn't eat the
        // report — but the flash must not claim staff were alerted.
        notified = false;
      }
      setVendor("");
      setDescription("");
      setMethod("");
      setFile(null);
      setFileKey((k) => k + 1);
      setHappenedOn(todayYmd());
      setFlash(
        notified
          ? "Financial event reported — org support staff have been notified."
          : "Financial event SAVED, but the staff alert could not be sent (notifications table unavailable?) — tell support directly."
      );
      await load();
      onSubmitted?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function viewReceipt(path: string) {
    // Open the window synchronously in the click handler (popup blockers kill
    // a window.open that happens after an await), then point it at the signed
    // URL once it arrives.
    const w = window.open("", "_blank");
    receiptUrl(path)
      .then((url) => {
        if (w) w.location.href = url;
        else window.location.href = url;
      })
      .catch((e) => {
        w?.close();
        setError(String(e));
      });
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Report financial event <SectionId id="finevent.screen" />
              <HelpButton id="finevent.screen" label="Report financial event" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Log a transaction — when it happened, the vendor, what it was, how it was paid — and attach the receipt.
              Submitting alerts org support staff via the <strong>notification bell</strong> in the top bar.
            </div>
          </div>
        </div>

        {error && <div className="notice notice--warn">{error}</div>}
        {flash && !error && <div className="notice notice--info">{flash}</div>}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 4 }}>
          <SectionId id="finevent.form" />
          <label className="field">
            <span>When it happened</span>
            <input type="date" value={happenedOn} max={todayYmd()} onChange={(e) => setHappenedOn(e.target.value)} />
          </label>
          <label className="field">
            <span>Vendor</span>
            <input type="text" value={vendor} placeholder="who was paid" onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label className="field" style={{ minWidth: 260, flex: 1 }}>
            <span>What it was</span>
            <input
              type="text"
              value={description}
              placeholder="what was purchased / what the charge was for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Payment method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">— choose —</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Receipt (image or PDF)</span>
            <input
              key={fileKey}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button className="btn btn--primary" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15 }}>Reported events</h2>
        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <div className="table-scroll">
            <table className="table table--center">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: "left" }}>Vendor</th>
                  <th style={{ textAlign: "left" }}>What it was</th>
                  <th>Method</th>
                  <th>Receipt</th>
                  <th style={{ textAlign: "left" }}>Reported by</th>
                  <th style={{ textAlign: "left" }}>Reported</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{fmtDate(e.happenedOn)}</td>
                    <td style={{ textAlign: "left" }}>{e.vendor}</td>
                    <td style={{ textAlign: "left" }}>{e.description ?? "—"}</td>
                    <td>{e.paymentMethod ?? "—"}</td>
                    <td>
                      {e.receiptPath ? (
                        <button className="linkbtn" onClick={() => viewReceipt(e.receiptPath!)} title="Open the receipt (signed link)">
                          view
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "left" }}>{e.createdByEmail ?? "—"}</td>
                    <td style={{ textAlign: "left" }}>{e.createdAt ? fmtDateTime(e.createdAt) : "—"}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">Nothing reported yet.</td>
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
