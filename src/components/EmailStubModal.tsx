import { useState } from "react";
import { PAY_EMAIL_SOURCE_LABEL, type PaystubEmailRecord, type ResolvedPayEmail } from "../db";
import { fmtDateTime } from "../format";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Email pay stub (§908) — the confirm step before a stub goes out. Shared by
// Build payout, Hourly staff, and History. It shows exactly WHO will get the
// stub and where that address came from; the server re-resolves the recipient
// itself and refuses anything this dialog wouldn't show (see api/send-paystub).
export function EmailStubModal({
  title,
  recipient,
  total,
  fixHint,
  lastSent,
  onSend,
  onClose,
}: {
  title: string; // "Harry Shenk · Jun 2026"
  recipient: ResolvedPayEmail | null;
  total: number;
  fixHint: string; // where to add / fix the address
  lastSent: PaystubEmailRecord | null;
  onSend: () => Promise<void>; // throws on failure; the caller flashes success
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = !!recipient && recipient.valid;

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await onSend();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div className="modal__card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Email pay stub — {title} <HelpButton id="pay.email" label="Emailing pay stubs" />
            <SectionId id="modal.emailStub" />
          </h2>
          <button className="btn btn--sm" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <div className="modal__body" style={{ padding: "12px 20px 16px" }}>
          {!recipient ? (
            <div className="notice notice--warn" style={{ fontSize: 13 }}>
              No email address on file. Add one in <strong>{fixHint}</strong>, then come back.
            </div>
          ) : !recipient.valid ? (
            <div className="notice notice--warn" style={{ fontSize: 13 }}>
              The email on file (<strong>{recipient.email}</strong>) isn&apos;t a valid address —
              fix it in <strong>{fixHint}</strong>.
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Sends the <strong>approved</strong> pay stub as a <strong>PDF attachment</strong>{" "}
                to:
              </p>
              <div style={{ fontSize: 16, fontWeight: 600, wordBreak: "break-all" }}>
                {recipient.email}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {PAY_EMAIL_SOURCE_LABEL[recipient.source]} · change it in {fixHint}
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                Total on the stub: <strong>{usd.format(total || 0)}</strong>. The email names the
                month only — the amounts are in the PDF, so they never show in a phone&apos;s
                lock-screen preview. A copy of the PDF is archived to History.
              </p>
            </>
          )}
          {lastSent && (
            <div className="notice notice--info" style={{ fontSize: 12, marginTop: 8 }}>
              Already emailed {fmtDateTime(lastSent.createdAt)} to{" "}
              <strong>{lastSent.toEmail}</strong> — sending again delivers a second copy.
            </div>
          )}
          {err && (
            <div className="notice notice--warn" style={{ fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn btn--sm btn--primary" onClick={send} disabled={!ready || busy}>
              {busy ? "Sending…" : "Send email"}
            </button>
            <button className="btn btn--sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
