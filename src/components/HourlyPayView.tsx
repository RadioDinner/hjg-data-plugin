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
  buildHourlyStubModel,
  hourlyStubHtml,
  type StaffPayProfile,
  type StaffPayBuildRecord,
  type HourlyEntry,
  type BuildStatus,
} from "../db";
import { useAuth } from "../auth";
import { fmtDateTime } from "../format";
import { HelpButton } from "./HelpDrawer";
import { SectionId } from "./SectionId";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);
function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Pay staff → HOURLY STAFF (206): timesheet-driven pay for staff the CA-invoice
// engine doesn't cover. Pick a person + month, set their rate, type the time
// sheet in (date / work / hours), add an adjustment + paystub notes, save as
// draft, approve, and print the pay stub (which is archived to History).
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

  // Working build state for the selected profile+month.
  const [rate, setRate] = useState<number>(0);
  const [entries, setEntries] = useState<HourlyEntry[]>([]);
  const [adjustment, setAdjustment] = useState<number>(0);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<BuildStatus>("draft");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

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

  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const savedRec = profile ? builds.get(staffPayBuildKey(profile.id, ym)) : undefined;

  // Load the saved build (or a fresh sheet at the profile's rate) on selection change.
  useEffect(() => {
    if (!profile) return;
    const rec = builds.get(staffPayBuildKey(profile.id, ym));
    setRate(rec ? rec.rate : profile.hourlyRate);
    setEntries(rec ? rec.entries.map((e) => ({ ...e })) : []);
    setAdjustment(rec?.adjustment ?? 0);
    setAdjustmentNote(rec?.adjustmentNote ?? "");
    setNotes(rec?.notes ?? "");
    setStatus(rec?.status ?? "draft");
    setDirty(false);
  }, [profile, ym, builds]);

  const locked = status === "approved";
  const cleanEntries = useMemo(() => normalizeEntries(entries), [entries]);
  const hours = hoursTotal(cleanEntries);
  const total = hourlyTotal(cleanEntries, rate, adjustment);

  const touch = () => {
    setDirty(true);
    setFlash(null);
  };

  function patchEntry(i: number, patch: Partial<HourlyEntry>) {
    setEntries((arr) => arr.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    touch();
  }

  async function addStaff() {
    const name = newName.trim();
    const r = Number(newRate);
    if (!name) return;
    setBusy(true);
    try {
      await createStaffPayProfile(user?.id ?? "", { name, hourlyRate: Number.isFinite(r) && r > 0 ? r : 0 });
      const p = await reload();
      const created = p.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (created) setProfileId(created.id);
      setNewName("");
      setNewRate("");
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

  async function persist(nextStatus: BuildStatus) {
    if (!profile) return;
    setBusy(true);
    try {
      await saveStaffPayBuild(user?.id ?? "", {
        profileId: profile.id,
        periodMonth: ym,
        rate,
        entries,
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
      setFlash(`Save failed: ${String(e)} — staff-pay tables need migration 9970_staff_hourly_pay.sql`);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!profile || !savedRec) return;
    if (!confirm(`Discard the saved ${ym} timesheet for ${profile.name}?`)) return;
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
        periodMonth: ym,
        status,
        total: model.total,
        html,
      });
      setFlash(`${status === "approved" ? "Pay stub" : "Review stub"} printed + archived to History.`);
    } catch (e) {
      setFlash(`Stub printed, but archiving failed: ${String(e)} — apply migration 9970_staff_hourly_pay.sql`);
    }
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
              Timesheet-driven pay for staff the invoice engine doesn't cover: set the <strong>hourly rate</strong>,
              enter the <strong>hours</strong> from their time sheet, add notes, save/approve, and{" "}
              <strong>print the pay stub</strong> (archived to History automatically).
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
            {error} — the staff-pay tables need migration <code>9970_staff_hourly_pay.sql</code> applied.
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
            <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
          </label>
          <label className="filter">
            <span>New staff</span>
            <span style={{ display: "flex", gap: 6 }}>
              <input type="text" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: 160 }} />
              <input type="number" placeholder="$/h" min="0" step="0.5" value={newRate} onChange={(e) => setNewRate(e.target.value)} style={{ width: 80 }} />
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
                  {locked && <span className="pill pill--success" style={{ marginLeft: 8 }}>approved</span>}
                  {dirty && <span className="pill pill--running" style={{ marginLeft: 8 }}>unsaved</span>}
                </h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
                    title="Hourly rate for this period. On blur it also becomes the staff member's standing rate for future months (saved months keep the rate they were saved with)."
                    aria-label={`Hourly rate for ${profile.name}`}
                  />
                  <span>$/hour · {cleanEntries.length} line{cleanEntries.length === 1 ? "" : "s"} · {hours} h</span>
                </div>
              </div>
              <button
                className={`btn btn--sm ${locked ? "btn--primary" : ""}`}
                onClick={printStub}
                disabled={!profile}
                title={
                  locked
                    ? "Print the approved pay stub (opens a print window; archived to History)"
                    : "Print a REVIEW-COPY pay stub of the current draft (watermarked; archived to History)"
                }
              >
                {locked ? "Print pay stub" : "Print review stub"}
              </button>
            </div>

            <div className="table-scroll">
              <table className="table table--center">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Date</th>
                    <th style={{ textAlign: "left" }}>Work (from the time sheet)</th>
                    <th style={{ width: 90 }}>Hours</th>
                    <th style={{ width: 110 }}>Amount</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="cell-edit"
                          type="date"
                          value={e.date ?? ""}
                          disabled={locked}
                          onChange={(ev) => patchEntry(i, { date: ev.target.value || null })}
                          aria-label={`Date for line ${i + 1}`}
                        />
                      </td>
                      <td style={{ textAlign: "left" }}>
                        <input
                          className="cell-edit"
                          type="text"
                          style={{ width: "100%" }}
                          placeholder="what they worked on…"
                          value={e.label}
                          disabled={locked}
                          onChange={(ev) => patchEntry(i, { label: ev.target.value })}
                          aria-label={`Work description for line ${i + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-edit"
                          type="number"
                          min="0"
                          step="0.25"
                          style={{ width: 70 }}
                          value={e.hours === 0 ? "" : String(e.hours)}
                          placeholder="0"
                          disabled={locked}
                          onChange={(ev) => {
                            const n = Number(ev.target.value);
                            patchEntry(i, { hours: Number.isFinite(n) && n >= 0 ? n : 0 });
                          }}
                          aria-label={`Hours for line ${i + 1}`}
                        />
                      </td>
                      <td className="num">{fmtUsd((e.hours || 0) * rate)}</td>
                      <td>
                        <button
                          className="linkbtn"
                          disabled={locked}
                          onClick={() => {
                            setEntries((arr) => arr.filter((_, j) => j !== i));
                            touch();
                          }}
                          title="Remove this line"
                          aria-label={`Remove line ${i + 1}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No timesheet lines yet — add the first one below.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>
                      Totals
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{hours} h</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmtUsd(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {!locked && (
              <button
                className="btn btn--sm"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setEntries((arr) => [...arr, { date: null, label: "", hours: 0 }]);
                  touch();
                }}
              >
                + Add line
              </button>
            )}
          </section>

          <aside className="builder__side">
            <div className="card">
              <div className="muted" style={{ fontSize: 12 }}>Payout ({ym})</div>
              <div className="builder__total">{fmtUsd(total)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {hours} h × {fmtUsd(rate)}/h{Math.abs(adjustment) >= 0.005 ? <> + {fmtUsd(adjustment)} adjustment</> : null}
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
                  style={{ resize: "vertical", width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", padding: "6px 8px", fontSize: 13 }}
                />
              </label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {!locked ? (
                  <>
                    <button className="btn btn--sm" onClick={() => persist("draft")} disabled={busy}>
                      Save draft
                    </button>
                    <button className="btn btn--sm btn--primary" onClick={() => persist("approved")} disabled={busy}>
                      Approve
                    </button>
                  </>
                ) : (
                  <button className="btn btn--sm" onClick={() => persist("draft")} disabled={busy}>
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
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
