import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartTokens } from "../theme";
import { HelpButton } from "../components/HelpDrawer";
import { CollapsibleCard } from "../components/Collapsible";
import { SortableTable, type SortColumn, type Row } from "../components/SortableTable";
import { downloadCsv } from "../csv";
import { fmtDate } from "../format";
import { todayYmd } from "../../lib/conversion";
import {
  fetchMentees,
  toEffectiveMentee,
  fetchMenteeMarginInputs,
  computeMenteeMargin,
  clampShare,
  DEFAULT_MENTOR_SHARE,
  type EffectiveMentee,
  type MenteeMarginData,
  type MenteeMarginReport,
} from "../db";

// Margins tab, rebuilt from scratch (session 020). The first lens is "Margins on
// Mentoring": pick ONE mentee and see, for their ongoing 4x / 2x / 1x mentoring,
// the invoices (issued / paid / scheduled), the meetings (occurred / upcoming /
// paid for) and HJG's margin PER MEETING — computed two ways so a prepaid month
// can't quietly inflate the number. Pure math: lib/margins.ts (verify §17).

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${SHORT[m - 1]} ${String(y).slice(2)}`;
}
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : usd2.format(n));
// Meeting counts are integers except "paid for" (prorated by partial payments).
const fmtCount = (n: number) =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
const pctLabel = (share: number) => `${Math.round(share * 100)}%`;

// The current instant as CA's account-local "YYYY-MM-DD HH:MM:SS" — the line
// between a meeting that has occurred and one still upcoming. Staff and the CA
// account share a timezone, so the browser clock stands in for the account clock.
function localNowRaw(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function Tile({ value, label, sub }: { value: ReactNode; label: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
      {sub != null && (
        <span className="muted" style={{ fontSize: 11 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <div
      className="muted"
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        margin: "14px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

export function MarginsView() {
  return (
    <div className="stack">
      <CollapsibleCard
        id="margins.screen"
        title="Margins"
        sectionId="margins.screen"
        help={<HelpButton id="margins.tab" label="Margins" />}
      >
        <div className="muted" style={{ fontSize: 13, marginTop: -2 }}>
          Several ways to look at HJG's margins, each in its own card. The first lens is{" "}
          <strong>Margins on Mentoring</strong>: what HJG keeps <em>per meeting</em> on one mentee's
          ongoing 4x / 2x / 1x mentoring, with the invoice and meeting counts that make the number
          trustworthy. More lenses will be added below it.
        </div>
      </CollapsibleCard>

      <MentoringMarginsCard />
    </div>
  );
}

function MentoringMarginsCard() {
  const ct = useChartTokens();
  const TOOLTIP = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 6,
    color: ct.tooltipText,
  } as const;

  // --- mentee picker ---
  const [mentees, setMentees] = useState<EffectiveMentee[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let live = true;
    const today = todayYmd();
    fetchMentees()
      .then((rows) => {
        if (!live) return;
        setMentees(rows.map((r) => toEffectiveMentee(r, today)));
        setListError(null);
      })
      .catch((e) => live && setListError(String(e)))
      .finally(() => live && setListLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? mentees.filter((m) => m.name.toLowerCase().includes(q)) : mentees;
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [mentees, search]);
  const selected = useMemo(
    () => mentees.find((m) => m.id === selectedId) ?? null,
    [mentees, selectedId],
  );
  const clientId = selected?.clientId ?? null;

  // --- the selected mentee's rows ---
  const [data, setData] = useState<MenteeMarginData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setDataError(null);
    if (clientId == null) return;
    let live = true;
    setDataLoading(true);
    fetchMenteeMarginInputs(clientId)
      .then((d) => live && setData(d))
      .catch((e) => live && setDataError(String(e)))
      .finally(() => live && setDataLoading(false));
    return () => {
      live = false;
    };
  }, [clientId]);

  // --- the split (mentor share; HJG keeps the rest) ---
  const [sharePct, setSharePct] = useState(String(Math.round(DEFAULT_MENTOR_SHARE * 100)));
  const mentorShare = clampShare(Number(sharePct) / 100);

  const [view, setView] = useState<"graph" | "table" | "both">("both");

  const report: MenteeMarginReport | null = useMemo(() => {
    if (!data) return null;
    return computeMenteeMargin({
      invoices: data.invoices,
      meetings: data.meetings,
      engagements: data.engagements,
      today: todayYmd(),
      now: localNowRaw(),
      mentorShare,
    });
  }, [data, mentorShare]);

  const chartData = useMemo(
    () =>
      (report?.byMonth ?? []).map((r) => ({
        month: monthLabel(r.month),
        "HJG share": r.hjgCollected,
        Occurred: r.meetingsOccurred,
        Upcoming: r.meetingsUpcoming,
        "Margin / meeting": r.marginPerMeeting,
      })),
    [report],
  );

  function exportMonths() {
    if (!report || !selected) return;
    downloadCsv(
      `margins-mentoring-${selected.name.replace(/\s+/g, "_")}`,
      [
        "Month",
        "Invoices issued",
        "Invoices paid",
        "Billed",
        "Collected",
        "HJG share",
        "Meetings occurred",
        "Meetings upcoming",
        "Margin per meeting",
      ],
      report.byMonth.map((r) => [
        r.month,
        r.invoicesIssued,
        r.invoicesPaid,
        r.billed,
        r.collected,
        r.hjgCollected,
        r.meetingsOccurred,
        r.meetingsUpcoming,
        r.marginPerMeeting ?? "",
      ]),
    );
  }

  const showGraph = view !== "table";
  const showTable = view !== "graph";

  return (
    <CollapsibleCard
      id="margins.mentoring"
      title="Margins on Mentoring"
      sectionId="margins.mentoring"
      help={<HelpButton id="margins.mentoring" label="Margins on Mentoring" />}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label className="muted" style={{ fontSize: 12, display: "flex", gap: 6 }}>
            Mentor share
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className="margins__pct-input"
              value={sharePct}
              onChange={(e) => setSharePct(e.target.value)}
              aria-label="Mentor share of collected revenue, percent"
            />
            %
          </label>
          <button className="btn btn--sm" onClick={exportMonths} disabled={!report}>
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
      }
    >
      <div className="muted" style={{ fontSize: 13, marginTop: -2 }}>
        Pick a mentee. HJG keeps <strong>{pctLabel(1 - mentorShare)}</strong> of what that mentee
        has paid (the mentor gets {pctLabel(mentorShare)}); the margin is that share{" "}
        <strong>per meeting</strong>. Only ongoing-mentoring (4x / 2x / 1x) invoices and meetings
        count — JumpStart, training and group engagements are listed but excluded.
      </div>

      {listError && <div className="notice notice--warn">Failed to load mentees: {listError}</div>}

      <div
        className="filter-bar"
        style={{ padding: "10px 0 12px", borderBottom: "1px solid var(--line)" }}
      >
        <label className="filter">
          <span>Search</span>
          <input
            type="text"
            value={search}
            placeholder="type a name…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="filter">
          <span>Mentee</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={listLoading}
          >
            <option value="">{listLoading ? "loading…" : "— pick a mentee —"}</option>
            {filtered.map((m) => (
              <option key={m.id} value={m.id} disabled={m.clientId == null}>
                {m.name}
                {m.isTest ? " (test)" : ""}
                {m.clientId == null ? " (not in CoachAccountable)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selected && (
        <p className="muted" style={{ marginTop: 12 }}>
          Pick a mentee to see their invoices, meetings and margin per meeting.
        </p>
      )}
      {dataLoading && <div className="loading">Loading…</div>}
      {dataError && <div className="notice notice--warn">{dataError}</div>}

      {report && selected && !dataLoading && (
        <>
          <GroupTitle>Invoices — {selected.name}</GroupTitle>
          <div className="stat-row">
            <Tile value={report.invoices.issued} label="Issued (mentoring)" />
            <Tile value={report.invoices.paid} label="Paid in full" />
            <Tile value={report.invoices.partial} label="Partially paid" />
            <Tile
              value={report.invoices.unpaid}
              label="Unpaid"
              sub={report.invoices.overdue > 0 ? `${report.invoices.overdue} past due` : undefined}
            />
            <Tile
              value={
                !report.invoices.scheduled.hasData
                  ? "?"
                  : report.invoices.scheduled.openEnded
                    ? "∞"
                    : report.invoices.scheduled.count
              }
              label="Scheduled (future)"
              sub={
                !report.invoices.scheduled.hasData
                  ? data?.nextInvoiceColumn
                    ? "re-sync to load next invoice dates"
                    : "needs migration 9963 + re-sync"
                  : report.invoices.scheduled.nextInvoiceDate
                    ? `${report.invoices.scheduled.openEnded ? "monthly, open-ended · " : ""}next ${fmtDate(report.invoices.scheduled.nextInvoiceDate)}`
                    : "no open mentoring engagement"
              }
            />
            {report.invoices.nonMentoring > 0 && (
              <Tile value={report.invoices.nonMentoring} label="Non-mentoring (excluded)" />
            )}
          </div>

          <GroupTitle>Meetings</GroupTitle>
          <div className="stat-row">
            <Tile value={report.meetings.occurred} label="Occurred" />
            <Tile value={report.meetings.upcoming} label="Upcoming (scheduled)" />
            <Tile
              value={fmtCount(report.meetings.paidFor)}
              label="Paid for"
              sub="Σ tier cadence × paid invoices"
            />
            <Tile
              value={fmtCount(report.meetings.prepaid)}
              label="Prepaid, not yet delivered"
              sub="paid for − occurred"
            />
            {report.meetings.overDelivered > 0 && (
              <Tile
                value={fmtCount(report.meetings.overDelivered)}
                label="Delivered beyond paid"
                sub="occurred − paid for"
              />
            )}
            <Tile
              value={report.meetings.credited}
              label="Credited by CA"
              sub="occurred meetings CA counted against an engagement"
            />
            {report.meetings.nonMentoring > 0 && (
              <Tile value={report.meetings.nonMentoring} label="Non-mentoring (excluded)" />
            )}
          </div>

          <GroupTitle>Money (mentoring invoices)</GroupTitle>
          <div className="stat-row">
            <Tile value={fmtUsd(report.money.billed)} label="Billed" />
            <Tile value={fmtUsd(report.money.collected)} label="Collected" />
            <Tile
              value={fmtUsd(report.money.outstanding)}
              label="Outstanding"
              sub="billed − collected"
            />
            <Tile
              value={fmtUsd(report.money.hjgCollected)}
              label={`HJG share (${pctLabel(report.hjgShare)})`}
            />
            <Tile
              value={fmtUsd(report.money.mentorCollected)}
              label={`Mentor share (${pctLabel(report.mentorShare)})`}
            />
          </div>

          <GroupTitle>HJG margin per meeting</GroupTitle>
          <div className="stat-row">
            <Tile
              value={fmtUsd(report.margin.perMeetingDelivered)}
              label="Per meeting delivered"
              sub={`HJG share ÷ ${report.meetings.occurred} occurred (cash basis)`}
            />
            <Tile
              value={fmtUsd(report.margin.perMeetingPaidFor)}
              label="Per meeting paid for"
              sub={`HJG share ÷ ${fmtCount(report.meetings.paidFor)} paid for (entitlement basis)`}
            />
            <Tile
              value={fmtUsd(report.money.hjgEarned)}
              label="HJG share earned"
              sub="the part whose meetings have happened"
            />
            <Tile
              value={fmtUsd(report.money.hjgDeferred)}
              label="HJG share deferred"
              sub="collected, meetings still owed"
            />
          </div>

          {report.meetings.prepaid > 0 ? (
            <div className="notice notice--warn">
              <strong>
                {fmtCount(report.meetings.prepaid)} meeting(s) are paid for but have not happened
                yet
              </strong>{" "}
              — {fmtUsd(report.money.hjgDeferred)} of HJG's share is collected but not yet earned.
              The cash-basis figure ({fmtUsd(report.margin.perMeetingDelivered)}/meeting) is
              inflated by that prepayment; the entitlement-basis figure (
              {fmtUsd(report.margin.perMeetingPaidFor)}/meeting) is the one to trust.
            </div>
          ) : report.meetings.overDelivered > 0 ? (
            <div className="notice notice--warn">
              <strong>
                {fmtCount(report.meetings.overDelivered)} meeting(s) occurred beyond what paid
                invoices cover
              </strong>{" "}
              — unpaid or partially paid invoices, or extra sessions. The cash-basis figure (
              {fmtUsd(report.margin.perMeetingDelivered)}/meeting) is understated until those
              invoices are paid.
            </div>
          ) : report.meetings.occurred > 0 ? (
            <div className="notice notice--info">
              Paid-for and delivered meetings line up — both margin figures agree.
            </div>
          ) : null}

          <GroupTitle>By month</GroupTitle>
          <div
            className={`chart-card__split ${showGraph && showTable ? "chart-card__split--both" : ""}`}
          >
            {showGraph && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 16,
                }}
              >
                <MiniChart title={`HJG share collected (${pctLabel(report.hjgShare)})`}>
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: ct.axis, fontSize: 11 }}
                      stroke={ct.grid}
                    />
                    <YAxis
                      tick={{ fill: ct.axis, fontSize: 11 }}
                      stroke={ct.grid}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      formatter={(v) => fmtUsd(Number(v))}
                    />
                    <Bar dataKey="HJG share" fill={ct.accent} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </MiniChart>
                <MiniChart title="Meetings">
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: ct.axis, fontSize: 11 }}
                      stroke={ct.grid}
                    />
                    <YAxis
                      tick={{ fill: ct.axis, fontSize: 11 }}
                      stroke={ct.grid}
                      allowDecimals={false}
                    />
                    <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Occurred" fill={ct.accent} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Upcoming" fill={ct.cmp} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </MiniChart>
                <MiniChart title="HJG margin per meeting delivered">
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: ct.axis, fontSize: 11 }}
                      stroke={ct.grid}
                    />
                    <YAxis
                      tick={{ fill: ct.axis, fontSize: 11 }}
                      stroke={ct.grid}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP}
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      formatter={(v) => fmtUsd(Number(v))}
                    />
                    <Bar dataKey="Margin / meeting" fill={ct.accent} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </MiniChart>
              </div>
            )}
            {showTable && (
              <div className="table-scroll" style={{ width: "100%" }}>
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Invoices issued</th>
                      <th>Paid</th>
                      <th>Billed</th>
                      <th>Collected</th>
                      <th>HJG share</th>
                      <th>Meetings occurred</th>
                      <th>Upcoming</th>
                      <th>Margin / meeting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byMonth.map((r) => (
                      <tr key={r.month}>
                        <td>{monthLabel(r.month)}</td>
                        <td className="num">{r.invoicesIssued}</td>
                        <td className="num">{r.invoicesPaid}</td>
                        <td className="num">{fmtUsd(r.billed)}</td>
                        <td className="num">{fmtUsd(r.collected)}</td>
                        <td className="num">{fmtUsd(r.hjgCollected)}</td>
                        <td className="num">{r.meetingsOccurred}</td>
                        <td className="num">{r.meetingsUpcoming}</td>
                        <td className="num">{fmtUsd(r.marginPerMeeting)}</td>
                      </tr>
                    ))}
                    {report.byMonth.length === 0 && (
                      <tr>
                        <td colSpan={9} className="muted">
                          No mentoring invoices or meetings for this mentee yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="view__hint" style={{ marginTop: 10 }}>
            Invoices land in their <strong>service month</strong> (CoachAccountable's invoice date),
            meetings in the month they happen — so a month that was paid for before any of its
            meetings happened shows money with no margin yet. That gap is the prepaid skew.
          </p>

          <InvoicesInset report={report} name={selected.name} />
          <MeetingsInset report={report} name={selected.name} />
          <EngagementsInset report={report} />
        </>
      )}
    </CollapsibleCard>
  );
}

function MiniChart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
  credit: "Credit / $0",
};

function InvoicesInset({ report, name }: { report: MenteeMarginReport; name: string }) {
  const rows: Row[] = report.invoiceRows.map((r) => ({
    invoiceNumber: r.invoiceNumber ?? (r.id != null ? `#${r.id}` : ""),
    serviceDate: r.serviceDate,
    issuedDate: r.issuedDate,
    dueDate: r.dueDate,
    tier: r.tier,
    amount: r.amount,
    collected: r.collected,
    status: `${STATUS_LABEL[r.status] ?? r.status}${r.overdue ? " · overdue" : ""}`,
    paidOn: r.paidOn,
    meetingsBought: Math.round(r.meetingsBought * 10) / 10,
    scope: r.mentoring ? "counts" : "excluded",
  }));
  const columns: SortColumn[] = [
    { key: "invoiceNumber", label: "Invoice" },
    { key: "serviceDate", label: "Service date" },
    { key: "issuedDate", label: "Issued" },
    { key: "dueDate", label: "Due" },
    { key: "tier", label: "Tier" },
    { key: "amount", label: "Amount", numeric: true, format: (r) => fmtUsd(Number(r.amount)) },
    {
      key: "collected",
      label: "Collected",
      numeric: true,
      format: (r) => fmtUsd(Number(r.collected)),
    },
    { key: "status", label: "Status" },
    { key: "paidOn", label: "Last payment" },
    { key: "meetingsBought", label: "Meetings bought", numeric: true },
    { key: "scope", label: "In margin?" },
  ];
  return (
    <CollapsibleCard
      id="margins.mentoring.invoices"
      title={`Invoices (${report.invoiceRows.length})`}
      sectionId="margins.mentoring.invoices"
      variant="inset"
      level={3}
      style={{ marginTop: 14 }}
    >
      <SortableTable
        columns={columns}
        rows={rows}
        exportName={`invoices-${name.replace(/\s+/g, "_")}`}
        emptyText="No invoices in the mirror for this mentee."
      />
    </CollapsibleCard>
  );
}

