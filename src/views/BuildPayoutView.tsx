import { useEffect, useMemo, useState } from "react";
import {
  fetchPayData,
  computePayReport,
  computePayTimeline,
  summarizeBuild,
  effectiveLinePayout,
  DEFAULT_LINE_STATE,
  fetchPayoutBuilds,
  savePayoutBuild,
  deletePayoutBuild,
  payoutBuildKey,
  type PayData,
  type PayMenteeLine,
  type BuildLineState,
  type BuildStatus,
  type PayoutBuildRecord,
} from "../db";
import { useAuth } from "../auth";
import { downloadCsv } from "../csv";
import { fmtDateTime } from "../format";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);
const fmtSigned = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd.format(Math.abs(n || 0))}`;
const fmtPct = (n: number) => `${Math.round((n || 0) * 100)}%`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m ? `${SHORT[m - 1]} ${y}` : ym;
}
function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// The actionable sibling of the read-only "Explore source data" window: load one
// mentor + one service month, then confirm/drop each engine-computed line (and
// optionally override a line's payout with a note). A running total updates live;
// the reviewed payout can be saved as a draft and signed off (approved). The
// engine stays the source of truth — this only records the human review.
//
// Hosted inside the Pay staff tab (not a top-nav tab): `onBack` returns to the
// overview; `initialCoachId` / `initialYm` pre-scope it to a clicked mentor+month.
export function BuildPayoutView({
  onBack,
  initialCoachId = null,
  initialYm = "",
}: {
  onBack?: () => void;
  initialCoachId?: number | null;
  initialYm?: string;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<PayData | null>(null);
  const [builds, setBuilds] = useState<Map<string, PayoutBuildRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [coach, setCoach] = useState<number | null>(initialCoachId);
  const [ym, setYm] = useState<string>(initialYm);

  // Working review state for the selected coach+month (reset on selection change).
  const [lineStates, setLineStates] = useState<Record<number, BuildLineState>>({});
  const [notes, setNotes] = useState<string>("");
  const [status, setStatus] = useState<BuildStatus>("draft");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([fetchPayData(), fetchPayoutBuilds()])
      .then(([d, b]) => {
        if (!live) return;
        setData(d);
        setBuilds(b);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  // Full timeline drives the coach list + which months each coach has lines in.
  const timeline = useMemo(() => {
    if (!data) return null;
    return computePayTimeline({
      invoices: data.invoices,
      engagements: data.engagements,
      coachName: data.coachName,
      clientName: data.clientName,
      months: data.months,
      startMonthOverride: data.startMonthOverride,
      primaryCoachOf: data.primaryCoachOf,
    });
  }, [data]);

  const coachOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of timeline?.ledger ?? []) if (r.assigned && r.coachId != null) m.set(r.coachId, r.coachName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [timeline]);

  const monthsByCoach = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const r of timeline?.ledger ?? []) {
      if (!r.assigned || r.coachId == null) continue;
      const arr = m.get(r.coachId) ?? [];
      if (!arr.includes(r.ym)) arr.push(r.ym);
      m.set(r.coachId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.localeCompare(a)); // newest first
    return m;
  }, [timeline]);

  // Pick a sensible default coach once data lands.
  useEffect(() => {
    if (coach == null && coachOptions.length) setCoach(coachOptions[0][0]);
  }, [coach, coachOptions]);

  // Keep the month valid for the chosen coach (newest month they have lines in).
  useEffect(() => {
    if (coach == null) return;
    const months = monthsByCoach.get(coach) ?? [];
    if (!months.length) {
      setYm("");
      return;
    }
    if (!months.includes(ym)) setYm(months[0]);
  }, [coach, monthsByCoach, ym]);

  const savedRec = coach != null && ym ? builds.get(payoutBuildKey(coach, ym)) : undefined;

  // Load the saved review (or reset to defaults) whenever the selection changes.
  useEffect(() => {
    if (coach == null || !ym) return;
    const rec = builds.get(payoutBuildKey(coach, ym));
    setLineStates(rec ? { ...rec.lineStates } : {});
    setNotes(rec?.notes ?? "");
    setStatus(rec?.status ?? "draft");
    setDirty(false);
    // Note: flash is intentionally NOT cleared here — this effect re-runs after a
    // save (builds changes), and we want the "saved" confirmation to survive.
  }, [coach, ym, builds]);

  // Engine report for the selected month, then this coach's lines + the month's
  // unassigned bucket (surfaced for awareness, not part of any coach's payout).
  const report = useMemo(() => {
    if (!data || !ym) return null;
    return computePayReport({
      ym,
      invoices: data.invoices,
      engagements: data.engagements,
      coachName: data.coachName,
      clientName: data.clientName,
      startMonthOverride: data.startMonthOverride,
      primaryCoachOf: data.primaryCoachOf,
    });
  }, [data, ym]);
  const mentor = useMemo(
    () => (report && coach != null ? report.mentors.find((m) => m.coachId === coach) ?? null : null),
    [report, coach]
  );
  const lines: PayMenteeLine[] = mentor?.lines ?? [];
  const unassigned = report?.unassigned ?? [];

  const stateMap = useMemo(() => {
    const m = new Map<number, BuildLineState>();
    for (const [k, v] of Object.entries(lineStates)) m.set(Number(k), v);
    return m;
  }, [lineStates]);

  const summary = useMemo(
    () => summarizeBuild(lines.map((l) => ({ clientId: l.clientId, payout: l.payout })), stateMap),
    [lines, stateMap]
  );

  const locked = status === "approved";
  const stateFor = (clientId: number): BuildLineState => lineStates[clientId] ?? DEFAULT_LINE_STATE;

  function updateLine(clientId: number, patch: Partial<BuildLineState>) {
    setLineStates((s) => ({ ...s, [clientId]: { ...(s[clientId] ?? DEFAULT_LINE_STATE), ...patch } }));
    setDirty(true);
    setFlash(null);
  }

  async function persist(nextStatus: BuildStatus) {
    if (coach == null || !ym) return;
    setBusy(true);
    try {
      await savePayoutBuild(user?.id ?? "", {
        coachId: coach,
        serviceMonth: ym,
        status: nextStatus,
        builtTotal: summary.builtTotal,
        computedTotal: summary.computedTotal,
        lineStates,
        notes: notes.trim() || null,
      });
      const rec: PayoutBuildRecord = {
        coachId: coach,
        serviceMonth: ym,
        status: nextStatus,
        builtTotal: summary.builtTotal,
        computedTotal: summary.computedTotal,
        lineStates,
        notes: notes.trim() || null,
        reviewedBy: user?.id ?? null,
        reviewedAt: new Date().toISOString(),
      };
      setBuilds((m) => new Map(m).set(payoutBuildKey(coach, ym), rec));
      setStatus(nextStatus);
      setDirty(false);
      setFlash(nextStatus === "approved" ? "Approved and saved." : "Draft saved.");
    } catch (e) {
      setFlash(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (coach == null || !ym || !savedRec) return;
    if (!confirm(`Discard the saved review for ${mentor?.coachName ?? "this coach"} — ${monthLabel(ym)}?`)) return;
    setBusy(true);
    try {
      await deletePayoutBuild(coach, ym);
      setBuilds((m) => {
        const next = new Map(m);
        next.delete(payoutBuildKey(coach, ym));
        return next;
      });
      setLineStates({});
      setNotes("");
      setStatus("draft");
      setDirty(false);
      setFlash("Saved review discarded.");
    } catch (e) {
      setFlash(`Discard failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (coach == null || !ym) return;
    const rows = lines.map((l) => {
      const s = stateFor(l.clientId);
      return [
        l.clientName,
        l.tier,
        l.billed,
        l.invoiceDay ?? "",
        l.recognizedThis,
        l.rolloverPrev,
        fmtPct(l.splitPct),
        l.payout,
        s.included ? "yes" : "no",
        s.override != null ? s.override : "",
        effectiveLinePayout(l.payout, s),
        s.note ?? "",
      ];
    });
    rows.push(["TOTAL", "", "", "", "", "", "", summary.computedTotal, "", "", summary.builtTotal, ""]);
    downloadCsv(
      `payout-build-${data?.coachName(coach).replace(/\s+/g, "-").toLowerCase() ?? coach}-${ym}`,
      ["Mentee", "Tier", "Billed (this mo)", "Inv. day", "This-mo slice", "Rolled-in", "Split", "Engine payout", "Included", "Override", "Effective payout", "Note"],
      rows
    );
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="notice notice--warn">Failed to load payment data: {error}</div>;

  const noInvoices = !data || data.invoices.length === 0;
  const coachMonths = coach != null ? monthsByCoach.get(coach) ?? [] : [];
  const projection = !!ym && ym >= currentYm();

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Build payout <HelpButton id="pay.build" label="Build payout" />
              <SectionId id="build.screen" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              A deliberate human checkpoint over the automated engine: pick a mentor and a month, confirm or drop each
              line (override an amount if you must, with a note), and sign off the payout you've personally checked. The
              engine numbers never change — this records your review.
            </div>
          </div>
          {onBack && (
            <button className="btn btn--sm" onClick={onBack} title="Back to the Pay staff overview">
              ← Pay staff
            </button>
          )}
        </div>

        {noInvoices && (
          <p className="muted" style={{ marginTop: 8 }}>
            No invoice data yet. Apply migration <code>9993_ca_invoices.sql</code> in the Supabase SQL Editor, then run a
            sync (Admin → Sync now). The builder lights up once invoices are mirrored.
          </p>
        )}

        {!noInvoices && (
          <div className="filter-bar" style={{ padding: "12px 0 0", borderBottom: "none" }}>
            <label className="filter">
              <span>Mentor</span>
              <select
                value={coach ?? ""}
                onChange={(e) => {
                  setCoach(e.target.value ? Number(e.target.value) : null);
                  setFlash(null);
                }}
              >
                {coachOptions.map(([id, name]) => (
                  <option key={id} value={String(id)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter">
              <span>Service month</span>
              <select
                value={ym}
                onChange={(e) => {
                  setYm(e.target.value);
                  setFlash(null);
                }}
                disabled={!coachMonths.length}
              >
                {coachMonths.map((m) => {
                  const rec = coach != null ? builds.get(payoutBuildKey(coach, m)) : undefined;
                  return (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                      {rec ? (rec.status === "approved" ? " — approved ✓" : " — draft") : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        )}
      </section>

      {!noInvoices && coach != null && ym && (
        <div className="builder">
          <section className="card">
            <div className="card__head">
              <div>
                <h2 style={{ fontSize: 15 }}>
                  {mentor?.coachName ?? data?.coachName(coach)} · {monthLabel(ym)}
                  <SectionId id="build.review" />
                  {projection && <span className="pill pill--running" style={{ marginLeft: 8 }}>projection</span>}
                  {locked && <span className="pill pill--success" style={{ marginLeft: 8 }}>approved</span>}
                  {dirty && <span className="pill pill--running" style={{ marginLeft: 8 }}>unsaved</span>}
                </h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {mentor ? (
                    <>
                      Tenure month {mentor.tenureMonth ?? "—"} · split {fmtPct(mentor.splitPct)} · {lines.length} line
                      {lines.length === 1 ? "" : "s"}
                    </>
                  ) : (
                    "No engine-computed lines for this coach in this month."
                  )}
                </div>
              </div>
              <button className="btn btn--sm" onClick={exportCsv} disabled={!lines.length}>
                Export CSV
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="muted">
                {mentor?.coachName ?? "This coach"} has no payout lines for {monthLabel(ym)}. Pick another month.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>✓</th>
                      <th style={{ textAlign: "left" }}>Mentee</th>
                      <th>Tier</th>
                      <th>Billed</th>
                      <th>Earned</th>
                      <th>Split</th>
                      <th>Engine</th>
                      <th>Override</th>
                      <th>Effective</th>
                      <th style={{ textAlign: "left" }}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const s = stateFor(l.clientId);
                      const eff = effectiveLinePayout(l.payout, s);
                      return (
                        <tr key={l.clientId} className={s.included ? "" : "builder__row--excluded"}>
                          <td>
                            <input
                              type="checkbox"
                              checked={s.included}
                              disabled={locked}
                              onChange={(e) => updateLine(l.clientId, { included: e.target.checked })}
                              aria-label={`Include ${l.clientName}`}
                            />
                          </td>
                          <td style={{ textAlign: "left" }}>{l.clientName}</td>
                          <td>{l.tier}</td>
                          <td className="num" title={l.invoiceDay != null ? `invoice day ${l.invoiceDay}` : "rollover only"}>
                            {fmtUsd(l.billed)}
                          </td>
                          <td className="num" title={`this-mo ${fmtUsd(l.recognizedThis)} + rolled-in ${fmtUsd(l.rolloverPrev)}`}>
                            {fmtUsd(l.earned)}
                          </td>
                          <td className="num">{fmtPct(l.splitPct)}</td>
                          <td className="num">{fmtUsd(l.payout)}</td>
                          <td className="num">
                            <input
                              className="input--inline"
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={l.payout.toFixed(2)}
                              value={s.override == null ? "" : String(s.override)}
                              disabled={locked || !s.included}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                const n = Number(v);
                                updateLine(l.clientId, { override: v === "" || !Number.isFinite(n) ? null : n });
                              }}
                              aria-label={`Override payout for ${l.clientName}`}
                            />
                          </td>
                          <td className="num" style={{ fontWeight: 600, color: s.override != null ? "var(--accent)" : undefined }}>
                            {fmtUsd(eff)}
                          </td>
                          <td style={{ textAlign: "left" }}>
                            <input
                              className="input--inline input--note"
                              type="text"
                              placeholder="reason…"
                              value={s.note ?? ""}
                              disabled={locked}
                              onChange={(e) => updateLine(l.clientId, { note: e.target.value || null })}
                              aria-label={`Note for ${l.clientName}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>
                        Totals
                      </td>
                      <td className="num">{fmtUsd(summary.computedTotal)}</td>
                      <td className="num muted">{summary.overriddenCount ? `${summary.overriddenCount} ovr` : ""}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {fmtUsd(summary.builtTotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {unassigned.length > 0 && (
              <p className="notice notice--info" style={{ fontSize: 13 }}>
                Heads up — {fmtUsd(unassigned.reduce((s, u) => s + u.billed, 0))} billed in {monthLabel(ym)} across{" "}
                {unassigned.length} mentee{unassigned.length === 1 ? "" : "s"} isn't attributed to any coach (no
                overlapping engagement), so it's in no one's payout. Review it in <strong>Pay staff → Explore source
                data</strong>.
              </p>
            )}
          </section>

          <aside className="builder__side">
            <div className="card">
              <div className="muted" style={{ fontSize: 12 }}>Built payout (signed-off)</div>
              <div className="builder__total">{fmtUsd(summary.builtTotal)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Engine computed: <strong>{fmtUsd(summary.computedTotal)}</strong>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Review delta:{" "}
                <strong style={{ color: summary.delta === 0 ? undefined : "var(--accent)" }}>{fmtSigned(summary.delta)}</strong>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {summary.includedCount} of {summary.lineCount} line{summary.lineCount === 1 ? "" : "s"} included
                {summary.excludedCount ? ` · ${summary.excludedCount} dropped` : ""}
                {summary.overriddenCount ? ` · ${summary.overriddenCount} overridden` : ""}
              </div>
            </div>

            <div className="card">
              <label className="filter" style={{ width: "100%" }}>
                <span>Review note (whole month)</span>
                <textarea
                  rows={3}
                  value={notes}
                  disabled={locked}
                  placeholder="Anything worth recording about this payout…"
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                  style={{ resize: "vertical", width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)", padding: "6px 8px", fontSize: 13 }}
                />
              </label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {!locked ? (
                  <>
                    <button className="btn btn--sm" onClick={() => persist("draft")} disabled={busy || !lines.length}>
                      Save draft
                    </button>
                    <button className="btn btn--sm btn--primary" onClick={() => persist("approved")} disabled={busy || !lines.length}>
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
                  Last saved {fmtDateTime(savedRec.reviewedAt)} · status{" "}
                  {savedRec.status}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
