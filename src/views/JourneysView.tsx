import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../auth";
import {
  addMenteeExclusion,
  aggregateJourneyDurations,
  fetchCompanyOptions,
  fetchMenteeJourneys,
  fetchMenteeRecordsByClient,
  removeMenteeExclusion,
  saveMenteeRecord,
  setCompanyOption,
  stageColorsFromRaw,
  DEFAULT_STAGE_COLORS,
  EXIT_STATUSES,
  type MenteeJourney,
  type MenteeRecord,
  type MenteeRecordEdit,
  type PipelineTier,
  type ResolvedMenteeStatus,
  type StageBasis,
} from "../db";
import { HelpButton } from "../components/HelpDrawer";
import { MenteeStatusEditor } from "../components/MenteeStatusEditor";
import { useChartTokens } from "../theme";

const TIER_LABEL: Record<PipelineTier, string> = { jumpstart: "JumpStart", "4x": "4x", "2x": "2x", "1x": "1x", graduated: "Graduated" };

// Stage-palette index for each pipeline tier. The `colors` prop is in stage order:
// 0 Discovery, 1 JumpStart, 2 4x, 3 2x, 4 1x, 5 Graduation — so a meeting's tier
// reuses the exact color its stage shows on the rail.
const TIER_COLOR_INDEX: Record<PipelineTier, number> = { jumpstart: 1, "4x": 2, "2x": 3, "1x": 4, graduated: 5 };

// Whole days from a to b (YYYY-MM-DD), for stage-gap labels.
function spanDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type ChartStyle = { background: string; border: string; borderRadius: number; color: string };

const STATUS_LABEL: Record<ResolvedMenteeStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  quit: "Quit",
  fired: "Fired",
  no_mentoring: "No mentoring",
  inactive: "Inactive",
};

// Color for the alternative-exit node (quit / fired / no mentoring) on the rail.
const EXIT_COLOR = "#b91c1c";

