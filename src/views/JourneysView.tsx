import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../auth";
import {
  MENTEE_ACTIVE_WINDOW_DAYS,
  addMenteeExclusion,
  aggregateJourneyDurations,
  clearMenteeOutcome,
  fetchCompanyOptions,
  fetchMenteeJourneys,
  fetchMenteeRecordsByClient,
  removeMenteeExclusion,
  saveMenteeRecord,
  setCompanyOption,
  setMenteeOutcome,
  stageColorsFromRaw,
  DEFAULT_STAGE_COLORS,
  type MenteeJourney,
  type MenteeRecord,
  type MenteeRecordEdit,
  type MenteeStatus,
  type PipelineTier,
  type ResolvedMenteeStatus,
  type StageBasis,
} from "../db";
import { HelpButton } from "../components/HelpDrawer";
import { useChartTokens } from "../theme";

const TIER_LABEL: Record<PipelineTier, string> = { jumpstart: "JumpStart", "4x": "4x", "2x": "2x", "1x": "1x", graduated: "Graduated" };

// Stage-palette index for each pipeline tier. The `colors` prop is in stage order:
// 0 Discovery, 1 JumpStart, 2 4x, 3 2x, 4 1x, 5 Graduation — so a meeting's tier
// reuses the exact color its stage shows on the rail.
const TIER_COLOR_INDEX: Record<PipelineTier, number> = { jumpstart: 1, "4x": 2, "2x": 3, "1x": 4, graduated: 5 };
// Meeting-rhythm stack order, bottom→top: pipeline progression reads red→green
// upward, matching the rail. "Other" (below) sits underneath as a neutral base.
const RHYTHM_TIERS: PipelineTier[] = ["jumpstart", "4x", "2x", "1x", "graduated"];
// Meetings with no resolvable pipeline tier (group sessions / untiered) — neutral grey.
const OTHER_TIER_COLOR = "#94a3b8";

// Whole days from a to b (YYYY-MM-DD), for stage-gap labels.
function spanDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type ChartStyle = { background: string; border: string; borderRadius: number; color: string };
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_LABEL: Record<ResolvedMenteeStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  quit: "Quit",
  fired: "Fired",
  inactive: "Inactive",
};

const OVERRIDE_OPTIONS: { value: MenteeStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "graduated", label: "Graduated" },
  { value: "quit", label: "Quit" },
  { value: "fired", label: "Fired" },
];

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

// One node on the horizontal stage rail (a date marker), with the gap to the
// previous node rendered on the connector. `color` is this stage's configured
// color (Company options → Journeys → Pipeline stage colors); a reached stage
// shows it solid, an unreached stage stays muted.
function StageNode({ label, date, gap, color }: { label: string; date: string | null; gap?: string; color: string }) {
  const reached = !!date;
  return (
    <div className="stage">
      {gap !== undefined && <div className="stage__gap">{gap}</div>}
      <div
        className={`stage__node ${reached ? "" : "stage__node--empty"}`}
        style={reached ? { borderTopColor: color } : undefined}
      >
        <span className="stage__dot" style={reached ? { background: color, borderColor: color } : undefined} />
        <span className="stage__label" style={reached ? { color } : undefined}>
          {label}
        </span>
        <span className="stage__date">{date ?? "—"}</span>
      </div>
    </div>
  );
}

