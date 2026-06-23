import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchPayData, computePayTimeline, PAY_RAMP, type PayData, type PayTimeline, type PayMonth } from "../db";
import { downloadCsv } from "../csv";
import { PayExploreModal } from "../components/PayExploreModal";
import { HelpButton } from "../components/HelpDrawer";

const AXIS = "#94a3b8";
const GRID = "#1e293b";
const TOOLTIP = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" };
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
function MonthDetail({ month, onExplore }: { month: PayMonth; onExplore: () => void }) {
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
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PayStaffView({ onBuildPayout }: { onBuildPayout?: () => void } = {}) {
  const [data, setData] = useState<PayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [explore, setExplore] = useState<{ initialMonth?: string } | null>(null);

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
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Mentors earn a ramped share ({PAY_RAMP.map((p) => `${Math.round(p * 100)}%`).join(" → ")} by mentor-tenure
              month) of revenue <strong>billed</strong> to each mentee. Each invoice's share is{" "}
              <strong>split across two months</strong> by its invoice date (fixed 30-day): the remaining part pays in the
              invoice's month, the elapsed part rolls into the next. (Collected is shown alongside for reference.)
            </div>
          </div>
          {!noInvoices && (
            <div style={{ display: "flex", gap: 8 }}>
              {onBuildPayout && (
                <button className="btn btn--sm btn--primary" onClick={onBuildPayout} title="Review and sign off a mentor's payout line by line">
                  Build payout →
                </button>
              )}
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
          </div>

          <section className="card">
            <div className="card__head">
              <h2>Payout by month</h2>
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
                  <Bar name="Payout" dataKey="payout" fill="#38bdf8" radius={[4, 4, 0, 0]} />
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
                              <MonthDetail month={m} onExplore={() => setExplore({ initialMonth: m.ym })} />
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
