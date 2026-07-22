import { useEffect, useMemo, useState } from "react";
import {
  fetchPayData,
  computePayReport,
  computePayTimeline,
  summarizeBuild,
  effectiveLineTotal,
  payoutAfterExclusions,
  buildPayStubModel,
  payStubHtml,
  DEFAULT_LINE_STATE,
  payoutDetailCsvRows,
  PAYOUT_DETAIL_CSV_COLUMNS,
  fetchPayoutBuilds,
  savePayoutBuild,
  deletePayoutBuild,
  setPayoutPaymentSent,
  savePaystub,
  payoutBuildKey,
  defaultServiceMonth,
  monthPayProgress,
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
import { PayoutLineDetailModal } from "../components/PayoutLineDetailModal";

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
  // Build-level Split % override (fraction; null = the engine's ramp split).
  const [splitOverride, setSplitOverride] = useState<number | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [status, setStatus] = useState<BuildStatus>("draft");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // The mentee line whose invoice/payment drill-down is open (click a name).
  const [detail, setDetail] = useState<PayMenteeLine | null>(null);
  // "Payment sent" dialog (§906): enter the Melio payment number as reference.
  const [payModal, setPayModal] = useState(false);
  const [payRef, setPayRef] = useState("");
  const [payErr, setPayErr] = useState<string | null>(null);

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
      rampOverride: data.rampOverride,
      payEligible: data.payEligible,
      payEligibleLineItem: data.payEligibleLineItem,
    });
  }, [data]);

  // Every coach with pay lines in the ledger…
  const allCoachOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of timeline?.ledger ?? []) if (r.assigned && r.coachId != null) m.set(r.coachId, r.coachName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [timeline]);
  // …filtered to the mentors ASSIGNED in Company options → Payment groups (§451)
  // when any are assigned. That grid is the source of truth for "whom to pay" —
  // it's how a departed mentor is retired from this list even though their
  // historical pay lines remain. No coaches assigned yet => legacy fallback (all).
  const mentorList = useMemo(() => {
    const assigned = data?.mentorCoachIds ?? [];
    if (!assigned.length) return allCoachOptions;
    const set = new Set(assigned);
    return allCoachOptions.filter(([id]) => set.has(id));
  }, [allCoachOptions, data]);
  // Keep a pre-scoped launch ("Build →" on a coach outside the group) usable:
  // the current selection always appears, labeled as outside the Mentors group.
  const coachOptions = useMemo<[number, string][]>(() => {
    if (coach == null || mentorList.some(([id]) => id === coach)) return mentorList;
    const extra = allCoachOptions.find(([id]) => id === coach);
    return extra ? [...mentorList, [extra[0], `${extra[1]} (not in Mentors group)`]] : mentorList;
  }, [mentorList, allCoachOptions, coach]);

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

  // Months already marked Payment sent (any mentor) — drive the default month.
  const paidMonths = useMemo(
    () => [...builds.values()].filter((b) => b.paymentSentAt).map((b) => b.serviceMonth),
    [builds]
  );

  // Keep the month valid for the chosen coach. On FIRST open (no month chosen
  // and none pre-scoped) default to the LAST PAID month — the newest month
  // marked Payment sent, else the month before today (so on 2026-07-22 with no
  // payments recorded the builder opens on June 2026) — clamped to the nearest
  // month this coach actually has lines in. More provisions can layer on later.
  useEffect(() => {
    if (coach == null) return;
    const months = monthsByCoach.get(coach) ?? [];
    if (!months.length) {
      setYm("");
      return;
    }
    if (!ym) {
      const want = defaultServiceMonth(currentYm(), paidMonths);
      setYm(months.find((m) => m <= want) ?? months[months.length - 1]); // months are newest-first
      return;
    }
    if (!months.includes(ym)) setYm(months[0]);
  }, [coach, monthsByCoach, ym, paidMonths]);

  const savedRec = coach != null && ym ? builds.get(payoutBuildKey(coach, ym)) : undefined;

  // Load the saved review (or reset to defaults) whenever the selection changes.
  useEffect(() => {
    if (coach == null || !ym) return;
    const rec = builds.get(payoutBuildKey(coach, ym));
    setLineStates(rec ? { ...rec.lineStates } : {});
    setSplitOverride(rec?.splitOverride ?? null);
    setNotes(rec?.notes ?? "");
    setStatus(rec?.status ?? "draft");
    setDirty(false);
    // Note: flash is intentionally NOT cleared here — this effect re-runs after a
    // save (builds changes), and we want the "saved" confirmation to survive.
  }, [coach, ym, builds]);

  // Engine report for the selected month, then this coach's lines. (Non-mentoring
  // revenue is excluded upstream and reported as report.excludedBilled; the legacy
  // "unassigned" bucket no longer populates since a mentoring tier always implies a
  // covering engagement with a coach.)
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
      rampOverride: data.rampOverride,
      payEligible: data.payEligible,
      payEligibleLineItem: data.payEligibleLineItem,
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

  // Pass the full lines (with sources + splitPct) so the summary honors per-invoice
  // exclusions + the split override; computedTotal still sums the raw engine payout
  // as the drift reference.
  const summary = useMemo(() => summarizeBuild(lines, stateMap, splitOverride), [lines, stateMap, splitOverride]);

  const locked = status === "approved";
  const paid = !!savedRec?.paymentSentAt;
  const stateFor = (clientId: number): BuildLineState => lineStates[clientId] ?? DEFAULT_LINE_STATE;

  // Per-month payment completion across the mentor group — the at-a-glance
  // "which months are done" strip. Counts only current/past months and only the
  // mentors in the (filtered) list.
  const progress = useMemo(() => {
    const mm: { coachId: number; ym: string }[] = [];
    for (const [id] of mentorList) for (const m of monthsByCoach.get(id) ?? []) mm.push({ coachId: id, ym: m });
    const cur = currentYm();
    return monthPayProgress(mm, (cid, m) => !!builds.get(payoutBuildKey(cid, m))?.paymentSentAt).filter((p) => p.ym < cur);
  }, [mentorList, monthsByCoach, builds]);

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
        splitOverride,
        notes: notes.trim() || null,
      });
      const rec: PayoutBuildRecord = {
        coachId: coach,
        serviceMonth: ym,
        status: nextStatus,
        builtTotal: summary.builtTotal,
        computedTotal: summary.computedTotal,
        lineStates,
        splitOverride,
        notes: notes.trim() || null,
        reviewedBy: user?.id ?? null,
        reviewedAt: new Date().toISOString(),
        // The upsert doesn't touch the payment columns, so a saved payment mark
        // survives a re-save — mirror that in the local record.
        paymentSentAt: savedRec?.paymentSentAt ?? null,
        paymentRef: savedRec?.paymentRef ?? null,
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

  // Record (or update the reference of) the actual payment for this approved
  // build; the Melio payment number is stored as the reference. Only the two
  // payment columns change — the signed-off review is untouched.
  async function markPaymentSent() {
    if (coach == null || !ym) return;
    setBusy(true);
    setPayErr(null);
    try {
      const sentAt = savedRec?.paymentSentAt ?? new Date().toISOString();
      const ref = payRef.trim() || null;
      await setPayoutPaymentSent(coach, ym, { sentAt, ref });
      setBuilds((m) => {
        const next = new Map(m);
        const rec = next.get(payoutBuildKey(coach, ym));
        if (rec) next.set(payoutBuildKey(coach, ym), { ...rec, paymentSentAt: sentAt, paymentRef: ref });
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
    if (coach == null || !ym || !paid) return;
    if (!confirm(`Clear the Payment-sent mark for ${mentor?.coachName ?? "this coach"} — ${monthLabel(ym)}?`)) return;
    setBusy(true);
    setPayErr(null);
    try {
      await setPayoutPaymentSent(coach, ym, null);
      setBuilds((m) => {
        const next = new Map(m);
        const rec = next.get(payoutBuildKey(coach, ym));
        if (rec) next.set(payoutBuildKey(coach, ym), { ...rec, paymentSentAt: null, paymentRef: null });
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

  // Export the DATA USED to build the payout — one row per contributing invoice
  // (this month's slice + the prior month's rolled-in slice), with the dates each
  // invoice was paid — not just the on-screen per-mentee summary. The TOTAL row's
  // "Engine payout"/"Effective payout" columns sum cleanly because those fields
  // are written only on each mentee's first invoice row (see payoutDetailCsvRows).
  // Open the printable pay stub in a new window (draft => "REVIEW COPY" with a
  // watermark; approved => the final stub). Uses the CURRENT on-screen review
  // state — if it's unsaved, the stub says so, so a mentor can't be handed a
  // stub that silently differs from the saved build.
  async function printStub() {
    if (coach == null || !ym || !mentor || !lines.length) return;
    const model = buildPayStubModel({
      coachName: mentor.coachName,
      ym,
      splitPct: mentor.splitPct,
      splitOverride,
      status,
      unsavedChanges: dirty,
      lines,
      states: stateMap,
      monthNote: notes.trim() || null,
      reviewedAt: savedRec?.reviewedAt ?? null,
      generatedOn: new Date().toISOString().slice(0, 10),
    });
    const w = window.open("", "_blank");
    if (!w) {
      setFlash("Popup blocked — allow popups for this site to print the pay stub.");
      return;
    }
    const html = payStubHtml(model);
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    // Archive the exact printed document to History (Pay staff -> History).
    try {
      await savePaystub(user?.id ?? "", {
        kind: "mentor",
        staffName: model.coachName,
        coachId: coach,
        periodMonth: ym,
        status,
        total: model.totals.payout,
        html,
      });
      setFlash(`${locked ? "Pay stub" : "Review stub"} printed + archived to History.`);
    } catch (e) {
      setFlash(`Stub printed, but archiving failed: ${String(e)} — apply migration 9970_staff_hourly_pay.sql`);
    }
  }

  function exportCsv() {
    if (coach == null || !ym) return;
    const rows = payoutDetailCsvRows(lines, stateMap, splitOverride);
    // TOTAL row aligned to the "Engine payout" + "Effective payout" columns of
    // PAYOUT_DETAIL_CSV_COLUMNS (found by label so it survives column reordering).
    const total: (string | number)[] = PAYOUT_DETAIL_CSV_COLUMNS.map((c) =>
      c === "Mentee" ? "TOTAL" : c === "Engine payout" ? summary.computedTotal : c === "Effective payout" ? summary.builtTotal : ""
    );
    rows.push(total);
    downloadCsv(
      `payout-build-${data?.coachName(coach).replace(/\s+/g, "-").toLowerCase() ?? coach}-${ym}`,
      [...PAYOUT_DETAIL_CSV_COLUMNS],
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
                      {rec ? (rec.paymentSentAt ? " — paid ✓" : rec.status === "approved" ? " — approved ✓" : " — draft") : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        )}

        {/* Which months are DONE: every mentor with lines that month marked
            Payment sent. Green ✓ = complete; N/M = partial. */}
        {!noInvoices && progress.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>Payments completed:</span>
            {progress.slice(0, 8).map((p) => (
              <span
                key={p.ym}
                className={`pill ${p.complete ? "pill--success" : ""}`}
                title={
                  p.complete
                    ? `${monthLabel(p.ym)} — every mentor's payout is marked Payment sent`
                    : `${monthLabel(p.ym)} — ${p.paid} of ${p.total} mentor payout${p.total === 1 ? "" : "s"} sent. Waiting on: ${p.unpaidCoachIds
                        .map((id) => data?.coachName(id) ?? `#${id}`)
                        .join(", ")}`
                }
              >
                {monthLabel(p.ym)} {p.complete ? "✓ paid" : `${p.paid}/${p.total}`}
              </span>
            ))}
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
                  {locked && (
                    <span className="pill pill--success" style={{ marginLeft: 8 }} title={paid && savedRec?.paymentRef ? `Melio ref ${savedRec.paymentRef}` : undefined}>
                      {paid ? "paid ✓" : "approved"}
                    </span>
                  )}
                  {dirty && <span className="pill pill--running" style={{ marginLeft: 8 }}>unsaved</span>}
                </h2>
                <div className="muted" style={{ fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {mentor ? (
                    <>
                      <span>Tenure month {mentor.tenureMonth ?? "—"} · split</span>
                      <input
                        className="input--inline"
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        style={{ width: 58 }}
                        placeholder={String(Math.round(mentor.splitPct * 100))}
                        value={splitOverride == null ? "" : String(Math.round(splitOverride * 100))}
                        disabled={locked}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          const n = Number(v);
                          setSplitOverride(v === "" || !Number.isFinite(n) ? null : Math.min(Math.max(n, 0), 100) / 100);
                          setDirty(true);
                          setFlash(null);
                        }}
                        title={`Override the Split % for this whole build (blank = the engine's ramp split, ${fmtPct(mentor.splitPct)}). Saves with the build; a per-line $ override still wins.`}
                        aria-label="Split % override for this build"
                      />
                      <span>%</span>
                      {splitOverride != null && splitOverride !== mentor.splitPct && (
                        <span className="pill pill--running" title={`Engine ramp split is ${fmtPct(mentor.splitPct)}`}>
                          engine {fmtPct(mentor.splitPct)}
                        </span>
                      )}
                      <span>
                        · {lines.length} line{lines.length === 1 ? "" : "s"} ·{" "}
                        <em>click a mentee to see the invoices + payment dates behind their number</em>
                      </span>
                    </>
                  ) : (
                    "No engine-computed lines for this coach in this month."
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn btn--sm ${locked && !paid ? "btn--primary" : ""}`}
                  onClick={printStub}
                  disabled={!lines.length}
                  title={
                    locked
                      ? paid
                        ? "This payout was already paid — reprint the approved pay stub (opens a print window)"
                        : "Print the approved pay stub for this month (opens a print window)"
                      : "Print a REVIEW-COPY pay stub of the current draft (watermarked; opens a print window)"
                  }
                >
                  {locked ? (paid ? "Reprint pay stub" : "Print pay stub") : "Print review stub"}
                </button>
                <button
                  className={`btn btn--sm ${locked && !paid ? "btn--primary" : ""}`}
                  onClick={() => {
                    setPayRef(savedRec?.paymentRef ?? "");
                    setPayErr(null);
                    setPayModal(true);
                  }}
                  disabled={!locked || !savedRec}
                  title={
                    !locked || !savedRec
                      ? "Approve (and save) the build first — Payment sent records that the approved payout was actually paid"
                      : paid
                      ? `Payment sent ${savedRec?.paymentSentAt ? fmtDateTime(savedRec.paymentSentAt) : ""}${savedRec?.paymentRef ? ` · Melio ref ${savedRec.paymentRef}` : ""} — click to edit the reference or clear the mark`
                      : "Record that this payout was paid, with the Melio payment number as reference"
                  }
                >
                  {paid ? "Payment sent ✓" : "Payment sent…"}
                </button>
                <button className="btn btn--sm" onClick={exportCsv} disabled={!lines.length}>
                  Export CSV
                </button>
              </div>
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
                      const eff = effectiveLineTotal(l, s, splitOverride);
                      const base = payoutAfterExclusions(l, s, splitOverride);
                      const affectedInv = new Set<string>();
                      (s.excludedInvoices ?? []).forEach((k) => affectedInv.add(k));
                      (s.excludedLineItems ?? []).forEach((k) => affectedInv.add(k.split("#")[0]));
                      (s.includedLineItems ?? []).forEach((k) => affectedInv.add(k.split("#")[0]));
                      const droppedInv = affectedInv.size;
                      // Engine-flagged judgment lines (credits/unmatched charges) —
                      // the hand-review targets for the first payout rounds.
                      const reviewLines = l.sources.reduce(
                        (t, src) => t + src.lineItems.filter((li) => li.status === "credit" || li.status === "excluded").length,
                        0
                      );
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
                          <td style={{ textAlign: "left" }}>
                            <button
                              className="linkbtn"
                              style={{ fontSize: "inherit", fontWeight: 500, textAlign: "left" }}
                              onClick={() => setDetail(l)}
                              title={`See the invoices + payment dates behind ${l.clientName}'s payout — and pick which invoices count`}
                            >
                              {l.clientName}
                            </button>
                            {droppedInv > 0 && (
                              <span
                                className="pill pill--running"
                                style={{ marginLeft: 6 }}
                                title={`${droppedInv} invoice${droppedInv === 1 ? "" : "s"} adjusted (whole invoice or line items flipped) — click the name to review`}
                              >
                                ±{droppedInv} inv
                              </span>
                            )}
                            {reviewLines > 0 && (
                              <span
                                className="pill"
                                style={{ marginLeft: 6 }}
                                title={`${reviewLines} line item${reviewLines === 1 ? "" : "s"} flagged for review (credits / unmatched charges) — click the name to inspect`}
                              >
                                review {reviewLines}
                              </span>
                            )}
                          </td>
                          <td>{l.tier}</td>
                          <td className="num" title={l.invoiceDay != null ? `invoice day ${l.invoiceDay}` : "rollover only"}>
                            {fmtUsd(l.billed)}
                          </td>
                          <td className="num" title={`this-mo ${fmtUsd(l.recognizedThis)} + rolled-in ${fmtUsd(l.rolloverPrev)}`}>
                            {fmtUsd(l.earned)}
                          </td>
                          <td className="num" style={{ color: splitOverride != null && splitOverride !== l.splitPct ? "var(--accent)" : undefined }}>{fmtPct(splitOverride ?? l.splitPct)}</td>
                          <td className="num">{fmtUsd(l.payout)}</td>
                          <td className="num">
                            <input
                              className="input--inline"
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder={base.toFixed(2)}
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
                {summary.invoiceAdjustedCount ? ` · ${summary.invoiceAdjustedCount} with invoices dropped` : ""}
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
              {paid && savedRec && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Payment sent {fmtDateTime(savedRec.paymentSentAt)}
                  {savedRec.paymentRef ? <> · Melio ref <strong>{savedRec.paymentRef}</strong></> : null}
                </div>
              )}
              {savedRec && !dirty && Math.abs(summary.builtTotal - savedRec.builtTotal) > 0.005 && (
                <div className="notice notice--warn" style={{ fontSize: 12, marginTop: 8 }}>
                  Heads up — the engine's numbers have <strong>changed since this build was saved</strong> (saved{" "}
                  {fmtUsd(savedRec.builtTotal)}, now {fmtUsd(summary.builtTotal)}). A re-sync or a Payment-groups change
                  can do this. Re-review and save{status === "approved" ? " (reopen first)" : ""} so the signed-off
                  number matches what's shown.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Payment sent — Melio reference dialog (§906). */}
      {payModal && coach != null && ym && (
        <div className="modal" onClick={() => setPayModal(false)}>
          <div className="modal__card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>
                Payment sent — {mentor?.coachName ?? data?.coachName(coach)} · {monthLabel(ym)} <SectionId id="modal.paymentSent" />
              </h2>
              <button className="btn btn--sm" onClick={() => setPayModal(false)}>
                Close
              </button>
            </div>
            <div className="modal__body" style={{ padding: "12px 20px 16px" }}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Records that this approved payout was actually paid ({fmtUsd(summary.builtTotal)}). Enter the{" "}
                <strong>Melio payment number</strong> as the reference so the payment is easy to trace later.
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
                  Already marked sent {fmtDateTime(savedRec.paymentSentAt)} — saving updates the reference.
                </p>
              )}
              {payErr && <div className="notice notice--warn" style={{ fontSize: 12 }}>{payErr}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn--sm btn--primary" onClick={markPaymentSent} disabled={busy}>
                  {paid ? "Save reference" : "Mark payment sent"}
                </button>
                {paid && (
                  <button className="btn btn--sm btn--danger" onClick={unmarkPaymentSent} disabled={busy}>
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

      {detail && coach != null && (
        <PayoutLineDetailModal
          line={detail}
          coachName={mentor?.coachName ?? data?.coachName(coach) ?? ""}
          ym={ym}
          state={stateFor(detail.clientId)}
          splitOverride={splitOverride}
          onChange={(patch) => updateLine(detail.clientId, patch)}
          readOnly={locked}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
