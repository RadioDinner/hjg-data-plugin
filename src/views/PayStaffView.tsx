import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchPayData, computePayTimeline, PAY_RAMP, type PayData, type PayTimeline, type PayMonth } from "../db";
import { downloadCsv } from "../csv";
import { PayExploreModal } from "../components/PayExploreModal";
import { BuildPayoutView } from "./BuildPayoutView";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";
import { useChartTokens } from "../theme";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n);
const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${SHORT[m - 1]} ${y}`;
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// 'YYYY-MM' -> the following month, for the rollover-tail lookup.
function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const o = y * 12 + (m - 1) + 1;
  return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 150 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// The per-mentor breakdown revealed when a month row is expanded: one row per
// mentor that month, the unassigned bucket if any, and a jump into the explorer
// pre-filtered to this month.
function MonthDetail({ month, onExplore, onBuild }: { month: PayMonth; onExplore: () => void; onBuild: (coachId: number, ym: string) => void }) {
  const r = month.report;
  if (r.mentors.length === 0 && r.unassigned.length === 0) {
    return <p className="muted" style={{ margin: "4px 0" }}>No payouts for {monthLabel(month.ym)}.</p>;
  }
  return (
    <div className="month-detail">
      <div className="table-toolbar">
        <span className="muted" style={{ fontSize: 13 }}>
          {r.mentors.length} mentor{r.mentors.length === 1 ? "" : "s"} · {r.totals.menteeCount} paying mentee
          {r.totals.menteeCount === 1 ? "" : "s"}
        </span>
        <button className="btn btn--sm" onClick={onExplore} title="Open the source-data explorer for this month">
          Explore this month →
        </button>
      </div>
      <div className="table-scroll">
        <table className="table table--center">
          <thead>
            <tr>
              <th>Mentor</th>
              <th>Tenure mo</th>
              <th>Split</th>
              <th>Mentees</th>
              <th>Billed</th>
              <th>Earned</th>
              <th>Payout</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {r.mentors.map((m) => (
              <tr key={m.coachId}>
                <td>{m.coachName}</td>
                <td className="num">{m.tenureMonth ?? "—"}</td>
                <td className="num">{fmtPct(m.splitPct)}</td>
                <td className="num">{m.menteeCount}</td>
                <td className="num">{fmtUsd(m.billed)}</td>
                <td className="num">{fmtUsd(m.earned)}</td>
                <td className="num">{fmtUsd(m.payout)}</td>
                <td className="num">
                  <button
                    className="btn btn--sm"
                    onClick={() => onBuild(m.coachId, month.ym)}
                    title={`Review & sign off ${m.coachName}'s payout for ${monthLabel(month.ym)}`}
                  >
                    Build →
                  </button>
                </td>
              </tr>
            ))}
            {r.unassigned.length > 0 && (
              <tr className="row--muted">
                <td>Unassigned ({r.unassigned.length})</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">{r.unassigned.length}</td>
                <td className="num">{fmtUsd(r.unassigned.reduce((s, u) => s + u.billed, 0))}</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Per-mentor payout reconciliation: pick a mentor + a target month, and see that
// month's payout, the RUNNING TOTAL paid through that month, the REMAINING tail
// still owed on invoices already billed (the elapsed slices that roll past the
// target month), and their sum — the accuracy check the user asked for. Built
// entirely from the timeline ledger (Clayton two-month split, per-mentor ramp,
// JYF already excluded), so it always agrees with the Payout-by-month table.
function MentorReconcile({ timeline, cur, ct }: { timeline: PayTimeline; cur: string; ct: ReturnType<typeof useChartTokens> }) {
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const TOOLTIP = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText } as const;

  const mentors = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of timeline.ledger) if (r.assigned && r.coachId != null) m.set(r.coachId, r.coachName);
    return [...m.entries()].map(([coachId, name]) => ({ coachId, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [timeline]);

  const [coachSel, setCoachSel] = useState<number | null>(null);
  const coachId = coachSel != null && mentors.some((m) => m.coachId === coachSel) ? coachSel : mentors[0]?.coachId ?? null;

  const coachRows = useMemo(
    () => timeline.ledger.filter((r) => r.assigned && r.coachId === coachId),
    [timeline, coachId]
  );
  // Months (ascending) in which this mentor has a payout.
  const coachMonths = useMemo(
    () => [...new Set(coachRows.map((r) => r.ym))].sort((a, b) => a.localeCompare(b)),
    [coachRows]
  );

  const [monthSel, setMonthSel] = useState<string | null>(null);
  const defaultMonth = useMemo(
    () => [...coachMonths].reverse().find((m) => m <= cur) ?? coachMonths[coachMonths.length - 1] ?? null,
    [coachMonths, cur]
  );
  const month = monthSel && coachMonths.includes(monthSel) ? monthSel : defaultMonth;
  const nxt = month ? nextYm(month) : null;

  // Per-mentee: this-month payout, paid-to-date, and remaining tail. Each figure is
  // rounded per mentee here so the tiles + Total row (summed from these) always foot
  // with the cells shown.
  const perMentee = useMemo(() => {
    const map = new Map<number, { name: string; tier: string; thisMonth: number; paid: number; remaining: number }>();
    const ensure = (id: number, name: string) => {
      let e = map.get(id);
      if (!e) { e = { name, tier: "", thisMonth: 0, paid: 0, remaining: 0 }; map.set(id, e); }
      return e;
    };
    for (const r of coachRows) {
      if (r.tier && r.tier !== "other") {
        const e = ensure(r.clientId, r.clientName);
        if (!e.tier) e.tier = r.tier;
      }
      if (month != null && r.ym <= month) {
        const e = ensure(r.clientId, r.clientName);
        e.paid = round2(e.paid + r.payout);
        if (r.ym === month) e.thisMonth = round2(e.thisMonth + r.payout);
      }
      if (r.ym === nxt) {
        const e = ensure(r.clientId, r.clientName);
        e.remaining = round2(e.remaining + r.rolloverPrev * r.splitPct);
      }
    }
    return [...map.values()].sort((a, b) => b.paid - a.paid);
  }, [coachRows, month, nxt]);

  // The reconciliation tiles = the sums of the per-mentee cells above, so the tiles,
  // the Total row, and the visible cells always agree to the penny. running = paid
  // through the target month; remaining = the tail still owed on already-billed
  // invoices (next month's rollover slices at next month's rate); total = both.
  const recon = useMemo(() => {
    const thisMonth = round2(perMentee.reduce((s, p) => s + p.thisMonth, 0));
    const running = round2(perMentee.reduce((s, p) => s + p.paid, 0));
    const remaining = round2(perMentee.reduce((s, p) => s + p.remaining, 0));
    return { thisMonth, running, remaining, total: round2(running + remaining) };
  }, [perMentee]);

  // Monthly payout + a cumulative running-total line, oldest -> newest.
  const chartData = useMemo(() => {
    let cum = 0;
    return coachMonths.map((ym) => {
      const payout = round2(coachRows.filter((r) => r.ym === ym).reduce((s, r) => s + r.payout, 0));
      cum = round2(cum + payout);
      return { ym, month: monthLabel(ym), payout, cumulative: cum };
    });
  }, [coachMonths, coachRows]);

  const mentorName = mentors.find((m) => m.coachId === coachId)?.name ?? "—";

  const exportCsv = () => {
    if (!month) return;
    downloadCsv(
      `payout-reconcile-${mentorName.replace(/\s+/g, "-")}-${month}`,
      ["Mentee", "Tier", `Payout ${monthLabel(month)}`, "Paid through month", "Remaining (billed, unpaid)"],
      perMentee.map((p) => [p.name, p.tier || "—", p.thisMonth, p.paid, p.remaining])
    );
  };

  if (mentors.length === 0) return null;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Mentor payout reconciliation <SectionId id="pay.reconcile" />
            <HelpButton id="pay.reconcile" label="Reconciliation" />
          </h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Pick a mentor and a month to see that month's payout, the <strong>running total</strong> paid through it, and
            the <strong>remaining</strong> tail still owed on invoices already billed. Running total + remaining = the
            full value billed through that month — the accuracy check.
          </div>
        </div>
        <button className="btn btn--sm" onClick={exportCsv} disabled={!month}>Export CSV</button>
      </div>

      <div className="table-toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span className="muted">Mentor</span>
          <select value={coachId ?? ""} onChange={(e) => { setCoachSel(Number(e.target.value)); setMonthSel(null); }}>
            {mentors.map((m) => (
              <option key={m.coachId} value={m.coachId}>{m.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span className="muted">Through month</span>
          <select value={month ?? ""} onChange={(e) => setMonthSel(e.target.value)}>
            {[...coachMonths].reverse().map((ym) => (
              <option key={ym} value={ym}>{monthLabel(ym)}{ym > cur ? " (projection)" : ""}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        <StatTile label={month ? `Payout — ${monthLabel(month)}` : "Payout"} value={fmtUsd(recon.thisMonth)} sub="this month only" />
        <StatTile label="Paid through this month" value={fmtUsd(recon.running)} sub="running total, all months so far" />
        <StatTile label="Remaining (billed, unpaid)" value={fmtUsd(recon.remaining)} sub="rollover tail of billed invoices" />
        <StatTile label="Total billed through month" value={fmtUsd(recon.total)} sub="paid + remaining" />
      </div>

      <p className="view__hint" style={{ marginTop: 10, marginBottom: 4 }}>
        {mentorName}: <strong>{fmtUsd(recon.running)}</strong> paid through {month ? monthLabel(month) : "—"} +{" "}
        <strong>{fmtUsd(recon.remaining)}</strong> remaining = <strong>{fmtUsd(recon.total)}</strong> billed to date.
      </p>

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="month" stroke={AXIS} tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis stroke={AXIS} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [fmtUsd(Number(v)), n === "cumulative" ? "Running total" : "Monthly payout"]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar name="Monthly payout" dataKey="payout" radius={[4, 4, 0, 0]}>
              {chartData.map((d) => (
                <Cell key={d.ym} fill={d.ym === month ? ct.accent : "#94a3b8"} />
              ))}
            </Bar>
            <Line name="Running total" type="monotone" dataKey="cumulative" stroke={ct.accent} strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="table-scroll" style={{ marginTop: 8 }}>
        <table className="table table--center">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Mentee</th>
              <th>Tier</th>
              <th>Payout {month ? monthLabel(month) : ""}</th>
              <th>Paid through month</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {perMentee.map((p) => (
              <tr key={p.name}>
                <td style={{ textAlign: "left" }}>{p.name}</td>
                <td>{p.tier || "—"}</td>
                <td className="num">{fmtUsd(p.thisMonth)}</td>
                <td className="num">{fmtUsd(p.paid)}</td>
                <td className="num">{fmtUsd(p.remaining)}</td>
              </tr>
            ))}
            {perMentee.length > 0 && (
              <tr className="row--muted" style={{ fontWeight: 700 }}>
                <td style={{ textAlign: "left" }}>Total</td>
                <td>—</td>
                <td className="num">{fmtUsd(recon.thisMonth)}</td>
                <td className="num">{fmtUsd(recon.running)}</td>
                <td className="num">{fmtUsd(recon.remaining)}</td>
              </tr>
            )}
            {perMentee.length === 0 && (
              <tr><td colSpan={5} className="muted">No mentoring payouts for this mentor.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PayStaffView() {
  const [data, setData] = useState<PayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [explore, setExplore] = useState<{ initialMonth?: string } | null>(null);
  // Build payout is hosted INSIDE this tab (no separate top-nav tab). null = the
  // overview; an object = the builder, optionally pre-scoped to a mentor+month.
  const [build, setBuild] = useState<{ coachId: number | null; ym: string } | null>(null);
  const ct = useChartTokens();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const TOOLTIP = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText } as const;

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchPayData()
      .then((d) => {
        if (!live) return;
        setData(d);
        // Expand the newest closed (past) month by default, else the newest.
        const cur = currentYm();
        const firstPast = d.months.find((m) => m < cur);
        const open = firstPast ?? d.months[0];
        setExpanded(open ? new Set([open]) : new Set());
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const timeline: PayTimeline | null = useMemo(() => {
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
    });
  }, [data]);

  // Payout by month, oldest -> newest so the time axis reads left to right.
  const chartData = useMemo(() => {
    if (!timeline) return [];
    return [...timeline.months].reverse().map((m) => ({
      month: monthLabel(m.ym),
      billed: m.report.totals.billed,
      payout: m.report.totals.payout,
    }));
  }, [timeline]);

  // Build payout is a sub-mode of this tab: render the builder full-screen here,
  // scoped to the clicked mentor+month, with a Back to return to the overview.
  if (build) {
    return (
      <div className="stack">
        <BuildPayoutView onBack={() => setBuild(null)} initialCoachId={build.coachId} initialYm={build.ym} />
      </div>
    );
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="notice notice--warn">Failed to load payment data: {error}</div>;

  const noInvoices = !data || data.invoices.length === 0;
  const cur = currentYm();

  function toggle(ym: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(ym)) next.delete(ym);
      else next.add(ym);
      return next;
    });
  }

  const monthlyCsv = () => {
    if (!timeline) return;
    downloadCsv(
      "payout-by-month",
      ["Month", "Total payout", "Revenue billed", "Collected so far", "Mentors paid", "Paying mentees"],
      timeline.months.map((m) => [
        monthLabel(m.ym),
        m.report.totals.payout,
        m.report.totals.billed,
        m.report.totals.collected,
        m.report.totals.mentorCount,
        m.report.totals.menteeCount,
      ])
    );
  };

  const distinctMentors = timeline ? new Set(timeline.ledger.filter((r) => r.assigned).map((r) => r.coachId)).size : 0;

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Pay staff <HelpButton id="pay.payout" label="Pay staff" />
              <HelpButton id="general.coachAttribution" label="How coaches are matched" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Mentors earn a ramped share (default {PAY_RAMP.map((p) => `${Math.round(p * 100)}%`).join(" → ")} by
              mentor-tenure month; a fast-tracked mentor can have a custom ramp) of the{" "}
              <strong>4×/2×/1× mentoring</strong> revenue <strong>billed</strong> to each mentee. JumpStart/JYF and other
              non-mentoring revenue is <strong>excluded</strong>. Each invoice's share is{" "}
              <strong>split across two months</strong> by its invoice date (fixed 30-day): the remaining part pays in the
              invoice's month, the elapsed part rolls into the next. (Collected is shown alongside for reference.)
            </div>
          </div>
          {!noInvoices && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn--sm btn--primary"
                onClick={() => setBuild({ coachId: null, ym: "" })}
                title="Review and sign off a mentor's payout line by line"
              >
                Build payout →
              </button>
              <button className="btn btn--sm" onClick={() => setExplore({})} title="Browse the data behind every number">
                Explore source data
              </button>
            </div>
          )}
        </div>

        {noInvoices && (
          <p className="muted" style={{ marginTop: 8 }}>
            No invoice data yet. Apply migration <code>9993_ca_invoices.sql</code> in the Supabase SQL Editor, then run a
            sync (Admin → Sync now). Payouts are computed from billed invoice revenue, so this stays empty until
            invoices are mirrored.
          </p>
        )}
      </section>

      {timeline && !noInvoices && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatTile label="Total payout" value={fmtUsd(timeline.totals.payout)} sub={`${timeline.months.length} months`} />
            <StatTile label="Revenue billed" value={fmtUsd(timeline.totals.billed)} sub="pay basis, all months" />
            <StatTile label="Collected so far" value={fmtUsd(timeline.totals.collected)} sub="reference" />
            <StatTile label="Months covered" value={String(timeline.months.length)} />
            <StatTile label="Mentors paid" value={String(distinctMentors)} sub="distinct, all-time" />
            <StatTile label="Excluded from pay" value={fmtUsd(timeline.totals.excludedBilled)} sub="JumpStart/JYF + non-mentoring" />
          </div>

          <MentorReconcile timeline={timeline} cur={cur} ct={ct} />

          <section className="card">
            <div className="card__head">
              <h2>Payout by month <SectionId id="pay.payoutByMonth" /></h2>
              <button className="btn btn--sm" onClick={monthlyCsv} disabled={timeline.months.length === 0}>
                Export CSV
              </button>
            </div>

            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="month" stroke={AXIS} tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke={AXIS} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP} formatter={(v) => fmtUsd(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar name="Billed" dataKey="billed" fill="#334155" radius={[4, 4, 0, 0]} />
                  <Bar name="Payout" dataKey="payout" fill={ct.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <p className="view__hint" style={{ marginBottom: 4 }}>
              Click a month to expand its per-mentor breakdown. Each month blends the current invoices' slices with
              slices rolled forward from the prior month; months at or after {monthLabel(cur)} update as new invoices
              sync.
            </p>
            <div className="table-scroll">
              <table className="table table--center">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Month</th>
                    <th>Total payout</th>
                    <th>Revenue billed</th>
                    <th>Mentors paid</th>
                    <th>Paying mentees</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.months.map((m) => {
                    const t = m.report.totals;
                    const isOpen = expanded.has(m.ym);
                    const projection = m.ym >= cur;
                    return (
                      <Fragment key={m.ym}>
                        <tr className="row--expandable" onClick={() => toggle(m.ym)}>
                          <td style={{ textAlign: "left", fontWeight: 600 }}>
                            <span className="row__chevron">{isOpen ? "▾" : "▸"}</span> {monthLabel(m.ym)}
                            {projection && <span className="pill pill--running" style={{ marginLeft: 8 }}>projection</span>}
                          </td>
                          <td className="num"><strong>{fmtUsd(t.payout)}</strong></td>
                          <td className="num">{fmtUsd(t.billed)}</td>
                          <td className="num">{t.mentorCount}</td>
                          <td className="num">{t.menteeCount}</td>
                        </tr>
                        {isOpen && (
                          <tr className="row--detail">
                            <td colSpan={5} style={{ textAlign: "left" }}>
                              <MonthDetail
                                month={m}
                                onExplore={() => setExplore({ initialMonth: m.ym })}
                                onBuild={(coachId, ym) => setBuild({ coachId, ym })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {timeline.months.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No months with collected revenue yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {explore && data && timeline && (
        <PayExploreModal
          ledger={timeline.ledger}
          invoices={data.invoices}
          engagements={data.engagements}
          coachName={data.coachName}
          clientName={data.clientName}
          months={data.months}
          initialMonth={explore.initialMonth}
          onClose={() => setExplore(null)}
        />
      )}
    </div>
  );
}
