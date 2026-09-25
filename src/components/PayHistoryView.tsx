import { useEffect, useMemo, useState } from "react";
import {
  fetchPaystubs,
  fetchPaystubHtml,
  fetchPaystubPdf,
  deletePaystub,
  fetchPaystubEmailLog,
  fetchCoachesWithSettings,
  fetchStaffPayProfiles,
  lastSentPaystubEmail,
  periodLabel,
  resolveHourlyPayEmail,
  resolveMentorPayEmail,
  type PaystubEmailRecord,
  type PaystubListItem,
  type ResolvedPayEmail,
} from "../db";
import { sendPaystubEmail } from "../api";
import { showPdfInWindow } from "../pdf";
import { fmtDateTime } from "../format";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";
import { EmailStubModal } from "./EmailStubModal";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);

// Pay staff → HISTORY (207): the archive of every printed pay stub — mentor
// engine stubs and hourly timesheet stubs — stored as the exact HTML document
// that was generated. Open one to review (or re-print) precisely what was sent,
// even if the underlying data has changed since. Emailed stubs also keep the
// exact PDF that was attached, plus when / to whom it went (§908 email log).
export function PayHistoryView({ onBack }: { onBack?: () => void }) {
  const [stubs, setStubs] = useState<PaystubListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [emailLog, setEmailLog] = useState<PaystubEmailRecord[]>([]);
  // Address book for the resend dialog (best effort — the server decides anyway).
  const [coachEmails, setCoachEmails] = useState<
    Map<number, { caEmail: string | null; payEmail: string | null }>
  >(new Map());
  const [profileEmails, setProfileEmails] = useState<
    Map<string, { email: string | null; coachId: number | null }>
  >(new Map());
  const [emailFor, setEmailFor] = useState<PaystubListItem | null>(null);

  async function reload() {
    const [list, log] = await Promise.all([fetchPaystubs(), fetchPaystubEmailLog()]);
    setStubs(list);
    setEmailLog(log);
  }

  useEffect(() => {
    let live = true;
    Promise.all([
      fetchCoachesWithSettings().catch(() => []),
      fetchStaffPayProfiles().catch(() => []),
    ]).then(([cs, ps]) => {
      if (!live) return;
      setCoachEmails(
        new Map(cs.map((c) => [c.coachId, { caEmail: c.caEmail, payEmail: c.payEmail }])),
      );
      setProfileEmails(new Map(ps.map((x) => [x.id, { email: x.email, coachId: x.coachId }])));
    });
    return () => {
      live = false;
    };
  }, []);

  // Latest email attempt per archived stub (the log is newest-first).
  const emailByStub = useMemo(() => {
    const m = new Map<string, PaystubEmailRecord>();
    for (const r of emailLog) if (r.paystubId && !m.has(r.paystubId)) m.set(r.paystubId, r);
    return m;
  }, [emailLog]);

  function recipientFor(s: PaystubListItem): ResolvedPayEmail | null {
    if (s.kind === "mentor")
      return s.coachId != null ? resolveMentorPayEmail(coachEmails.get(s.coachId) ?? {}) : null;
    const prof = s.profileId ? profileEmails.get(s.profileId) : undefined;
    if (!prof) return null;
    return resolveHourlyPayEmail({
      profileEmail: prof.email,
      linkedCoach: prof.coachId != null ? (coachEmails.get(prof.coachId) ?? null) : null,
    });
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
      (s) =>
        s.staffName.toLowerCase().includes(needle) ||
        s.periodMonth.includes(needle) ||
        s.kind.includes(needle),
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

  // Open the archived PDF (emailed stubs). The window opens on the click itself
  // so popup blockers allow it; the PDF streams in once fetched.
  async function openPdf(s: PaystubListItem) {
    const w = window.open("", "_blank");
    if (!w) {
      setFlash("Popup blocked — allow popups for this site to view the PDF.");
      return;
    }
    setBusyId(s.id);
    try {
      const b64 = await fetchPaystubPdf(s.id);
      if (!b64) throw new Error("no PDF stored for this stub");
      showPdfInWindow(w, b64);
    } catch (e) {
      w.close();
      setFlash(`Open failed: ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: PaystubListItem) {
    if (
      !confirm(
        `Delete the archived ${s.periodMonth} stub for ${s.staffName}? This can't be undone.`,
      )
    )
      return;
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
              Every printed or emailed pay stub, archived as the{" "}
              <strong>exact document that was generated</strong> — open one to review or re-print
              precisely what was sent, even if the data behind it has changed since. Emailed stubs
              keep the <strong>PDF that was attached</strong> and show when and to whom it went.
              Stubs are archived automatically when you print or email from Build payout or Hourly
              staff.
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
            {error} — the archive table needs migration <code>9970_staff_hourly_pay.sql</code>{" "}
            applied.
          </p>
        )}
        {flash && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {flash}
          </div>
        )}

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
                  <th>Emailed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: "left" }}>{fmtDateTime(s.createdAt)}</td>
                    <td style={{ textAlign: "left", fontWeight: 500 }}>{s.staffName}</td>
                    <td>
                      <span
                        className={`pill ${s.kind === "mentor" ? "pill--mentee" : "pill--running"}`}
                      >
                        {s.kind}
                      </span>
                    </td>
                    <td>{s.periodMonth}</td>
                    <td>
                      <span
                        className={`pill ${s.status === "approved" ? "pill--success" : "pill--pending"}`}
                      >
                        {s.status === "approved" ? "approved" : "review copy"}
                      </span>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {fmtUsd(s.total)}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {(() => {
                        const e = emailByStub.get(s.id);
                        if (!e) return <span className="muted">—</span>;
                        return e.status === "sent" ? (
                          <span
                            title={`Sent to ${e.toEmail}${e.sentByEmail ? ` by ${e.sentByEmail}` : ""}`}
                          >
                            ✓ {fmtDateTime(e.createdAt)}
                            <div className="muted" style={{ fontSize: 11 }}>
                              {e.toEmail}
                            </div>
                          </span>
                        ) : (
                          <span className="pill pill--error" title={e.error ?? undefined}>
                            failed
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <span style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button
                          className="linkbtn"
                          onClick={() => openStub(s)}
                          disabled={busyId === s.id}
                          title="Open the archived stub (then print from the window if needed)"
                        >
                          view
                        </button>
                        {s.hasPdf && (
                          <button
                            className="linkbtn"
                            onClick={() => openPdf(s)}
                            disabled={busyId === s.id}
                            title="Open the exact PDF that was emailed"
                          >
                            pdf
                          </button>
                        )}
                        {s.hasPdf && s.status === "approved" && (
                          <button
                            className="linkbtn"
                            onClick={() => setEmailFor(s)}
                            disabled={busyId === s.id}
                            title="Email this PDF again — only while it still matches the approved build"
                          >
                            email
                          </button>
                        )}
                        <button
                          className="linkbtn"
                          onClick={() => remove(s)}
                          disabled={busyId === s.id}
                          title="Delete this archived stub"
                        >
                          delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No archived stubs
                      {q
                        ? " match the search"
                        : " yet — print one from Build payout or Hourly staff"}
                      .
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {emailFor && (
        <EmailStubModal
          title={`${emailFor.staffName} · ${periodLabel(emailFor.periodMonth)}`}
          recipient={recipientFor(emailFor)}
          total={emailFor.total}
          fixHint={
            emailFor.kind === "mentor"
              ? "Admin → Mentor capacity"
              : "the Pay-stub email box on Hourly staff"
          }
          lastSent={
            emailFor.kind === "mentor" && emailFor.coachId != null
              ? lastSentPaystubEmail(
                  emailLog,
                  { kind: "mentor", coachId: emailFor.coachId },
                  emailFor.periodMonth,
                )
              : emailFor.kind === "hourly" && emailFor.profileId
                ? lastSentPaystubEmail(
                    emailLog,
                    { kind: "hourly", profileId: emailFor.profileId },
                    emailFor.periodMonth,
                  )
                : null
          }
          onSend={async () => {
            const r = await sendPaystubEmail(emailFor.id);
            setEmailLog(await fetchPaystubEmailLog());
            setFlash(`Emailed ${emailFor.staffName}'s ${emailFor.periodMonth} stub to ${r.to}.`);
          }}
          onClose={() => setEmailFor(null)}
        />
      )}
    </div>
  );
}
