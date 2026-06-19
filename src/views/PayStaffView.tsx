import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchPayData, computePayReport, PAY_RAMP, type PayData, type PayReport } from "../db";
import { downloadCsv } from "../csv";

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

type CardView = "graph" | "table" | "both";

// Graph + table side by side (north star), with a per-card toggle and CSV export.
function PayCard({
  title,
  children,
  table,
}: {
  title: string;
  children: ReactElement;
  table: { columns: string[]; rows: (string | number)[][] };
}) {
  const [view, setView] = useState<CardView>("both");
  const showGraph = view !== "table";
  const showTable = view !== "graph";
  return (
    <section className="card">
      <div className="card__head">
        <h2>{title}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn--sm" onClick={() => downloadCsv(title, table.columns, table.rows)}>
            Export CSV
          </button>
          <div className="seg" role="tablist" aria-label="Card view">
            {(["graph", "table", "both"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={view === k}
                className={`seg__btn ${view === k ? "seg__btn--active" : ""}`}
                onClick={() => setView(k)}
              >
                {k === "graph" ? "Graph" : k === "table" ? "Table" : "Both"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`chart-card__split ${showGraph && showTable ? "chart-card__split--both" : ""}`}>
        {showGraph && (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        )}
        {showTable && (
          <div className="table-scroll" style={{ width: "100%" }}>
            <table className="table table--center">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={typeof cell === "number" ? "num" : ""}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {table.rows.length === 0 && (
                  <tr>
                    <td colSpan={table.columns.length} className="muted">
                      No rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
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

// One mentor's payout breakdown: header line + a per-mentee table.
function MentorCard({ mentor }: { mentor: PayReport["mentors"][number] }) {
  const cols = ["Mentee", "Tier", "Collected", "Active days", "Proration", "Split", "Payout"];
  const rows = mentor.lines.map((l) => [
    l.clientName,
    l.tier,
    fmtUsd(l.collected),
    `${l.activeDays}/${l.daysInMonth}`,
    fmtPct(l.proration),
    fmtPct(l.splitPct),
    fmtUsd(l.payout),
  ]);
  return (
    <section className="card">
      <div className="card__head">
        <h2 style={{ fontSize: 17 }}>{mentor.coachName}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="pill">
            Split {fmtPct(mentor.splitPct)}
            {mentor.tenureMonth != null ? ` · mo ${mentor.tenureMonth}` : ""}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {mentor.menteeCount} mentee{mentor.menteeCount === 1 ? "" : "s"} · collected {fmtUsd(mentor.collected)}
          </span>
          <strong style={{ fontSize: 16 }}>{fmtUsd(mentor.payout)}</strong>
          <button
            className="btn btn--sm"
            onClick={() => downloadCsv(`payout-${mentor.coachName}-${mentor.startMonth ?? ""}`, cols, rows)}
          >
            Export CSV
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="table table--center">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
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
  const [ym, setYm] = useState<string>("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchPayData()
      .then((d) => {
        if (!live) return;
        setData(d);
        // Default to the newest service month that isn't the current month, else
        // the newest available.
        const cur = currentYm();
        const past = d.months.filter((m) => m < cur);
        setYm(past[0] ?? d.months[0] ?? "");
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const report: PayReport | null = useMemo(() => {
    if (!data || !ym) return null;
    return computePayReport({
      ym,
      invoices: data.invoices,
      engagements: data.engagements,
      coachName: data.coachName,
      clientName: data.clientName,
    });
  }, [data, ym]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="notice notice--warn">Failed to load payment data: {error}</div>;

  const noInvoices = !data || data.invoices.length === 0;

  const mentorTable = report
    ? {
        columns: ["Mentor", "Tenure mo", "Split", "Mentees", "Collected", "Earned", "Payout"],
        rows: report.mentors.map((m) => [
          m.coachName,
          m.tenureMonth ?? "—",
          fmtPct(m.splitPct),
          m.menteeCount,
          fmtUsd(m.collected),
          fmtUsd(m.earned),
          fmtUsd(m.payout),
        ] as (string | number)[]),
      }
    : { columns: [], rows: [] };

  const chartData = report ? report.mentors.map((m) => ({ name: m.coachName, payout: m.payout })) : [];

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2>Pay staff</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Mentors earn a ramped share ({PAY_RAMP.map((p) => `${Math.round(p * 100)}%`).join(" → ")} by tenure month)
              of revenue <strong>collected</strong> from each mentee, credited to the invoice's <strong>service
              month</strong> and prorated by active days.
            </div>
          </div>
          {data && data.months.length > 0 && (
            <label className="year-select">
              <span>Service month</span>
              <select value={ym} onChange={(e) => setYm(e.target.value)}>
                {data.months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {noInvoices && (
          <p className="muted" style={{ marginTop: 8 }}>
            No invoice data yet. Apply migration <code>9993_ca_invoices.sql</code> in the Supabase SQL Editor, then run a
            sync (Admin → Sync now). Payouts are computed from collected invoice revenue, so this stays empty until
            invoices are mirrored.
          </p>
        )}
        {!noInvoices && ym >= currentYm() && (
          <p className="muted" style={{ marginTop: 8 }}>
            ⚠ {monthLabel(ym)} is the current/future month — proration counts engagement days through month-end, so
            figures are projections until the month closes.
          </p>
        )}
      </section>

      {report && !noInvoices && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatTile label="Total payout" value={fmtUsd(report.totals.payout)} sub={`${monthLabel(ym)}`} />
            <StatTile label="Revenue collected" value={fmtUsd(report.totals.collected)} sub="across all mentees" />
            <StatTile label="Mentors paid" value={String(report.totals.mentorCount)} />
            <StatTile label="Paying mentees" value={String(report.totals.menteeCount)} />
          </div>

          <PayCard title={`Payout by mentor — ${monthLabel(ym)}`} table={mentorTable}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={AXIS} tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis stroke={AXIS} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP} formatter={(v) => fmtUsd(Number(v))} />
              <Bar dataKey="payout" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </PayCard>

          {report.unassigned.length > 0 && (
            <section className="card">
              <div className="card__head">
                <h2 style={{ fontSize: 16 }}>Unassigned revenue</h2>
                <span className="muted" style={{ fontSize: 13 }}>
                  Collected revenue with no engagement active in {monthLabel(ym)} — can't attribute to a mentor.
                </span>
              </div>
              <div className="table-scroll">
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th>Mentee</th>
                      <th>Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.unassigned.map((u) => (
                      <tr key={u.clientId}>
                        <td>{u.clientName}</td>
                        <td>{fmtUsd(u.collected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <h2 style={{ margin: "8px 4px 0" }}>Per-mentor breakdown</h2>
          {report.mentors.length === 0 && <p className="muted">No payouts for {monthLabel(ym)}.</p>}
          {report.mentors.map((m) => (
            <MentorCard key={m.coachId} mentor={m} />
          ))}
        </>
      )}
    </div>
  );
}
