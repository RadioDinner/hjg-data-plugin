import { useEffect, useMemo, useState } from "react";
import {
  fetchStaffPayProfiles,
  createStaffPayProfile,
  updateStaffPayProfile,
  fetchStaffPayBuilds,
  saveStaffPayBuild,
  deleteStaffPayBuild,
  staffPayBuildKey,
  savePaystub,
  normalizeEntries,
  hoursTotal,
  hourlyTotal,
  laborTotal,
  normalizePieces,
  piecesTotal,
  buildHourlyStubModel,
  hourlyStubHtml,
  hourlyStubPdfDoc,
  setStaffPayPaymentSent,
  fetchCoachesWithSettings,
  fetchPaystubEmailLog,
  lastSentPaystubEmail,
  resolveHourlyPayEmail,
  isValidEmail,
  periodLabel,
  type PaystubEmailRecord,
  type StaffPayProfile,
  type StaffPayBuildRecord,
  type HourlyEntry,
  type PieceEntry,
  type BuildStatus,
} from "../db";
import { useAuth } from "../auth";
import { sendPaystubEmail } from "../api";
import { renderPdfBase64 } from "../pdf";
import { fmtDateTime } from "../format";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";
import { PieceWorkCard } from "./PieceWorkCard";
import { EmailStubModal } from "./EmailStubModal";
import { TimesheetTable } from "./TimesheetTable";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);
function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Pay staff → HOURLY STAFF (206): timesheet-driven pay for staff the CA-invoice
// engine doesn't cover. Pick a person + month, set their rate, type the time
// sheet in (date / work / hours), add an adjustment + paystub notes, save as
// draft, approve, and print the pay stub (which is archived to History). Once
// approved, the stub can be EMAILED as a PDF (§908) to the address on their
// profile, and the payout marked PAYMENT SENT with the Melio reference (§909).
export function HourlyPayView({ onBack }: { onBack?: () => void }) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<StaffPayProfile[]>([]);
  const [builds, setBuilds] = useState<Map<string, StaffPayBuildRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [ym, setYm] = useState<string>(currentYm());

  // New-staff inline form.
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newEmail, setNewEmail] = useState("");
  // The selected person's pay-stub email as typed (saved to the profile on blur).
  const [emailDraft, setEmailDraft] = useState("");

  // Working build state for the selected profile+month.
  const [rate, setRate] = useState<number>(0);
  const [entries, setEntries] = useState<HourlyEntry[]>([]);
  const [pieces, setPieces] = useState<PieceEntry[]>([]);
  const [adjustment, setAdjustment] = useState<number>(0);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<BuildStatus>("draft");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // "Payment sent" dialog (§909): the Melio payment number as the reference.
  const [payModal, setPayModal] = useState(false);
  const [payRef, setPayRef] = useState("");
  const [payErr, setPayErr] = useState<string | null>(null);
  // "Email stub" (§908): coach addresses (for a profile linked to a coach) +
  // the send log. Both optional — empty before migration 9962.
  const [coachEmails, setCoachEmails] = useState<
    Map<number, { caEmail: string | null; payEmail: string | null }>
  >(new Map());
  const [emailLog, setEmailLog] = useState<PaystubEmailRecord[]>([]);
  const [emailModal, setEmailModal] = useState(false);

  async function reload() {
    const [p, b] = await Promise.all([fetchStaffPayProfiles(), fetchStaffPayBuilds()]);
    setProfiles(p);
    setBuilds(b);
    return p;
  }

  useEffect(() => {
    let live = true;
    reload()
      .then((p) => {
        if (!live) return;
        setError(null);
        if (p.length && profileId == null) setProfileId(p[0].id);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([fetchCoachesWithSettings().catch(() => []), fetchPaystubEmailLog()]).then(
      ([cs, log]) => {
        if (!live) return;
        setCoachEmails(
          new Map(cs.map((c) => [c.coachId, { caEmail: c.caEmail, payEmail: c.payEmail }])),
        );
        setEmailLog(log);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const savedRec = profile ? builds.get(staffPayBuildKey(profile.id, ym)) : undefined;

  // Load the saved build (or a fresh sheet at the profile's rate) on selection
  // change. Keyed on the profile's ID, not the object: saving a profile field
  // (rate, email) replaces the object and must not wipe an unsaved timesheet.
  const selectedId = profile?.id ?? null;
  useEffect(() => {
    const prof = profiles.find((p) => p.id === selectedId);
    if (!prof) return;
    const rec = builds.get(staffPayBuildKey(prof.id, ym));
    setRate(rec ? rec.rate : prof.hourlyRate);
    setEntries(rec ? rec.entries.map((e) => ({ ...e })) : []);
    setPieces(rec ? rec.pieces.map((x) => ({ ...x })) : []);
    setAdjustment(rec?.adjustment ?? 0);
    setAdjustmentNote(rec?.adjustmentNote ?? "");
    setNotes(rec?.notes ?? "");
    setStatus(rec?.status ?? "draft");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ym, builds]);

  // The email box mirrors the SAVED profile email: it resets on a person switch
  // and re-syncs once a save lands (independent of the timesheet reset above).
  const savedEmail = profile?.email ?? "";
  useEffect(() => setEmailDraft(savedEmail), [selectedId, savedEmail]);

  const locked = status === "approved";
  const cleanEntries = useMemo(() => normalizeEntries(entries), [entries]);
  const cleanPieces = useMemo(() => normalizePieces(pieces), [pieces]);
  const hours = hoursTotal(cleanEntries);
  const labor = laborTotal(cleanEntries, rate);
  const pieceTotal = piecesTotal(cleanPieces);
  const total = hourlyTotal(cleanEntries, rate, adjustment, cleanPieces);
  const paid = !!savedRec?.paymentSentAt;
  const drifted = !!savedRec && Math.abs(total - savedRec.total) > 0.005;
  const canEmail = !!profile && locked && !dirty && !drifted;
  const linkedCoach = profile?.coachId != null ? (coachEmails.get(profile.coachId) ?? null) : null;
  const recipient = profile
    ? resolveHourlyPayEmail({ profileEmail: profile.email, linkedCoach })
    : null;
  const lastEmail = profile
    ? lastSentPaystubEmail(emailLog, { kind: "hourly", profileId: profile.id }, ym)
    : null;

  const touch = () => {
    setDirty(true);
    setFlash(null);
  };

  async function addStaff() {
    const name = newName.trim();
    const r = Number(newRate);
    const email = newEmail.trim();
    if (!name) return;
    if (email && !isValidEmail(email)) {
      setFlash(`Not added — "${email}" isn't a valid email address.`);
      return;
    }
    setBusy(true);
    try {
      await createStaffPayProfile(user?.id ?? "", {
        name,
        hourlyRate: Number.isFinite(r) && r > 0 ? r : 0,
        email: email || null,
      });
      const p = await reload();
      const created = p.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (created) setProfileId(created.id);
      setNewName("");
      setNewRate("");
      setNewEmail("");
      setFlash(`Added ${name}.`);
    } catch (e) {
      setFlash(`Add failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Persist the profile's standing rate when the reviewer edits it here (the
  // build keeps its own copy, so past months are unaffected).
  async function saveProfileRate(r: number) {
    if (!profile || !Number.isFinite(r) || r < 0 || r === profile.hourlyRate) return;
    try {
      await updateStaffPayProfile(profile.id, { hourlyRate: r });
      setProfiles((ps) => ps.map((p) => (p.id === profile.id ? { ...p, hourlyRate: r } : p)));
    } catch (e) {
      setFlash(`Rate save failed: ${String(e)}`);
    }
  }

  // Save the pay-stub email typed for this person (on blur). Refuses a malformed
  // address rather than storing it; blank clears it.
  async function saveProfileEmail(raw: string) {
    if (!profile) return;
    const next = raw.trim() || null;
    if (next === (profile.email ?? null)) return;
    if (next && !isValidEmail(next)) {
      setFlash(`Email not saved — "${next}" isn't a valid address.`);
      return;
    }
    try {
      await updateStaffPayProfile(profile.id, { email: next });
      setProfiles((ps) => ps.map((p) => (p.id === profile.id ? { ...p, email: next } : p)));
      setFlash(
        next ? `Saved ${profile.name}'s pay-stub email.` : `Cleared ${profile.name}'s email.`,
      );
    } catch (e) {
      setFlash(`Email save failed: ${String(e)}`);
    }
  }

  // Record (or update the reference of) the actual payment for this approved
  // timesheet — the hourly twin of Build payout's Payment sent (§906).
  async function markPaymentSent() {
    if (!profile) return;
    setBusy(true);
    setPayErr(null);
    try {
      const sentAt = savedRec?.paymentSentAt ?? new Date().toISOString();
      const ref = payRef.trim() || null;
      await setStaffPayPaymentSent(profile.id, ym, { sentAt, ref });
      setBuilds((m) => {
        const next = new Map(m);
        const key = staffPayBuildKey(profile.id, ym);
        const rec = next.get(key);
        if (rec) next.set(key, { ...rec, paymentSentAt: sentAt, paymentRef: ref });
        return next;
      });
      setPayModal(false);
      setFlash(`Payment recorded as sent${ref ? ` — Melio ref ${ref}` : ""}.`);
    } catch (e) {
      setPayErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unmarkPaymentSent() {
    if (!profile || !paid) return;
    if (!confirm(`Clear the Payment-sent mark for ${profile.name} — ${ym}?`)) return;
    setBusy(true);
    setPayErr(null);
    try {
      await setStaffPayPaymentSent(profile.id, ym, null);
      setBuilds((m) => {
        const next = new Map(m);
        const key = staffPayBuildKey(profile.id, ym);
        const rec = next.get(key);
        if (rec) next.set(key, { ...rec, paymentSentAt: null, paymentRef: null });
        return next;
      });
      setPayModal(false);
      setFlash("Payment-sent mark cleared.");
    } catch (e) {
      setPayErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function persist(nextStatus: BuildStatus) {
    if (!profile) return;
    setBusy(true);
    try {
      await saveStaffPayBuild(user?.id ?? "", {
        profileId: profile.id,
        periodMonth: ym,
        rate,
        entries,
        pieces,
        adjustment,
        adjustmentNote: adjustmentNote.trim() || null,
        notes: notes.trim() || null,
        status: nextStatus,
      });
      setBuilds(await fetchStaffPayBuilds());
      setStatus(nextStatus);
      setDirty(false);
      setFlash(nextStatus === "approved" ? "Approved and saved." : "Draft saved.");
    } catch (e) {
      setFlash(
        `Save failed: ${String(e)} — staff-pay tables need migration 9970_staff_hourly_pay.sql`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!profile || !savedRec) return;
    const paidWarning = savedRec.paymentSentAt
      ? ` It is marked PAID${savedRec.paymentRef ? ` (Melio ref ${savedRec.paymentRef})` : ""} — discarding DELETES the payment record too.`
      : "";
    if (!confirm(`Discard the saved ${ym} timesheet for ${profile.name}?${paidWarning}`)) return;
    setBusy(true);
    try {
      await deleteStaffPayBuild(profile.id, ym);
      setBuilds(await fetchStaffPayBuilds());
      setFlash("Saved timesheet discarded.");
    } catch (e) {
      setFlash(`Discard failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Print the stub in a new window and ARCHIVE the exact document to History.
  async function printStub() {
    if (!profile) return;
    const model = buildHourlyStubModel({
      staffName: profile.name,
      ym,
      rate,
      entries,
      pieces,
      adjustment,
      adjustmentNote: adjustmentNote.trim() || null,
      notes: notes.trim() || null,
      status,
      unsavedChanges: dirty,
      generatedOn: new Date().toISOString().slice(0, 10),
    });
    const html = hourlyStubHtml(model);
    const w = window.open("", "_blank");
    if (!w) {
      setFlash("Popup blocked — allow popups for this site to print the pay stub.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    try {
      await savePaystub(user?.id ?? "", {
        kind: "hourly",
        staffName: profile.name,
        coachId: profile.coachId,
        profileId: profile.id,
        periodMonth: ym,
        status,
        total: model.total,
        html,
      });
      setFlash(
        `${status === "approved" ? "Pay stub" : "Review stub"} printed + archived to History.`,
      );
    } catch (e) {
      setFlash(
        `Stub printed, but archiving failed: ${String(e)} — apply migration 9970_staff_hourly_pay.sql`,
      );
    }
  }

  // Email the APPROVED stub (§908): render the PDF from the saved timesheet,
  // archive it (HTML + PDF) to History, then ask the server to send that
  // archived copy. The server re-checks it against the approved timesheet and
  // picks the recipient itself. Throws on failure (the dialog shows it).
  async function emailStub(): Promise<void> {
    if (!profile) throw new Error("Pick a staff member first.");
    if (!canEmail)
      throw new Error(
        "Approve and save the timesheet first — only the signed-off stub is emailed.",
      );
    const model = buildHourlyStubModel({
      staffName: profile.name,
      ym,
      rate,
      entries,
      pieces,
      adjustment,
      adjustmentNote: adjustmentNote.trim() || null,
      notes: notes.trim() || null,
      status,
      unsavedChanges: false,
      generatedOn: new Date().toISOString().slice(0, 10),
    });
    const pdfBase64 = await renderPdfBase64(hourlyStubPdfDoc(model));
    const id = await savePaystub(user?.id ?? "", {
      kind: "hourly",
      staffName: profile.name,
      coachId: profile.coachId,
      profileId: profile.id,
      periodMonth: ym,
      status,
      total: model.total,
      html: hourlyStubHtml(model),
      pdfBase64,
    });
    const r = await sendPaystubEmail(id);
    setEmailLog(await fetchPaystubEmailLog());
    setFlash(`Pay stub emailed to ${r.to} — the PDF is archived in History.`);
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Hourly staff <HelpButton id="pay.hourly" label="Hourly staff" />
              <SectionId id="pay.hourly" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Timesheet-driven pay for staff the invoice engine doesn't cover: set the{" "}
              <strong>default hourly rate</strong>, enter the <strong>hours</strong> from their time
              sheet (any line can carry its <strong>own rate</strong> when that work pays more), add{" "}
              <strong>piece-work</strong> items paid per unit, then save/approve,{" "}
              <strong>print</strong> or <strong>email</strong> the pay stub (archived to History
              automatically), and mark the <strong>payment sent</strong>.
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
            {error} — the staff-pay tables need migration <code>9970_staff_hourly_pay.sql</code>{" "}
            applied.
          </p>
        )}

        <div className="filter-bar" style={{ padding: "12px 0 0", borderBottom: "none" }}>
          <label className="filter">
            <span>Staff</span>
            <select value={profileId ?? ""} onChange={(e) => setProfileId(e.target.value || null)}>
              {profiles.length === 0 && <option value="">— add someone below —</option>}
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Period month</span>
            <input
              type="month"
              value={ym}
              onChange={(e) => e.target.value && setYm(e.target.value)}
            />
          </label>
          <label className="filter">
            <span>New staff</span>
            <span style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: 160 }}
              />
              <input
                type="number"
                placeholder="$/h"
                min="0"
                step="0.5"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                style={{ width: 80 }}
              />
              <input
                type="email"
                placeholder="Email (for pay stubs)"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={{ width: 190 }}
              />
              <button className="btn btn--sm" onClick={addStaff} disabled={busy || !newName.trim()}>
                + Add
              </button>
            </span>
          </label>
        </div>
      </section>

      {profile && (
        <div className="builder">
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontSize: 15 }}>
                  {profile.name} · {ym}
                  {locked && !paid && (
                    <span className="pill pill--success" style={{ marginLeft: 8 }}>
                      approved
                    </span>
                  )}
                  {/* Renders whatever the status, so reopening an already-paid
                      timesheet never hides that money already moved. */}
                  {paid && (
                    <span
                      className="pill pill--success"
                      style={{ marginLeft: 8 }}
                      title={savedRec?.paymentRef ? `Melio ref ${savedRec.paymentRef}` : undefined}
                    >
                      paid ✓{!locked ? " (reopened)" : ""}
                    </span>
                  )}
                  {dirty && (
                    <span className="pill pill--running" style={{ marginLeft: 8 }}>
                      unsaved
                    </span>
                  )}
                </h2>
                <div
                  className="muted"
                  style={{
                    fontSize: 12,
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span>Rate</span>
                  <input
                    className="input--inline"
                    type="number"
                    min="0"
                    step="0.5"
                    style={{ width: 76 }}
                    value={rate === 0 ? "" : String(rate)}
                    placeholder="0"
                    disabled={locked}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setRate(Number.isFinite(n) && n >= 0 ? n : 0);
                      touch();
                    }}
                    onBlur={() => saveProfileRate(rate)}
                    title="DEFAULT hourly rate for this period — any timesheet line left blank in the Rate column is paid at this. On blur it also becomes the staff member's standing rate for future months (saved months keep the rate they were saved with)."
                    aria-label={`Default hourly rate for ${profile.name}`}
                  />
                  <span>
                    $/hour default · {cleanEntries.length} line
                    {cleanEntries.length === 1 ? "" : "s"} · {hours} h · {fmtUsd(labor)} labor
                    {pieceTotal !== 0 ? ` · ${fmtUsd(pieceTotal)} piece work` : ""}
                  </span>
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span>Pay-stub email</span>
                  <input
                    className="input--inline"
                    type="email"
                    style={{ width: 230 }}
                    value={emailDraft}
                    placeholder={
                      linkedCoach?.payEmail || linkedCoach?.caEmail
                        ? `blank = ${linkedCoach.payEmail || linkedCoach.caEmail}`
                        : "name@example.com"
                    }
                    onChange={(e) => setEmailDraft(e.target.value)}
                    onBlur={() => saveProfileEmail(emailDraft)}
                    title="Where this person's pay stubs are emailed. Saved to their profile when you leave the box. Blank = their linked coach's email, if any."
                    aria-label={`Pay-stub email for ${profile.name}`}
                  />
                  {emailDraft.trim() && !isValidEmail(emailDraft) && (
                    <span style={{ color: "var(--warn-text)" }}>not a valid address</span>
                  )}
                </div>
              </div>
              <div
                className="stub-actions"
                style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
              >
                <button
                  className={`btn btn--sm ${locked && !paid ? "btn--primary" : ""}`}
                  onClick={printStub}
                  disabled={!profile}
                  title={
                    locked
                      ? paid
                        ? "This payout was already paid — reprint the approved pay stub (opens a print window; archived to History)"
                        : "Print the approved pay stub (opens a print window; archived to History)"
                      : "Print a REVIEW-COPY pay stub of the current draft (watermarked; archived to History)"
                  }
                >
                  {locked ? (paid ? "Reprint pay stub" : "Print pay stub") : "Print review stub"}
                </button>
                <button
                  className="btn btn--sm"
                  onClick={() => setEmailModal(true)}
                  disabled={!canEmail}
                  title={
                    !locked
                      ? "Approve (and save) the timesheet first — only the signed-off pay stub can be emailed"
                      : dirty
                        ? "Save your changes first — the emailed stub must match the saved timesheet"
                        : drifted
                          ? "The saved total differs from what's shown — reopen, save and approve again before emailing"
                          : lastEmail
                            ? `Emailed ${fmtDateTime(lastEmail.createdAt)} to ${lastEmail.toEmail} — click to send it again`
                            : "Email the approved pay stub as a PDF"
                  }
                >
                  {lastEmail ? "Email stub ✓" : "Email stub…"}
                </button>
                <button
                  className={`btn btn--sm ${locked && !paid ? "btn--primary" : ""}`}
                  onClick={() => {
                    setPayRef(savedRec?.paymentRef ?? "");
                    setPayErr(null);
                    setPayModal(true);
                  }}
                  disabled={!savedRec || (!locked && !paid)}
                  title={
                    !savedRec || (!locked && !paid)
                      ? "Approve (and save) the timesheet first — Payment sent records that the approved payout was actually paid"
                      : paid
                        ? `Payment sent ${savedRec?.paymentSentAt ? fmtDateTime(savedRec.paymentSentAt) : ""}${savedRec?.paymentRef ? ` · Melio ref ${savedRec.paymentRef}` : ""} — click to edit the reference or clear the mark`
                        : "Record that this payout was paid, with the Melio payment number as reference"
                  }
                >
                  {paid ? "Payment sent ✓" : "Payment sent…"}
                </button>
              </div>
            </div>

            <TimesheetTable
              entries={entries}
              onChange={(next) => {
                setEntries(next);
                touch();
              }}
              defaultRate={rate}
              locked={locked}
            />
          </section>

          <div style={{ gridColumn: "1 / -1" }}>
            <PieceWorkCard
              items={pieces}
              onChange={(next) => {
                setPieces(next);
                touch();
              }}
              locked={locked}
              sectionId="pay.hourly.pieces"
              hint={`Flat pay per unit for ${profile.name}, on top of the hours — e.g. $25 for every new mentee.`}
            />
          </div>

          <aside className="builder__side">
            <div className="card">
              <div className="muted" style={{ fontSize: 12 }}>
                Payout ({ym})
              </div>
              <div className="builder__total">{fmtUsd(total)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {fmtUsd(labor)} labor ({hours} h)
                {pieceTotal !== 0 ? <> + {fmtUsd(pieceTotal)} piece work</> : null}
                {Math.abs(adjustment) >= 0.005 ? <> + {fmtUsd(adjustment)} adjustment</> : null}
              </div>
              <label className="filter" style={{ width: "100%", marginTop: 10 }}>
                <span>Adjustment ($, + or −)</span>
                <input
                  type="number"
                  step="0.01"
                  value={adjustment === 0 ? "" : String(adjustment)}
                  placeholder="0.00"
                  disabled={locked}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setAdjustment(Number.isFinite(n) ? n : 0);
                    touch();
                  }}
                />
              </label>
              <label className="filter" style={{ width: "100%", marginTop: 6 }}>
                <span>Adjustment reason</span>
                <input
                  type="text"
                  value={adjustmentNote}
                  placeholder="bonus, correction…"
                  disabled={locked}
                  onChange={(e) => {
                    setAdjustmentNote(e.target.value);
                    touch();
                  }}
                />
              </label>
            </div>

            <div className="card">
              <label className="filter" style={{ width: "100%" }}>
                <span>Pay stub note</span>
                <textarea
                  rows={3}
                  value={notes}
                  disabled={locked}
                  placeholder="Printed on the stub — anything worth telling them…"
                  onChange={(e) => {
                    setNotes(e.target.value);
                    touch();
                  }}
                  style={{
                    resize: "vertical",
                    width: "100%",
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    color: "var(--text)",
                    padding: "6px 8px",
                    fontSize: 13,
                  }}
                />
              </label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {!locked ? (
                  <>
                    <button
                      className="btn btn--sm"
                      onClick={() => persist("draft")}
                      disabled={busy}
                    >
                      Save draft
                    </button>
                    <button
                      className="btn btn--sm btn--primary"
                      onClick={() => persist("approved")}
                      disabled={busy}
                    >
                      Approve
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn--sm"
                    onClick={() => {
                      if (
                        paid &&
                        !confirm(
                          `This timesheet is already marked PAID${savedRec?.paymentRef ? ` (Melio ref ${savedRec.paymentRef})` : ""}. ` +
                            "Reopening lets the amounts change while the payment record stays — if you re-approve at a different total, " +
                            "what was actually sent won't match. Continue?",
                        )
                      )
                        return;
                      persist("draft");
                    }}
                    disabled={busy}
                  >
                    Reopen
                  </button>
                )}
                {savedRec && (
                  <button className="btn btn--sm btn--danger" onClick={discard} disabled={busy}>
                    Discard
                  </button>
                )}
              </div>

              {flash && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {flash}
                </div>
              )}
              {savedRec && (
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Last saved {fmtDateTime(savedRec.updatedAt)} · status {savedRec.status}
                </div>
              )}
              {paid && savedRec && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Payment sent {fmtDateTime(savedRec.paymentSentAt)}
                  {savedRec.paymentRef ? (
                    <>
                      {" "}
                      · Melio ref <strong>{savedRec.paymentRef}</strong>
                    </>
                  ) : null}
                </div>
              )}
              {lastEmail && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Stub emailed {fmtDateTime(lastEmail.createdAt)} to{" "}
                  <strong>{lastEmail.toEmail}</strong>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Payment sent — Melio reference dialog for an hourly timesheet (§909). */}
      {payModal && profile && (
        <div className="modal" onClick={() => setPayModal(false)}>
          <div
            className="modal__card"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <h2>
                Payment sent — {profile.name} · {ym} <SectionId id="modal.hourlyPaymentSent" />
              </h2>
              <button className="btn btn--sm" onClick={() => setPayModal(false)}>
                Close
              </button>
            </div>
            <div className="modal__body" style={{ padding: "12px 20px 16px" }}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Records that this approved payout was actually paid (
                {fmtUsd(savedRec?.total ?? total)}). Enter the <strong>Melio payment number</strong>{" "}
                as the reference so the payment is easy to trace later.
              </p>
              <label className="filter" style={{ width: "100%" }}>
                <span>Melio payment number (reference)</span>
                <input
                  type="text"
                  value={payRef}
                  placeholder="e.g. PMT-12345"
                  autoFocus
                  onChange={(e) => setPayRef(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") markPaymentSent();
                  }}
                  style={{ width: "100%" }}
                />
              </label>
              {paid && savedRec?.paymentSentAt && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Already marked sent {fmtDateTime(savedRec.paymentSentAt)} — saving updates the
                  reference.
                </p>
              )}
              {payErr && (
                <div className="notice notice--warn" style={{ fontSize: 12 }}>
                  {payErr}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  className="btn btn--sm btn--primary"
                  onClick={markPaymentSent}
                  disabled={busy}
                >
                  {paid ? "Save reference" : "Mark payment sent"}
                </button>
                {paid && (
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={unmarkPaymentSent}
                    disabled={busy}
                  >
                    Clear payment-sent mark
                  </button>
                )}
                <button className="btn btn--sm" onClick={() => setPayModal(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {emailModal && profile && (
        <EmailStubModal
          title={`${profile.name} · ${periodLabel(ym)}`}
          recipient={recipient}
          total={savedRec?.total ?? total}
          fixHint="the Pay-stub email box on Hourly staff"
          lastSent={lastEmail}
          onSend={emailStub}
          onClose={() => setEmailModal(false)}
        />
      )}
    </div>
  );
}