// Tooltip for the per-tier meeting-rhythm chart: lists only the tiers present
// that month (with their swatch) plus the month total.
function RhythmTooltip({
  active,
  payload,
  label,
  tip,
}: {
  active?: boolean;
  payload?: { name: string; dataKey: string; value: number; color: string; payload: { total: number } }[];
  label?: string;
  tip?: ChartStyle;
}) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload.filter((p) => p.value > 0);
  const total = payload[0]?.payload?.total ?? rows.reduce((s, p) => s + p.value, 0);
  return (
    <div style={{ ...tip, padding: "6px 10px", fontSize: 13 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, display: "inline-block" }} />
          {p.name}: {p.value}
        </div>
      ))}
      <div className="muted" style={{ marginTop: 2 }}>Total: {total}</div>
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
  const [status, setStatus] = useState<MenteeStatus | "">(journey.override ?? "");
  const [date, setDate] = useState(journey.overrideDate ?? "");
  const [notes, setNotes] = useState(journey.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const ct = useChartTokens();
  const AXIS = ct.axis;
  const GRID = ct.grid;
  const TOOLTIP: ChartStyle = { background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 6, color: ct.tooltipText };

  // Reset the editor when a different mentee is selected.
  useEffect(() => {
    setStatus(journey.override ?? "");
    setDate(journey.overrideDate ?? "");
    setNotes(journey.notes ?? "");
  }, [journey.clientId, journey.override, journey.overrideDate, journey.notes]);

  const dirty = (journey.override ?? "") !== status || (journey.overrideDate ?? "") !== date || (journey.notes ?? "") !== notes;
  const canSave = status !== "" && dirty && !saving;

  async function save() {
    if (status === "") return;
    setSaving(true);
    try {
      await setMenteeOutcome(userId, journey.clientId, { status, statusDate: date || null, notes: notes || null });
      onSaved();
    } catch (e) {
      onError(String(e));
      setSaving(false);
    }
  }
  async function clearOverride() {
    setClearing(true);
    try {
      await clearMenteeOutcome(journey.clientId);
      onSaved();
    } catch (e) {
      onError(String(e));
      setClearing(false);
    }
  }
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

  // Observed meeting rhythm: meetings per calendar month, split by the pipeline
  // tier of each meeting (its engagement's tier) so the column shows how a
  // mentee's meetings distribute across stages over time. Untiered/group meetings
  // fall into "other".
  const rhythm = useMemo(() => {
    type Row = Record<PipelineTier, number> & { other: number; total: number };
    const m = new Map<string, Row>();
    for (const mt of journey.meetings) {
      const k = mt.date.slice(0, 7);
      let row = m.get(k);
      if (!row) {
        row = { jumpstart: 0, "4x": 0, "2x": 0, "1x": 0, graduated: 0, other: 0, total: 0 };
        m.set(k, row);
      }
      if (mt.tier) row[mt.tier] += 1;
      else row.other += 1;
      row.total += 1;
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, row]) => {
      const [y, mo] = k.split("-").map(Number);
      return { month: `${SHORT[mo - 1]} ’${String(y).slice(2)}`, ...row };
    });
  }, [journey.meetings]);

  // Which tiers / "other" actually occur — drives the legend and table columns so
  // empty buckets don't clutter the view.
  const presentTiers = useMemo(() => RHYTHM_TIERS.filter((t) => rhythm.some((r) => r[t] > 0)), [rhythm]);
  const hasOther = useMemo(() => rhythm.some((r) => r.other > 0), [rhythm]);

  return (
    <div className="journey">
      <div className="journey__head">
        <div>
          <h2>
            {journey.name}
            {journey.excluded && <span className="pill" style={{ marginLeft: 8 }}>excluded</span>}
          </h2>
          <div className="journey__sub muted">
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
        <StageNode label="Graduation" date={journey.stageDates.graduated} gap={humanizeDays(spanDays(journey.stageDates["1x"], journey.stageDates.graduated))} color={colors[5]} />
      </div>

      <div className="journey__rhythm">
        <div className="journey__rhythm-head">
          <h3>Observed meeting rhythm</h3>
          <span className="muted">
            Meetings per month, colored by the pipeline tier of each meeting — see how a mentee’s meetings distribute
            across stages over time (the tier comes from the engagement).
          </span>
        </div>

        {(presentTiers.length > 0 || hasOther) && (
          <div className="rhythm-legend">
            {presentTiers.map((t) => (
              <span key={t} className="rhythm-legend__item">
                <span className="rhythm-legend__swatch" style={{ background: colors[TIER_COLOR_INDEX[t]] }} />
                {TIER_LABEL[t]}
              </span>
            ))}
            {hasOther && (
              <span className="rhythm-legend__item">
                <span className="rhythm-legend__swatch" style={{ background: OTHER_TIER_COLOR }} />
                Other
              </span>
            )}
          </div>
        )}

        <div className="chart-card__split chart-card__split--both">
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rhythm}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} width={24} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
                <Tooltip content={<RhythmTooltip tip={TOOLTIP} />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                <Bar dataKey="other" stackId="r" fill={OTHER_TIER_COLOR} name="Other" />
                <Bar dataKey="jumpstart" stackId="r" fill={colors[1]} name="JumpStart" />
                <Bar dataKey="4x" stackId="r" fill={colors[2]} name="4x" />
                <Bar dataKey="2x" stackId="r" fill={colors[3]} name="2x" />
                <Bar dataKey="1x" stackId="r" fill={colors[4]} name="1x" />
                <Bar dataKey="graduated" stackId="r" fill={colors[5]} name="Graduated" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {rhythm.length > 0 && (
            <div className="table-scroll" style={{ width: "100%" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    {presentTiers.map((t) => (
                      <th key={t}>{TIER_LABEL[t]}</th>
                    ))}
                    {hasOther && <th>Other</th>}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rhythm.map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      {presentTiers.map((t) => (
                        <td key={t} className="num">
                          {r[t] || "—"}
                        </td>
                      ))}
                      {hasOther && <td className="num">{r.other || "—"}</td>}
                      <td className="num">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="journey__status card card--inset">
        <h3>Pipeline status</h3>
        <p className="view__hint">
          Inferred from activity (active if a meeting in the last {MENTEE_ACTIVE_WINDOW_DAYS} days, otherwise inactive). Set
          the real outcome here — quit or fired can happen at any stage, so record the date it ended. Clear to revert to
          automatic.
        </p>
        <div className="journey__status-row">
          <label>
            Outcome
            <select value={status} onChange={(e) => setStatus(e.target.value as MenteeStatus | "")}>
              <option value="">Auto ({STATUS_LABEL[journey.resolvedStatus]})</option>
              {OVERRIDE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ended on
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={status === "active"} />
          </label>
          <label className="journey__notes">
            Notes
            <input type="text" value={notes} placeholder="e.g. moved away, couldn’t afford it" onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="journey__status-actions">
            <button className="btn btn--primary btn--sm" onClick={save} disabled={!canSave}>
              {saving ? "Saving…" : journey.overrideId ? "Update" : "Save"}
            </button>
            {journey.overrideId && (
              <button className="btn btn--sm" onClick={clearOverride} disabled={clearing}>
                {clearing ? "…" : "Clear"}
              </button>
            )}
          </div>
        </div>
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
  const legs = useMemo(() => aggregateJourneyDurations(journeys), [journeys]);
  const counts = useMemo(() => {
    let active = 0;
    let graduated = 0;
    let total = 0;
    let excluded = 0;
    for (const j of journeys) {
      if (j.excluded) {
        excluded++;
        continue; // excluded mentees don't count toward the board roll-up
      }
      total++;
      if (j.resolvedStatus === "active") active++;
      if (j.resolvedStatus === "graduated") graduated++;
    }
    return { total, active, graduated, excluded };
  }, [journeys]);
  const grad = legs.find((l) => l.key === "dc_grad");
  const chartData = legs.map((l) => ({ leg: l.label, avg: l.avgDays, median: l.medianDays, n: l.n }));

  return (
    <div className="card card--inset" style={{ marginBottom: 18 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Pipeline timing — all mentees <HelpButton id="journeys.aggregate" label="Pipeline timing" />
      </h2>
      <p className="view__hint">
        Average time each leg of the journey takes, across every mentee where both ends are known (n shown per leg).
        Stages come from CoachAccountable engagements (JumpStart → 4x → 2x → 1x), and graduation from an “After Graduation
        Care” engagement.
        {counts.excluded > 0 && (
          <> · {counts.excluded} mentee{counts.excluded === 1 ? "" : "s"} excluded from these figures.</>
        )}
      </p>
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? journeys.filter((j) => j.name.toLowerCase().includes(q)) : journeys;
  }, [journeys, search]);

  const current = journeys.find((j) => j.clientId === selected) ?? null;

  return (
    <section className="card">
      <h2>Mentee journeys</h2>
      <p className="view__hint">
        Each mentee’s path through the pipeline — Discovery → JumpStart → 4x → 2x → 1x → Graduation — with how long each
        leg took. Pick a mentee to see their timeline. (Stages come from CoachAccountable engagements; graduation from an
        “After Graduation Care” engagement. Exit status can still be overridden for quits/fires.)
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
          <div className="journeys">
          <div className="journeys__list">
            <input
              type="search"
              className="journeys__search"
              placeholder={`Search ${journeys.length} mentees…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="journeys__rows">
              {filtered.map((j) => (
                <button
                  key={j.clientId}
                  className={`journeys__row ${j.clientId === selected ? "journeys__row--active" : ""} ${
                    j.excluded ? "journeys__row--excluded" : ""
                  }`}
                  onClick={() => setSelected(j.clientId)}
                  title={j.excluded ? "Excluded from metrics" : undefined}
                >
                  <span className="journeys__row-name">{j.name}</span>
                  <span className="journeys__row-meta">
                    {j.excluded ? <span className="pill">excluded</span> : <StatusPill status={j.resolvedStatus} />}
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
