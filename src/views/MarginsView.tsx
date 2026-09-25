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
import type { MentoringTier } from "../../lib/margins";
import {
  fetchMentees,
  toEffectiveMentee,
  fetchMenteeMarginInputs,
  fetchTierMarginInputs,
  fetchActiveMentoringClientIds,
  fetchMentorCostInputs,
  computeMenteeMargin,
  computeTierMargins,
  computeMentorPayCost,
  clampShare,
  DEFAULT_MENTOR_SHARE,
  DEFAULT_TIER_PRICES,
  MENTORING_TIERS,
  TIER_MEETINGS_PER_MONTH,
  type EffectiveMentee,
  type MenteeMarginData,
  type MenteeMarginReport,
  type TierMarginData,
  type TierMarginReport,
  type TierMarginRow,
  type MentorCostData,
  type MentorPayCostReport,
  type MentorPayCostMonth,
} from "../db";

// Margins tab, rebuilt from scratch (session 020). Three lenses so far:
//  • Margins on Mentoring (§602): pick ONE mentee and see, for their ongoing
//    4x / 2x / 1x mentoring, the invoices (issued / paid / scheduled), the
//    meetings (occurred / upcoming / paid for) and HJG's margin PER MEETING —
//    computed two ways so a prepaid month can't quietly inflate the number.
//  • Margins by tier (§606): every ACTIVE mentee run through the same math and
//    grouped by bracket, with the expected margin from the configured prices.
//  • Mentor pay cost by month (§608, session 021): HJG's share of mentoring
//    revenue minus what mentors are paid on top of it — piece work + hourly work
//    from approved Build-payout reviews — and the margin per meeting after it.
// The assumptions (mentor share, price per bracket) live on the screen card and
// feed both. Pure math: lib/margins.ts (verify §17 / §29).

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
const fmtSignedUsd = (n: number | null | undefined) =>
  n == null ? "—" : n > 0 ? `+${usd2.format(n)}` : n < 0 ? `−${usd2.format(-n)}` : usd2.format(0);
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

function ViewSeg({
  view,
  setView,
}: {
  view: "graph" | "table" | "both";
  setView: (v: "graph" | "table" | "both") => void;
}) {
  return (
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
  );
}