// Humanize a day count into a compact "1y 2mo" / "3mo" / "12 days" form.
function humanizeDays(n: number | null): string {
  if (n == null) return "—";
  if (n < 0) return "—";
  if (n < 60) return `${n} day${n === 1 ? "" : "s"}`;
  const months = Math.round(n / 30.44);
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years}y`;
}

function StatusPill({ status }: { status: ResolvedMenteeStatus }) {
  return <span className={`pill pill--mentee-${status}`}>{STATUS_LABEL[status]}</span>;
}

// --- Pipeline-timing cohort filters -------------------------------------------
// Filters that scope WHICH mentees feed the board roll-up (graph + tiles + table).
// Ephemeral local state on the card; they compose. The roster/excluded drop still
// happens inside aggregateJourneyDurations + the counts, on top of these.

type StatusFilter = "all" | "active" | "graduated" | "exited";
type TierFilter = "all" | PipelineTier;
const WINDOW_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Any time" },
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 24 months" },
];

// YYYY-MM-DD for `n` months before today (local). Used as the activity-window cutoff.
function ymdMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A mentee's most recent activity date: last meeting, else the latest stage date,
// else discovery. Drives the "active within" window filter.
function lastActivityOf(j: MenteeJourney): string | null {
  let m: string | null = j.lastMeeting ?? null;
  for (const d of [j.discoveryDate, ...Object.values(j.stageDates)]) {
    if (d && (!m || d > m)) m = d;
  }
  return m;
}

// One node on the horizontal stage rail (a date marker), with the gap to the
// previous node rendered on the connector. `color` is this stage's configured
// color (Company options → Journeys → Pipeline stage colors); a reached stage
// shows it solid, an unreached stage stays muted.
function StageNode({
  label,
  date,
  gap,
  color,
  exit = false,
}: {
  label: string;
  date: string | null;
  gap?: string;
  color: string;
  // An alternative-exit node (quit / fired / no mentoring) renders as "reached"
  // even without a date and is marked with an ✕ instead of a dot.
  exit?: boolean;
}) {
  const reached = exit || !!date;
  return (
    <div className={`stage${exit ? " stage--exit" : ""}`}>
      {gap !== undefined && <div className="stage__gap">{gap}</div>}
      <div
        className={`stage__node ${reached ? "" : "stage__node--empty"} ${exit ? "stage__node--exit" : ""}`}
        style={reached ? { borderTopColor: color } : undefined}
      >
        <span className="stage__dot" style={reached ? { background: color, borderColor: color } : undefined}>
          {exit ? "✕" : ""}
        </span>
        <span className="stage__label" style={reached ? { color } : undefined}>
          {label}
        </span>
        <span className="stage__date">{date ?? (exit ? "exited" : "—")}</span>
      </div>
    </div>
  );
}

// Tooltip for the "time in each program stage" chart: the category + how long the
// mentee spent in it (humanized + exact days).
function DaysTooltip({
  active,
  payload,
  tip,
}: {
  active?: boolean;
  payload?: { payload: { category: string; days: number; ongoing: boolean } }[];
  tip?: ChartStyle;
}) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...tip, padding: "6px 10px", fontSize: 13 }}>
      <div style={{ marginBottom: 2 }}>{p.category}</div>
      <div>
        {humanizeDays(p.days)}
        {p.ongoing ? " (so far)" : ""}
      </div>
      <div className="muted" style={{ marginTop: 2 }}>
        {p.days} day{p.days === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function Timeline({
  journey,
  userId,
  colors,
  onSaved,
  onError,
}: {
  journey: MenteeJourney;
  userId: string;
  colors: string[]; // 6 stage colors in order: Discovery, JumpStart, 4x, 2x, 1x, Graduation
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [excluding, setExcluding] = useState(false);
  const ct = useChartTokens();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const TOOLTIP: ChartStyle = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText };

  async function toggleExclude() {
    setExcluding(true);
    try {
      if (journey.excluded) await removeMenteeExclusion(journey.clientId);
      else await addMenteeExclusion(userId, journey.clientId, null);
      onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setExcluding(false);
    }
  }

  // Days spent in each program category: the span from entering a stage to
  // entering the next reached stage. The current (last reached) stage runs to
  // today if the mentee is still active, else to their last activity. Each column
  // is colored to match its stage on the rail above, so the bar heights show —
  // visually — how long the mentee spent in each category.
  const stageDays = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const milestones = [
      journey.discoveryDate,
      journey.stageDates.jumpstart,
      journey.stageDates["4x"],
      journey.stageDates["2x"],
      journey.stageDates["1x"],
      journey.stageDates.graduated,
    ];
    const cats = [
      { full: "Discovery → JumpStart", short: "Disc→JS", colorIdx: 0 },
      { full: "JumpStart", short: "JumpStart", colorIdx: 1 },
      { full: "4x mentoring", short: "4x", colorIdx: 2 },
      { full: "2x mentoring", short: "2x", colorIdx: 3 },
      { full: "1x mentoring", short: "1x", colorIdx: 4 },
    ];
    const out: { category: string; short: string; days: number; color: string; ongoing: boolean }[] = [];
    for (let i = 0; i < cats.length; i++) {
      const start = milestones[i];
      if (!start) continue;
      let end: string | null = null;
      for (let j = i + 1; j < milestones.length; j++) {
        if (milestones[j]) {
          end = milestones[j];
          break;
        }
      }
      const ongoing = !end;
      if (!end) end = journey.resolvedStatus === "active" ? today : journey.lastMeeting ?? today;
      const days = spanDays(start, end);
      if (days == null || days < 0) continue;
      out.push({ category: cats[i].full, short: cats[i].short, days, color: colors[cats[i].colorIdx], ongoing });
    }
    return out;
  }, [journey.discoveryDate, journey.stageDates, journey.resolvedStatus, journey.lastMeeting, colors]);

  // Every recorded meeting, ascending — listed in the grid below the chart.
  const meetingList = journey.meetings;

  // Alternative exit: the journey ended somewhere other than graduation (quit /
  // fired / no mentoring). The rail then shows an exit node in place of Graduation.
  const exited = (EXIT_STATUSES as readonly string[]).includes(journey.resolvedStatus);
  const exitDate = journey.overrideDate ?? journey.lastMeeting;
  // The latest stage the mentee actually reached — the exit connector measures from
  // here, since the exit can happen at any stage (not just after 1x).
  const lastStageDate =
    journey.stageDates["1x"] ??
    journey.stageDates["2x"] ??
    journey.stageDates["4x"] ??
    journey.stageDates.jumpstart ??
    journey.discoveryDate;

  return (
    <div className="journey">
      <div className="journey__head">
        <div>
          <h2>
            {journey.name}
            {journey.excluded && <span className="pill" style={{ marginLeft: 8 }}>excluded</span>}
          </h2>
          <div className="journey__sub muted">
            {journey.ownerCoachName && (
              <>
                Owner: <strong>{journey.ownerCoachName}</strong>
                {journey.ownerSource === "fallback" && " (from latest meeting — primary coach not synced)"}
                {" · "}
              </>
            )}
            {journey.meetingCount} meeting{journey.meetingCount === 1 ? "" : "s"}
            {journey.engagementIds.length > 1 && <> · {journey.engagementIds.length} engagements</>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusPill status={journey.resolvedStatus} />
          <button
            className="btn btn--sm"
            onClick={toggleExclude}
            disabled={excluding}
            title={
              journey.excluded
                ? "Re-include this mentee in metrics and pipeline aggregates"
                : "Hide this test/placeholder mentee from metrics and pipeline aggregates (reversible)"
            }
          >
            {excluding ? "…" : journey.excluded ? "Include in metrics" : "Exclude from metrics"}
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat__value">{humanizeDays(journey.daysInSystem)}</span>
          <span className="stat__label">Time in system</span>
        </div>
        <div className="stat">
          <span className="stat__value">{humanizeDays(spanDays(journey.discoveryDate, journey.stageDates.jumpstart))}</span>
          <span className="stat__label">Discovery → JumpStart</span>
        </div>
        <div className="stat">
          <span className="stat__value">{journey.currentTier ? TIER_LABEL[journey.currentTier] : "—"}</span>
          <span className="stat__label">Current tier</span>
        </div>
        <div className="stat">
          <span className="stat__value">{humanizeDays(journey.activeSpanDays)}</span>
          <span className="stat__label">Mentoring span</span>
        </div>
      </div>

      <div className="stage-rail">
        <StageNode label="Discovery" date={journey.discoveryDate} color={colors[0]} />
        <StageNode label="JumpStart" date={journey.stageDates.jumpstart} gap={humanizeDays(spanDays(journey.discoveryDate, journey.stageDates.jumpstart))} color={colors[1]} />
        <StageNode label="4x mentoring" date={journey.stageDates["4x"]} gap={humanizeDays(spanDays(journey.stageDates.jumpstart, journey.stageDates["4x"]))} color={colors[2]} />
        <StageNode label="2x mentoring" date={journey.stageDates["2x"]} gap={humanizeDays(spanDays(journey.stageDates["4x"], journey.stageDates["2x"]))} color={colors[3]} />
        <StageNode label="1x mentoring" date={journey.stageDates["1x"]} gap={humanizeDays(spanDays(journey.stageDates["2x"], journey.stageDates["1x"]))} color={colors[4]} />
        {exited ? (
          // Alternative ending: the path exits (Quit / Fired / No mentoring) in place
          // of Graduation. The exit date is the override "ended on" (else last activity).
          <StageNode label={STATUS_LABEL[journey.resolvedStatus]} date={exitDate} exit color={EXIT_COLOR} gap={humanizeDays(spanDays(lastStageDate, exitDate))} />
        ) : (
          <StageNode label="Graduation" date={journey.stageDates.graduated} gap={humanizeDays(spanDays(journey.stageDates["1x"], journey.stageDates.graduated))} color={colors[5]} />
        )}
      </div>

      <div className="journey__rhythm">
        <div className="journey__rhythm-head">
          <h3>Time in each program stage</h3>
          <span className="muted">
            Days spent in each category — from entering a stage to entering the next (the current stage runs to today).
            Bars match the stage-rail colors above.
          </span>
        </div>
        {stageDays.length > 0 ? (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageDays} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="short" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} interval={0} />
                <YAxis allowDecimals={false} width={34} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} unit="d" />
                <Tooltip content={<DaysTooltip tip={TOOLTIP} />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="days" radius={[3, 3, 0, 0]}>
                  {stageDays.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>No stage dates recorded yet for this mentee.</div>
        )}
      </div>

      <div className="journey__rhythm">
        <div className="journey__rhythm-head">
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Meetings ({meetingList.length}) <HelpButton id="general.coachAttribution" label="How coaches are matched" />
          </h3>
          <span className="muted">Every recorded meeting for this mentee, earliest first.</span>
        </div>
        {meetingList.length > 0 ? (
          <div className="table-scroll" style={{ width: "100%", maxHeight: 320, overflowY: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Meeting</th>
                  <th>Tier</th>
                  <th>Coach</th>
                </tr>
              </thead>
              <tbody>
                {meetingList.map((m, i) => (
                  <tr key={i}>
                    <td className="num">{m.date}</td>
                    <td>
                      {m.name}
                      {m.isGroup && (
                        <span className="pill" style={{ marginLeft: 6 }}>
                          group
                        </span>
                      )}
                    </td>
                    <td>
                      {m.tier ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span className="rhythm-legend__swatch" style={{ background: colors[TIER_COLOR_INDEX[m.tier]] }} />
                          {TIER_LABEL[m.tier]}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{m.coachName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>No meetings recorded.</div>
        )}
      </div>

    </div>
  );
}

function LegTooltip({ active, payload, tip }: { active?: boolean; payload?: { payload: { leg: string; avg: number | null; median: number | null; n: number } }[]; tip?: ChartStyle }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...tip, padding: "6px 10px", fontSize: 13 }}>
      <div style={{ marginBottom: 4 }}>{p.leg}</div>
      <div>Average: {humanizeDays(p.avg)}</div>
      <div>Median: {humanizeDays(p.median)}</div>
      <div className="muted" style={{ marginTop: 2 }}>n = {p.n} mentees</div>
    </div>
  );
}

// Board-level roll-up of the pipeline-leg durations across every mentee.
function PipelineSummary({ journeys }: { journeys: MenteeJourney[] }) {
  const ct = useChartTokens();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const TOOLTIP: ChartStyle = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText };

  // Cohort filters (ephemeral). They narrow which mentees feed the roll-up.
  const [windowM, setWindowM] = useState<string>("all");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [tierF, setTierF] = useState<TierFilter>("all");
  const [ownerF, setOwnerF] = useState<string>("all");
  const [overriddenGradOnly, setOverriddenGradOnly] = useState(false);
  const anyFilter = windowM !== "all" || statusF !== "all" || tierF !== "all" || ownerF !== "all" || overriddenGradOnly;
  const clearFilters = () => {
    setWindowM("all");
    setStatusF("all");
    setTierF("all");
    setOwnerF("all");
    setOverriddenGradOnly(false);
  };

  // Owner options = distinct owners among in-roster, non-excluded mentees.
  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const j of journeys) if (j.inSourceOfTruth && !j.excluded && j.ownerCoachName) s.add(j.ownerCoachName);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [journeys]);

  // Apply the cohort filters. Roster/excluded scoping still happens downstream.
  const cohort = useMemo(() => {
    const cutoff = windowM === "all" ? null : ymdMonthsAgo(Number(windowM));
    return journeys.filter((j) => {
      if (cutoff) {
        const act = lastActivityOf(j);
        if (!act || act < cutoff) return false;
      }
      if (statusF === "exited") {
        if (!(EXIT_STATUSES as readonly string[]).includes(j.resolvedStatus)) return false;
      } else if (statusF !== "all" && j.resolvedStatus !== statusF) {
        return false;
      }
      if (tierF !== "all" && j.currentTier !== tierF) return false;
      if (ownerF !== "all" && j.ownerCoachName !== ownerF) return false;
      if (overriddenGradOnly && !j.stageOverrides.graduated) return false;
      return true;
    });
  }, [journeys, windowM, statusF, tierF, ownerF, overriddenGradOnly]);

  const legs = useMemo(() => aggregateJourneyDurations(cohort), [cohort]);
  const counts = useMemo(() => {
    let active = 0;
    let graduated = 0;
    let total = 0;
    let excluded = 0;
    let offRoster = 0;
    for (const j of cohort) {
      // Off-roster mentees (CA's other pipelines, not in the Mentees source of truth)
      // are dropped from the board roll-up — same treatment as excluded mentees.
      if (!j.inSourceOfTruth) {
        offRoster++;
        continue;
      }
      if (j.excluded) {
        excluded++;
        continue; // excluded mentees don't count toward the board roll-up
      }
      total++;
      if (j.resolvedStatus === "active") active++;
      if (j.resolvedStatus === "graduated") graduated++;
    }
    return { total, active, graduated, excluded, offRoster };
  }, [cohort]);
  // Denominator for "showing N of M": all in-roster, non-excluded mentees (no filters).
  const rosterTotal = useMemo(() => journeys.filter((j) => j.inSourceOfTruth && !j.excluded).length, [journeys]);
  const grad = legs.find((l) => l.key === "dc_grad");
  const chartData = legs.map((l) => ({ leg: l.label, avg: l.avgDays, median: l.medianDays, n: l.n }));

  return (
    <div className="card card--inset" style={{ marginBottom: 18 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Pipeline timing — {anyFilter ? "filtered" : "all"} mentees <HelpButton id="journeys.aggregate" label="Pipeline timing" />
      </h2>
      <p className="view__hint">
        Average time each leg of the journey takes, across every mentee where both ends are known (n shown per leg).
        Stages come from CoachAccountable engagements (JumpStart → 4x → 2x → 1x), and graduation from an “After Graduation
        Care” engagement. Only mentees in the <strong>Mentees source of truth</strong> (JYF / 4x / 2x / 1x) are counted.
        {counts.offRoster > 0 && (
          <> · {counts.offRoster} off-roster mentee{counts.offRoster === 1 ? "" : "s"} (other CA pipelines) excluded.</>
        )}
        {counts.excluded > 0 && (
          <> · {counts.excluded} mentee{counts.excluded === 1 ? "" : "s"} manually excluded.</>
        )}
      </p>

      <div className="journey-filters">
        <label className="journey-filters__field">
          <span>Active within</span>
          <select value={windowM} onChange={(e) => setWindowM(e.target.value)}>
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="journey-filters__field">
          <span>Status</span>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value as StatusFilter)}>
            <option value="all">Any</option>
            <option value="active">Active</option>
            <option value="graduated">Graduated</option>
            <option value="exited">Exited (quit / fired / no mentoring)</option>
          </select>
        </label>
        <label className="journey-filters__field">
          <span>Current tier</span>
          <select value={tierF} onChange={(e) => setTierF(e.target.value as TierFilter)}>
            <option value="all">Any</option>
            <option value="jumpstart">JumpStart</option>
            <option value="4x">4x</option>
            <option value="2x">2x</option>
            <option value="1x">1x</option>
            <option value="graduated">Graduated</option>
          </select>
        </label>
        {owners.length > 0 && (
          <label className="journey-filters__field">
            <span>Owner</span>
            <select value={ownerF} onChange={(e) => setOwnerF(e.target.value)}>
              <option value="all">Any</option>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
        )}
        <label className="journey-filters__check" title="Only mentees whose graduation date was set manually (an override)">
          <input type="checkbox" checked={overriddenGradOnly} onChange={(e) => setOverriddenGradOnly(e.target.checked)} />
          <span>Overridden graduation date</span>
        </label>
        <span className="journey-filters__count muted">
          Showing {counts.total} of {rosterTotal}
          {anyFilter && (
            <button className="btn btn--sm" style={{ marginLeft: 8 }} onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </span>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat__value">{counts.total}</span>
          <span className="stat__label">Mentees</span>
        </div>
        <div className="stat">
          <span className="stat__value">{counts.active}</span>
          <span className="stat__label">Active</span>
        </div>
        <div className="stat">
          <span className="stat__value">{counts.graduated}</span>
          <span className="stat__label">Graduated</span>
        </div>
        <div className="stat">
          <span className="stat__value">{humanizeDays(grad?.avgDays ?? null)}</span>
          <span className="stat__label">Avg time to graduate</span>
        </div>
      </div>

      <div className="chart-card__split chart-card__split--both">
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} unit="d" />
              <YAxis type="category" dataKey="leg" width={150} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
              <Tooltip content={<LegTooltip tip={TOOLTIP} />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Bar dataKey="avg" fill={ct.accent} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="table-scroll" style={{ width: "100%" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Stage leg</th>
                <th>Mentees</th>
                <th>Average</th>
                <th>Median</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  <td className="num">{l.n}</td>
                  <td className="num">{humanizeDays(l.avgDays)}</td>
                  <td className="num">{humanizeDays(l.medianDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// The editable fields of the Mentee source-of-truth record (mirrors Notion), in
// display order. `num` renders a number input, `date` a date input, `area` a
// multi-line textarea, everything else a text input.
type RecKind = "text" | "date" | "num" | "area";
const RECORD_FIELDS: { key: keyof MenteeRecordEdit; label: string; kind: RecKind; wide?: boolean }[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "status", label: "Status (Notion)", kind: "text" },
  { key: "mentor", label: "Mentor", kind: "text" },
  { key: "mentor_1", label: "Mentor (full)", kind: "text" },
  { key: "dc_date", label: "Discovery-call date", kind: "date" },
  { key: "projected_start", label: "Projected start", kind: "date" },
  { key: "offering_signup", label: "Offering signup", kind: "date" },
  { key: "mt_prayer_partner", label: "Prayer partner", kind: "text" },
  { key: "wants_pp", label: "Wants PP?", kind: "text" },
  { key: "ff_amount", label: "FF amount", kind: "num" },
  { key: "freedom_fight_paid", label: "Freedom Fight paid?", kind: "text" },
  { key: "date_ff_paid", label: "Date FF paid", kind: "date" },
  { key: "current_invoice_amount", label: "Current invoice amount", kind: "num" },
  { key: "email", label: "Email", kind: "text" },
  { key: "phone", label: "Phone", kind: "text" },
  { key: "js_lesson", label: "JS lesson", kind: "text" },
  { key: "mn_equivalency", label: "MN equivalency", kind: "num" },
  { key: "dd_w_a", label: "dd w a", kind: "num" },
  { key: "associated_tasks", label: "Associated tasks / notes", kind: "area", wide: true },
];

// Build a string-valued form snapshot from a record (or empty), defaulting the
// name to the mentee's CA name when there's no saved record yet.
function recordToForm(rec: MenteeRecord | undefined, defaultName: string): Record<string, string> {
  const f: Record<string, string> = {};
  for (const fld of RECORD_FIELDS) {
    const v = rec ? (rec[fld.key as keyof MenteeRecord] as unknown) : undefined;
    f[fld.key] = v == null ? "" : String(v);
  }
  if (!f.name) f.name = defaultName;
  return f;
}

// Editable "source of truth" card for the selected mentee (the `mentees` table,
// mirrored from Notion). Sits below the timeline in the Journeys detail pane.
function MenteeRecordCard({
  clientId,
  defaultName,
  record,
  userId,
  onSaved,
  onError,
}: {
  clientId: number;
  defaultName: string;
  record: MenteeRecord | undefined;
  userId: string;
  onSaved: (rec: MenteeRecord) => void;
  onError: (m: string) => void;
}) {
  const baseline = useMemo(() => recordToForm(record, defaultName), [record, defaultName]);
  const [form, setForm] = useState<Record<string, string>>(baseline);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Re-sync the form to the record (e.g. after a save re-baselines to the saved
  // values). The card is keyed by clientId in the parent, so a mentee switch
  // remounts with a fresh form rather than relying on this. `justSaved` is left
  // alone here so the "Saved ✓" confirmation survives the post-save re-baseline.
  useEffect(() => {
    setForm(baseline);
  }, [baseline]);

  const dirty = useMemo(() => RECORD_FIELDS.some((f) => (form[f.key] ?? "") !== (baseline[f.key] ?? "")), [form, baseline]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setJustSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      const edits: MenteeRecordEdit = {};
      for (const fld of RECORD_FIELDS) {
        const raw = (form[fld.key] ?? "").trim();
        if (fld.kind === "num") {
          const n = raw === "" ? null : Number(raw);
          (edits as Record<string, unknown>)[fld.key] = raw !== "" && Number.isNaN(n) ? null : n;
        } else {
          (edits as Record<string, unknown>)[fld.key] = raw === "" ? null : raw;
        }
      }
      const name = (edits.name as string | null) || defaultName;
      edits.name = name;
      const rec = await saveMenteeRecord(userId, clientId, name, edits);
      onSaved(rec);
      setJustSaved(true);
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card--inset mentee-record">
      <div className="mentee-record__head">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Mentee record — source of truth <HelpButton id="journeys.menteeRecord" label="Mentee record" />
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {record ? "Mirrored from Notion; edits here are saved to the dashboard." : "No saved record yet — fill in and save to create one."}
        </span>
      </div>
      <div className="mentee-record__grid">
        {RECORD_FIELDS.map((fld) => (
          <label key={fld.key} className={`mentee-record__field ${fld.wide ? "mentee-record__field--wide" : ""}`}>
            <span>{fld.label}</span>
            {fld.kind === "area" ? (
              <textarea rows={3} value={form[fld.key] ?? ""} onChange={(e) => set(fld.key, e.target.value)} />
            ) : (
              <input
                type={fld.kind === "date" ? "date" : fld.kind === "num" ? "number" : "text"}
                step={fld.kind === "num" ? "any" : undefined}
                value={form[fld.key] ?? ""}
                onChange={(e) => set(fld.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <div className="mentee-record__actions">
        <button className="btn btn--primary btn--sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : record ? "Save changes" : "Create record"}
        </button>
        {justSaved && !dirty && <span className="muted" style={{ fontSize: 12 }}>Saved ✓</span>}
      </div>
    </div>
  );
}

export function JourneysView() {
  const { user } = useAuth();
  const [journeys, setJourneys] = useState<MenteeJourney[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageBasis, setStageBasis] = useState<StageBasis>("engagement_start");
  const [stageColors, setStageColors] = useState<string[]>(DEFAULT_STAGE_COLORS);
  const [records, setRecords] = useState<Map<number, MenteeRecord>>(new Map());
  // Default to the Mentees source-of-truth roster only (JYF / 4x / 2x / 1x). Off
  // shows CA's other pipelines too (greyed). Metrics always exclude off-roster.
  const [rosterOnly, setRosterOnly] = useState(true);

  async function load(basis: StageBasis) {
    setLoading(true);
    setError(null);
    try {
      const js = await fetchMenteeJourneys(basis);
      setJourneys(js);
      setSelected((cur) => cur ?? js[0]?.clientId ?? null);
    } catch (e) {
      setError(String(e));
    }
    // Source-of-truth records load separately so a not-yet-applied 9986 migration
    // (missing `mentees` table) doesn't break the rest of the Journeys tab.
    try {
      setRecords(await fetchMenteeRecordsByClient());
    } catch (e) {
      // Most likely the 9986 migration isn't applied yet (no `mentees` table); the
      // card just shows the empty/create state. Warn so a real error is still visible.
      console.warn("Mentee source-of-truth records unavailable:", e);
    }
    setLoading(false);
  }

  // Reflect a saved record immediately, without a full reload.
  function handleRecordSaved(rec: MenteeRecord) {
    if (rec.client_id == null) return;
    setRecords((prev) => new Map(prev).set(rec.client_id as number, rec));
  }

  // On mount, read the org-wide stage-date basis (Company options), then load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let basis: StageBasis = "engagement_start";
      try {
        const opts = await fetchCompanyOptions();
        const v = opts["journeys_stage_basis"];
        if (v === "first_meeting" || v === "engagement_start") basis = v;
        if (!cancelled) setStageColors(stageColorsFromRaw(opts["journeys_stage_colors"]));
      } catch {
        /* fall back to the default basis + colors */
      }
      if (cancelled) return;
      setStageBasis(basis);
      await load(basis);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flip the stage-date basis. Persists org-wide (same app_settings key the
  // Company options tab edits), then reloads with the new basis.
  async function changeBasis(basis: StageBasis) {
    if (basis === stageBasis) return;
    setStageBasis(basis);
    try {
      await setCompanyOption("journeys_stage_basis", basis);
    } catch (e) {
      setError(String(e));
    }
    await load(basis);
  }

  const offRosterCount = useMemo(() => journeys.filter((j) => !j.inSourceOfTruth).length, [journeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rosterOnly ? journeys.filter((j) => j.inSourceOfTruth) : journeys;
    if (q) list = list.filter((j) => j.name.toLowerCase().includes(q));
    return list;
  }, [journeys, search, rosterOnly]);

  const current = journeys.find((j) => j.clientId === selected) ?? null;

  return (
    <section className="card">
      <h2>Mentee journeys</h2>
      <p className="view__hint">
        Each mentee’s path through the pipeline — Discovery → JumpStart → 4x → 2x → 1x → Graduation — with how long each
        leg took. Pick a mentee to see their timeline. (Stages come from CoachAccountable engagements; graduation from an
        “After Graduation Care” engagement. A mentee can take an <strong>alternative exit at any stage</strong> — Quit,
        Fired, or No mentoring — set in the editor below; the rail then ends in that exit instead of Graduation.)
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px", flexWrap: "wrap" }}>
        <span className="muted">Stage dates from:</span>
        <div className="seg" role="tablist" aria-label="Stage-date basis">
          <button
            className={`seg__btn ${stageBasis === "engagement_start" ? "seg__btn--active" : ""}`}
            onClick={() => changeBasis("engagement_start")}
          >
            Engagement start
          </button>
          <button
            className={`seg__btn ${stageBasis === "first_meeting" ? "seg__btn--active" : ""}`}
            onClick={() => changeBasis("first_meeting")}
          >
            First 1-on-1 meeting
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          · org-wide setting (also in Company options)
        </span>
      </div>

      {error && <div className="notice notice--warn">{error}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          {journeys.length > 0 && <PipelineSummary journeys={journeys} />}
          {journeys.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <MenteeStatusEditor
                journeys={journeys}
                selectedClientId={selected}
                onSelect={setSelected}
                userId={user?.id ?? ""}
                onSaved={() => load(stageBasis)}
                onError={setError}
              />
            </div>
          )}
          <div className="journeys">
          <div className="journeys__list">
            <input
              type="search"
              className="journeys__search"
              placeholder={`Search ${filtered.length} mentees…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="journeys__roster-toggle" title="Show only mentees in the Mentees source-of-truth roster (JYF / 4x / 2x / 1x). Off shows CA's other pipelines too.">
              <input type="checkbox" checked={rosterOnly} onChange={(e) => setRosterOnly(e.target.checked)} />
              <span>Roster only{offRosterCount > 0 ? ` (${offRosterCount} off-roster hidden)` : ""}</span>
            </label>
            <div className="journeys__rows">
              {filtered.map((j) => (
                <button
                  key={j.clientId}
                  className={`journeys__row ${j.clientId === selected ? "journeys__row--active" : ""} ${
                    j.excluded || !j.inSourceOfTruth ? "journeys__row--excluded" : ""
                  }`}
                  onClick={() => setSelected(j.clientId)}
                  title={j.excluded ? "Excluded from metrics" : !j.inSourceOfTruth ? "Off-roster — not in the Mentees source of truth; excluded from metrics" : undefined}
                >
                  <span className="journeys__row-name">{j.name}</span>
                  <span className="journeys__row-meta">
                    {j.excluded ? (
                      <span className="pill">excluded</span>
                    ) : !j.inSourceOfTruth ? (
                      <span className="pill">off-roster</span>
                    ) : (
                      <StatusPill status={j.resolvedStatus} />
                    )}
                    <span className="muted">{j.lastMeeting ?? "—"}</span>
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="muted" style={{ padding: 12 }}>No mentees match “{search}”.</div>}
            </div>
          </div>
          <div className="journeys__detail">
            {current ? (
              <>
                <Timeline journey={current} userId={user?.id ?? ""} colors={stageColors} onSaved={() => load(stageBasis)} onError={setError} />
                <MenteeRecordCard
                  key={current.clientId}
                  clientId={current.clientId}
                  defaultName={current.name}
                  record={records.get(current.clientId)}
                  userId={user?.id ?? ""}
                  onSaved={handleRecordSaved}
                  onError={setError}
                />
              </>
            ) : (
              <div className="muted" style={{ padding: 24 }}>Select a mentee to view their journey.</div>
            )}
          </div>
          </div>
        </>
      )}
    </section>
  );
}