function MeetingsInset({ report, name }: { report: MenteeMarginReport; name: string }) {
  const rows: Row[] = report.meetingRows.map((r) => ({
    date: r.date,
    time: r.time,
    coach: r.coachName,
    meeting: r.name,
    tier: r.tier ?? "unknown",
    group: r.isGroup ? "group" : "",
    when: r.occurred ? "Occurred" : "Upcoming",
    credited: r.credited == null ? "—" : r.credited ? "yes" : "no",
    scope: r.mentoring ? "counts" : "excluded",
  }));
  const columns: SortColumn[] = [
    { key: "date", label: "Date" },
    { key: "time", label: "Time" },
    { key: "coach", label: "Coach" },
    { key: "meeting", label: "Meeting" },
    { key: "tier", label: "Tier" },
    { key: "group", label: "Format" },
    { key: "when", label: "Status" },
    { key: "credited", label: "Credited by CA" },
    { key: "scope", label: "In margin?" },
  ];
  return (
    <CollapsibleCard
      id="margins.mentoring.meetings"
      title={`Meetings (${report.meetingRows.length})`}
      sectionId="margins.mentoring.meetings"
      variant="inset"
      level={3}
      style={{ marginTop: 14 }}
    >
      <SortableTable
        columns={columns}
        rows={rows}
        exportName={`meetings-${name.replace(/\s+/g, "_")}`}
        emptyText="No mentoring meetings in the mirror for this mentee."
        maxRows={500}
      />
    </CollapsibleCard>
  );
}

function EngagementsInset({ report }: { report: MenteeMarginReport }) {
  return (
    <CollapsibleCard
      id="margins.mentoring.engagements"
      title={`Engagements (${report.engagementRows.length})`}
      sectionId="margins.mentoring.engagements"
      variant="inset"
      level={3}
      style={{ marginTop: 14 }}
    >
      <div className="table-scroll">
        <table className="table table--center">
          <thead>
            <tr>
              <th>Engagement</th>
              <th>Tier</th>
              <th>Start</th>
              <th>End</th>
              <th>State</th>
              <th>Next invoice</th>
            </tr>
          </thead>
          <tbody>
            {report.engagementRows.map((e, i) => (
              <tr key={e.id ?? i}>
                <td>{e.name ?? "—"}</td>
                <td>{e.tier}</td>
                <td className="num">{fmtDate(e.startDate) || "—"}</td>
                <td className="num">{fmtDate(e.endDate) || "open"}</td>
                <td>{e.state}</td>
                <td className="num">{fmtDate(e.nextInvoiceDate) || "—"}</td>
              </tr>
            ))}
            {report.engagementRows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No engagements in the mirror for this mentee.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  );
}