export function MarginsView() {
  // --- assumptions shared by every lens (ephemeral; defaults are the real numbers) ---
  const [sharePct, setSharePct] = useState(String(Math.round(DEFAULT_MENTOR_SHARE * 100)));
  const [priceText, setPriceText] = useState<Record<MentoringTier, string>>({
    "4x": String(DEFAULT_TIER_PRICES["4x"]),
    "2x": String(DEFAULT_TIER_PRICES["2x"]),
    "1x": String(DEFAULT_TIER_PRICES["1x"]),
  });
  const mentorShare = clampShare(Number(sharePct) / 100);
  const hjgShare = 1 - mentorShare;
  const prices = useMemo(() => {
    const out: Record<MentoringTier, number> = { ...DEFAULT_TIER_PRICES };
    for (const t of MENTORING_TIERS) {
      const n = Number(priceText[t]);
      if (priceText[t].trim() !== "" && Number.isFinite(n) && n >= 0) out[t] = n;
    }
    return out;
  }, [priceText]);

  return (
    <div className="stack">
      <CollapsibleCard
        id="margins.screen"
        title="Margins"
        sectionId="margins.screen"
        help={<HelpButton id="margins.tab" label="Margins" />}
      >
        <div className="muted" style={{ fontSize: 13, marginTop: -2 }}>
          Several ways to look at HJG's margins, each in its own card.{" "}
          <strong>Margins on Mentoring</strong> is one mentee at a time;{" "}
          <strong>Margins by tier</strong> is every active mentee grouped by bracket;{" "}
          <strong>Mentor pay cost by month</strong> takes mentors' piece work and hourly pay off
          HJG's share. All three use the assumptions below.
        </div>
        <div
          className="filter-bar"
          style={{ padding: "10px 0 6px", borderBottom: "1px solid var(--line)" }}
        >
          <label className="filter">
            <span>Mentor share %</span>
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
          </label>
          {MENTORING_TIERS.map((t) => (
            <label className="filter" key={t}>
              <span>{t} price / month $</span>
              <input
                type="number"
                min={0}
                step={1}
                className="margins__pct-input"
                value={priceText[t]}
                onChange={(e) => setPriceText((p) => ({ ...p, [t]: e.target.value }))}
                aria-label={`${t} monthly price, dollars`}
              />
            </label>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          HJG keeps <strong>{pctLabel(hjgShare)}</strong> of what mentees pay. Expected HJG margin
          per meeting (price × {pctLabel(hjgShare)} ÷ meetings per month):{" "}
          {MENTORING_TIERS.map((t, i) => (
            <span key={t}>
              {i > 0 && " · "}
              <strong>{t}</strong> {fmtUsd((prices[t] * hjgShare) / TIER_MEETINGS_PER_MONTH[t])}
            </span>
          ))}
          . Not saved — a reload restores the defaults.
        </div>
      </CollapsibleCard>

      <MentoringMarginsCard mentorShare={mentorShare} />
      <TierMarginsCard mentorShare={mentorShare} prices={prices} />
      <MentorPayCostCard mentorShare={mentorShare} />
    </div>
  );
}

// ============================================================================
// §602 — Margins on Mentoring (one mentee)
// ============================================================================

function MentoringMarginsCard({ mentorShare }: { mentorShare: number }) {
  const ct = useChartTokens();
  const TOOLTIP = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 6,
    color: ct.tooltipText,
  } as const;

  // --- mentee picker ---
  const [mentees, setMentees] = useState<EffectiveMentee[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let live = true;
    const today = todayYmd();
    Promise.all([fetchMentees(), fetchActiveMentoringClientIds()])
      .then(([rows, active]) => {
        if (!live) return;
        setMentees(rows.map((r) => toEffectiveMentee(r, today)));
        setActiveIds(active);
        setListError(null);
      })
      .catch((e) => live && setListError(String(e)))
      .finally(() => live && setListLoading(false));
    return () => {
      live = false;
    };
  }, []);

  // Only ACTIVE mentees are offered (the user, session 020): an open 4x / 2x / 1x
  // engagement in CoachAccountable, no test rows.
  const activeMentees = useMemo(
    () =>
      mentees.filter(
        (m) => m.clientId != null && !m.isTest && (activeIds?.has(m.clientId) ?? false),
      ),
    [mentees, activeIds],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? activeMentees.filter((m) => m.name.toLowerCase().includes(q)) : activeMentees;
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [activeMentees, search]);
  const selected = useMemo(
    () => activeMentees.find((m) => m.id === selectedId) ?? null,
    [activeMentees, selectedId],
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
          <button className="btn btn--sm" onClick={exportMonths} disabled={!report}>
            Export CSV
          </button>
          <ViewSeg view={view} setView={setView} />
        </div>
      }
    >
      <div className="muted" style={{ fontSize: 13, marginTop: -2 }}>
        Pick an <strong>active</strong> mentee (the list holds everyone with an open 4x / 2x / 1x
        engagement). HJG keeps <strong>{pctLabel(1 - mentorShare)}</strong> of what that mentee has
        paid (the mentor gets {pctLabel(mentorShare)}); the margin is that share{" "}
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
            <option value="">
              {listLoading ? "loading…" : `— pick a mentee (${activeMentees.length} active) —`}
            </option>
            {filtered.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
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

// ============================================================================
// §606 — Margins by tier (all active mentees)
// ============================================================================

const TIER_LABEL: Record<string, string> = { "4x": "4x", "2x": "2x", "1x": "1x", all: "All" };

function TierMarginsCard({
  mentorShare,
  prices,
}: {
  mentorShare: number;
  prices: Record<MentoringTier, number>;
}) {
  const ct = useChartTokens();
  const TOOLTIP = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 6,
    color: ct.tooltipText,
  } as const;

  const [data, setData] = useState<TierMarginData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "table" | "both">("both");

  useEffect(() => {
    let live = true;
    fetchTierMarginInputs()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const report: TierMarginReport | null = useMemo(() => {
    if (!data) return null;
    return computeTierMargins({
      members: data.members,
      today: todayYmd(),
      now: localNowRaw(),
      mentorShare,
      prices,
    });
  }, [data, mentorShare, prices]);

  const chartData = useMemo(
    () =>
      (report?.tiers ?? []).map((t) => ({
        tier: t.tier,
        Expected: t.expectedMarginPerMeeting,
        "Actual (paid for)": t.margin.perMeetingPaidFor,
        Occurred: t.meetings.occurred,
        Upcoming: t.meetings.upcoming,
        "HJG share": t.money.hjgCollected,
      })),
    [report],
  );

  const tableRows: TierMarginRow[] = report ? [...report.tiers, report.total] : [];

  function exportCsv() {
    if (!report) return;
    downloadCsv(
      "margins-by-tier",
      [
        "Tier",
        "Mentees",
        "Price / month",
        "Expected margin per meeting",
        "Actual margin per meeting paid for",
        "vs expected",
        "Actual margin per meeting delivered",
        "Avg of mentees (paid for)",
        "Invoices issued",
        "Invoices paid",
        "Avg billed per invoice",
        "Billed",
        "Collected",
        "HJG share",
        "Meetings occurred",
        "Meetings upcoming",
        "Meetings paid for",
        "Prepaid",
      ],
      tableRows.map((t) => [
        TIER_LABEL[t.tier],
        t.mentees,
        t.price ?? "",
        t.expectedMarginPerMeeting ?? "",
        t.margin.perMeetingPaidFor ?? "",
        t.margin.vsExpected ?? "",
        t.margin.perMeetingDelivered ?? "",
        t.margin.avgMenteePaidFor ?? "",
        t.invoices.issued,
        t.invoices.paid,
        t.avgBilledPerInvoice ?? "",
        t.money.billed,
        t.money.collected,
        t.money.hjgCollected,
        t.meetings.occurred,
        t.meetings.upcoming,
        t.meetings.paidFor,
        t.meetings.prepaid,
      ]),
    );
  }

  const showGraph = view !== "table";
  const showTable = view !== "graph";
  const deltaColor = (n: number | null) =>
    n == null || n === 0 ? undefined : n > 0 ? "var(--ok-text)" : "var(--warn-text)";

  return (
    <CollapsibleCard
      id="margins.tiers"
      title="Margins by tier — all active mentees"
      sectionId="margins.tiers"
      help={<HelpButton id="margins.tiers" label="Margins by tier" />}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn--sm" onClick={exportCsv} disabled={!report}>
            Export CSV
          </button>
          <ViewSeg view={view} setView={setView} />
        </div>
      }
    >
      <div className="muted" style={{ fontSize: 13, marginTop: -2 }}>
        Every mentee with an <strong>open 4x / 2x / 1x engagement</strong>, run through the same
        math as the card above and grouped by bracket — the individual view, summed. Only each
        member's <em>current</em> tier's invoices and meetings count toward that bracket.{" "}
        <strong>Expected</strong> comes from the prices at the top of the tab.
      </div>

      {error && <div className="notice notice--warn">{error}</div>}
      {loading && <div className="loading">Loading…</div>}

      {report && data && !loading && (
        <>
          <div className="stat-row" style={{ marginTop: 12 }}>
            <Tile
              value={report.activeMentees}
              label="Active mentees"
              sub={
                data.excludedClients > 0
                  ? `${data.excludedClients} test / placeholder client(s) left out`
                  : "open 4x / 2x / 1x engagement"
              }
            />
            <Tile
              value={fmtUsd(report.total.money.hjgCollected)}
              label={`HJG share collected (${pctLabel(report.hjgShare)})`}
              sub={`of ${fmtUsd(report.total.money.collected)} collected`}
            />
            <Tile
              value={fmtUsd(report.total.margin.perMeetingPaidFor)}
              label="Per meeting paid for (all tiers)"
              sub={`expected ${fmtUsd(report.total.expectedMarginPerMeeting)} at this roster mix · Δ ${fmtSignedUsd(report.total.margin.vsExpected)}`}
            />
            <Tile
              value={fmtUsd(report.total.margin.perMeetingDelivered)}
              label="Per meeting delivered (all tiers)"
              sub={`HJG share ÷ ${report.total.meetings.occurred} occurred (cash basis)`}
            />
            <Tile
              value={fmtCount(report.total.meetings.prepaid)}
              label="Meetings prepaid, not yet delivered"
              sub={`${fmtUsd(report.total.money.hjgDeferred)} of HJG's share deferred`}
            />
            {report.total.meetings.overDelivered > 0 && (
              <Tile
                value={fmtCount(report.total.meetings.overDelivered)}
                label="Delivered beyond paid"
                sub="unpaid / partial invoices, or extra sessions"
              />
            )}
          </div>

          {report.unassignedMeetings > 0 && (
            <div className="notice notice--warn">
              {report.unassignedMeetings} meeting(s) with no known engagement belong to mentees with
              two open tiers and could not be assigned to a bracket — they are left out of the tier
              figures.
            </div>
          )}

          <GroupTitle>By tier</GroupTitle>
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
                <MiniChart title="HJG margin per meeting — expected vs actual (paid-for basis)">
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="tier" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
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
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Expected" fill={ct.cmp} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Actual (paid for)" fill={ct.accent} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </MiniChart>
                <MiniChart title="Meetings by tier">
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="tier" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
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
                <MiniChart title={`HJG share collected by tier (${pctLabel(report.hjgShare)})`}>
                  <BarChart data={chartData} margin={{ left: 4, right: 8 }}>
                    <CartesianGrid stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="tier" tick={{ fill: ct.axis, fontSize: 11 }} stroke={ct.grid} />
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
              </div>
            )}
            {showTable && (
              <div className="table-scroll" style={{ width: "100%" }}>
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th>Tier</th>
                      <th>Mentees</th>
                      <th>Price / mo</th>
                      <th>Expected $ / mtg</th>
                      <th>Actual $ / mtg paid for</th>
                      <th>vs expected</th>
                      <th>Actual $ / mtg delivered</th>
                      <th>Avg of mentees</th>
                      <th>Invoices paid / issued</th>
                      <th>Avg billed / invoice</th>
                      <th>Collected</th>
                      <th>HJG share</th>
                      <th>Meetings occurred</th>
                      <th>Upcoming</th>
                      <th>Paid for</th>
                      <th>Prepaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((t) => (
                      <tr key={t.tier} style={t.tier === "all" ? { fontWeight: 600 } : undefined}>
                        <td>{TIER_LABEL[t.tier]}</td>
                        <td className="num">{t.mentees}</td>
                        <td className="num">{t.price == null ? "—" : fmtUsd(t.price)}</td>
                        <td className="num">{fmtUsd(t.expectedMarginPerMeeting)}</td>
                        <td className="num">{fmtUsd(t.margin.perMeetingPaidFor)}</td>
                        <td className="num" style={{ color: deltaColor(t.margin.vsExpected) }}>
                          {fmtSignedUsd(t.margin.vsExpected)}
                        </td>
                        <td className="num">{fmtUsd(t.margin.perMeetingDelivered)}</td>
                        <td className="num">{fmtUsd(t.margin.avgMenteePaidFor)}</td>
                        <td className="num">
                          {t.invoices.paid} / {t.invoices.issued}
                        </td>
                        <td className="num">{fmtUsd(t.avgBilledPerInvoice)}</td>
                        <td className="num">{fmtUsd(t.money.collected)}</td>
                        <td className="num">{fmtUsd(t.money.hjgCollected)}</td>
                        <td className="num">{t.meetings.occurred}</td>
                        <td className="num">{t.meetings.upcoming}</td>
                        <td className="num">{fmtCount(t.meetings.paidFor)}</td>
                        <td className="num">{fmtCount(t.meetings.prepaid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="view__hint" style={{ marginTop: 10 }}>
            <strong>$ / meeting paid for</strong> is the pooled figure to compare with{" "}
            <strong>Expected</strong> (price × HJG share ÷ meetings per month);{" "}
            <strong>$ / meeting delivered</strong> is the cash-basis figure, inflated wherever
            mentees have paid ahead. <strong>Avg of mentees</strong> gives each person equal weight
            (their own paid-for figure averaged) instead of weighting by meetings. The{" "}
            <strong>All</strong> row's expectation is blended by the roster mix.
          </p>

          <TierMembersInset report={report} />
        </>
      )}
    </CollapsibleCard>
  );
}

function TierMembersInset({ report }: { report: TierMarginReport }) {
  const rows: Row[] = report.total.members.map((m) => ({
    name: m.name,
    tier: m.tier,
    mentor: m.ownerCoachName,
    since: m.since,
    invoicesPaid: m.invoicesPaid,
    invoicesIssued: m.invoicesIssued,
    collected: m.collected,
    hjg: m.hjgCollected,
    occurred: m.meetingsOccurred,
    upcoming: m.meetingsUpcoming,
    paidFor: Math.round(m.meetingsPaidFor * 10) / 10,
    prepaid: Math.round(m.prepaid * 10) / 10,
    marginDelivered: m.marginPerMeetingDelivered,
    marginPaidFor: m.marginPerMeetingPaidFor,
    nextInvoice: m.scheduled.nextInvoiceDate,
  }));
  const usdCol = (key: string, label: string): SortColumn => ({
    key,
    label,
    numeric: true,
    format: (r) => (r[key] == null ? "—" : fmtUsd(Number(r[key]))),
  });
  const dateCol = (key: string, label: string): SortColumn => ({
    key,
    label,
    format: (r) => (
      <span style={{ whiteSpace: "nowrap" }}>{r[key] == null ? "—" : fmtDate(String(r[key]))}</span>
    ),
  });
  const columns: SortColumn[] = [
    { key: "name", label: "Mentee" },
    { key: "tier", label: "Tier" },
    { key: "mentor", label: "Mentor" },
    usdCol("marginPaidFor", "$ / mtg paid for"),
    usdCol("marginDelivered", "$ / mtg delivered"),
    usdCol("hjg", "HJG share"),
    usdCol("collected", "Collected"),
    { key: "invoicesPaid", label: "Invoices paid", numeric: true },
    { key: "invoicesIssued", label: "Issued", numeric: true },
    { key: "occurred", label: "Occurred", numeric: true },
    { key: "upcoming", label: "Upcoming", numeric: true },
    { key: "paidFor", label: "Paid for", numeric: true },
    { key: "prepaid", label: "Prepaid", numeric: true },
    dateCol("since", "Since"),
    dateCol("nextInvoice", "Next invoice"),
  ];
  return (
    <CollapsibleCard
      id="margins.tiers.mentees"
      title={`Per mentee (${report.total.members.length})`}
      sectionId="margins.tiers.mentees"
      variant="inset"
      level={3}
      style={{ marginTop: 14 }}
    >
      <SortableTable
        columns={columns}
        rows={rows}
        exportName="margins-by-tier-mentees"
        emptyText="No active mentees with an open 4x / 2x / 1x engagement."
        maxRows={500}
      />
    </CollapsibleCard>
  );
}

// ============================================================================
// §608 — Mentor pay cost by month (piece work + hourly, as a cost to HJG)
// ============================================================================

type CostRange = "6" | "12" | "24" | "all";
const COST_RANGES: { key: CostRange; label: string }[] = [
  { key: "6", label: "6 mo" },
  { key: "12", label: "12 mo" },
  { key: "24", label: "24 mo" },
  { key: "all", label: "All" },
];
function shiftYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const o = y * 12 + (m - 1) + n;
  return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
}

function MentorPayCostCard({ mentorShare }: { mentorShare: number }) {
  const ct = useChartTokens();
  const TOOLTIP = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 6,
    color: ct.tooltipText,
  } as const;

  const [data, setData] = useState<MentorCostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "table" | "both">("both");
  const [range, setRange] = useState<CostRange>("12");

  useEffect(() => {
    let live = true;
    fetchMentorCostInputs()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const report: MentorPayCostReport | null = useMemo(() => {
    if (!data) return null;
    const today = todayYmd();
    const curYm = today.slice(0, 7);
    return computeMentorPayCost({
      members: data.members,
      builds: data.builds,
      today,
      now: localNowRaw(),
      mentorShare,
      fromYm: range === "all" ? null : shiftYm(curYm, -(Number(range) - 1)),
      toYm: curYm,
    });
  }, [data, mentorShare, range]);

  const chartData = useMemo(
    () =>
      (report?.months ?? []).map((m) => ({
        month: monthLabel(m.month),
        "HJG share": m.hjgShare,
        "HJG net": m.hjgNet,
        "Piece work": m.pieceWork,
        Hourly: m.hourlyPay,
        Before: m.marginPerMeeting,
        After: m.netMarginPerMeeting,
      })),
    [report],
  );
  const newestFirst: MentorPayCostMonth[] = report ? [...report.months].reverse() : [];

  function exportCsv() {
    if (!report) return;
    const row = (label: string, m: Omit<MentorPayCostMonth, "month" | "inProgress">) => [
      label,
      m.collected,
      m.hjgShare,
      m.pieceWork,
      m.hours,
      m.hourlyPay,
      m.extraPay,
      m.hjgNet,
      m.meetings,
      m.marginPerMeeting ?? "",
      m.netMarginPerMeeting ?? "",
      m.draftBuilds,
      m.draftExtraPay,
    ];
    downloadCsv(
      "margins-mentor-pay-cost",
      [
        "Month",
        "Collected",
        `HJG share (${pctLabel(report.hjgShare)})`,
        "Piece work",
        "Hourly hours",
        "Hourly pay",
        "Piece work + hourly",
        "HJG net",
        "Meetings delivered",
        "$ / meeting before",
        "$ / meeting after",
        "Draft builds (not counted)",
        "Draft extras (not counted)",
      ],
      [...newestFirst.map((m) => row(m.month, m)), row("TOTAL", report.total)],
    );
  }

  const showGraph = view !== "table";
  const showTable = view !== "graph";
  const money = (v: unknown) => fmtUsd(Number(v));

  return (
    <CollapsibleCard
      id="margins.mentorCost"
      title="Mentor pay cost by month — piece work + hourly"
      sectionId="margins.mentorCost"
      help={<HelpButton id="margins.mentorCost" label="Mentor pay cost by month" />}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg" role="tablist" aria-label="Months shown">
            {COST_RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                aria-selected={range === r.key}
                className={`seg__btn ${range === r.key ? "seg__btn--active" : ""}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="btn btn--sm" onClick={exportCsv} disabled={!report}>
            Export CSV
          </button>
          <ViewSeg view={view} setView={setView} />
        </div>
      }
    >
      <div className="muted" style={{ fontSize: 13, marginTop: -2 }}>
        HJG's share of mentoring revenue each month, minus what mentors are paid{" "}
        <strong>on top of their revenue share</strong>: <strong>piece work</strong> and{" "}
        <strong>hourly work</strong> from <em>approved</em> Build-payout reviews. The HJG share uses
        the mentor-share assumption above; piece work and hourly are the actual signed-off amounts.
        Revenue is by invoice service month, collected basis, for every mentoring client, including
        mentees who have since left.
      </div>

      {error && <div className="notice notice--warn">{error}</div>}
      {loading && <div className="loading">Loading…</div>}

      {report && data && !loading && (
        <>
          {!data.hourlyColumn && (
            <div className="notice notice--warn" style={{ marginTop: 10 }}>
              Hourly work isn't in the database yet. Apply migration{" "}
              <code>9961_payout_build_hours.sql</code> (Supabase SQL Editor) so Build payout can
              save it. Until then this card counts piece work only.
            </div>
          )}
          {report.total.draftBuilds > 0 && (
            <div className="notice notice--info" style={{ marginTop: 10 }}>
              {report.total.draftBuilds} draft build{report.total.draftBuilds === 1 ? "" : "s"} in
              this range carr{report.total.draftBuilds === 1 ? "ies" : "y"}{" "}
              {fmtUsd(report.total.draftExtraPay)} of piece work / hourly that isn't counted until
              it's approved.
            </div>
          )}

          <div className="stat-row" style={{ marginTop: 12 }}>
            <Tile
              value={fmtUsd(report.total.hjgShare)}
              label={`HJG share (${pctLabel(report.hjgShare)})`}
              sub={`of ${fmtUsd(report.total.collected)} collected`}
            />
            <Tile
              value={fmtUsd(report.total.extraPay)}
              label="Mentor piece work + hourly"
              sub={
                report.total.extraShareOfHjg == null
                  ? `${fmtUsd(report.total.pieceWork)} piece · ${fmtUsd(report.total.hourlyPay)} hourly`
                  : `${pctLabel(report.total.extraShareOfHjg)} of HJG's share · ${fmtUsd(report.total.hourlyPay)} hourly`
              }
            />
            <Tile
              value={fmtUsd(report.total.hjgNet)}
              label="HJG net"
              sub="HJG share − piece work − hourly"
            />
            <Tile
              value={fmtUsd(report.total.netMarginPerMeeting)}
              label="Net margin per meeting delivered"
              sub={`${fmtUsd(report.total.marginPerMeeting)} before the extras · ${report.total.meetings} meetings`}
            />
            <Tile
              value={`${fmtCount(report.total.hours)} h`}
              label="Hourly hours paid"
              sub={`${fmtUsd(report.total.hourlyPay)} to mentors`}
            />
          </div>

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
                <MiniChart title={`HJG share vs HJG net, after piece work + hourly`}>
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
                      formatter={money}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="HJG share" fill={ct.cmp} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="HJG net" fill={ct.accent} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </MiniChart>
                <MiniChart title="Paid to mentors on top of the revenue share">
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
                      formatter={money}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Hourly" stackId="extra" fill={ct.accent} />
                    <Bar dataKey="Piece work" stackId="extra" fill={ct.cmp} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </MiniChart>
                <MiniChart title="HJG margin per meeting delivered — before vs after the extras">
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
                      formatter={money}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Before" fill={ct.cmp} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="After" fill={ct.accent} radius={[3, 3, 0, 0]} />
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
                      <th>Collected</th>
                      <th>HJG share</th>
                      <th>Piece work</th>
                      <th>Hourly (h)</th>
                      <th>Hourly $</th>
                      <th>Piece + hourly</th>
                      <th>HJG net</th>
                      <th>Meetings</th>
                      <th>$ / mtg before</th>
                      <th>$ / mtg after</th>
                      <th>Drafts (not counted)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newestFirst.map((m) => (
                      <tr key={m.month}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {monthLabel(m.month)}
                          {m.inProgress && (
                            <span className="muted" style={{ fontSize: 11 }}>
                              {" "}
                              · in progress
                            </span>
                          )}
                        </td>
                        <td className="num">{fmtUsd(m.collected)}</td>
                        <td className="num">{fmtUsd(m.hjgShare)}</td>
                        <td className="num">{fmtUsd(m.pieceWork)}</td>
                        <td className="num">{fmtCount(m.hours)}</td>
                        <td className="num">{fmtUsd(m.hourlyPay)}</td>
                        <td className="num">{fmtUsd(m.extraPay)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {fmtUsd(m.hjgNet)}
                        </td>
                        <td className="num">{m.meetings}</td>
                        <td className="num">{fmtUsd(m.marginPerMeeting)}</td>
                        <td className="num">{fmtUsd(m.netMarginPerMeeting)}</td>
                        <td className="num">
                          {m.draftBuilds ? `${m.draftBuilds} · ${fmtUsd(m.draftExtraPay)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 600 }}>
                      <td>Total</td>
                      <td className="num">{fmtUsd(report.total.collected)}</td>
                      <td className="num">{fmtUsd(report.total.hjgShare)}</td>
                      <td className="num">{fmtUsd(report.total.pieceWork)}</td>
                      <td className="num">{fmtCount(report.total.hours)}</td>
                      <td className="num">{fmtUsd(report.total.hourlyPay)}</td>
                      <td className="num">{fmtUsd(report.total.extraPay)}</td>
                      <td className="num">{fmtUsd(report.total.hjgNet)}</td>
                      <td className="num">{report.total.meetings}</td>
                      <td className="num">{fmtUsd(report.total.marginPerMeeting)}</td>
                      <td className="num">{fmtUsd(report.total.netMarginPerMeeting)}</td>
                      <td className="num">
                        {report.total.draftBuilds
                          ? `${report.total.draftBuilds} · ${fmtUsd(report.total.draftExtraPay)}`
                          : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <p className="view__hint" style={{ marginTop: 10 }}>
            <strong>HJG net</strong> = HJG share − piece work − hourly.{" "}
            <strong>$ / mtg before</strong> is the HJG share ÷ meetings delivered that month (the
            §602 cash-basis figure, summed over every mentee); <strong>after</strong> takes the
            extras off first. The current month is in progress: its revenue, meetings and reviews
            are still coming in. A month's extras count once its build is <strong>approved</strong>.
          </p>

          <MentorCostInset report={report} />
        </>
      )}
    </CollapsibleCard>
  );
}

function MentorCostInset({ report }: { report: MentorPayCostReport }) {
  const total = report.total.extraPay;
  const rows: Row[] = report.mentors.map((m) => ({
    mentor: m.coachName,
    months: m.months,
    pieceWork: m.pieceWork,
    hours: m.hours,
    hourlyPay: m.hourlyPay,
    extraPay: m.extraPay,
    share: total > 0 ? Math.round((m.extraPay / total) * 1000) / 10 : null,
  }));
  const usdCol = (key: string, label: string): SortColumn => ({
    key,
    label,
    numeric: true,
    format: (r) => (r[key] == null ? "—" : fmtUsd(Number(r[key]))),
  });
  const columns: SortColumn[] = [
    { key: "mentor", label: "Mentor" },
    usdCol("extraPay", "Piece + hourly"),
    usdCol("hourlyPay", "Hourly $"),
    { key: "hours", label: "Hours", numeric: true },
    usdCol("pieceWork", "Piece work"),
    { key: "months", label: "Months", numeric: true },
    {
      key: "share",
      label: "Share of total",
      numeric: true,
      format: (r) => (r.share == null ? "—" : `${r.share}%`),
    },
  ];
  return (
    <CollapsibleCard
      id="margins.mentorCost.mentors"
      title={`Per mentor (${report.mentors.length})`}
      sectionId="margins.mentorCost.mentors"
      variant="inset"
      level={3}
      style={{ marginTop: 14 }}
    >
      <SortableTable
        columns={columns}
        rows={rows}
        exportName="margins-mentor-pay-cost-mentors"
        emptyText="No approved piece work or hourly work in this range."
        maxRows={200}
      />
    </CollapsibleCard>
  );
}
