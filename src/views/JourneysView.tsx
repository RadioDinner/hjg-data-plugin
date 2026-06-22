import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../auth";
import {
  MENTEE_ACTIVE_WINDOW_DAYS,
  aggregateJourneyDurations,
  clearMenteeOutcome,
  fetchCompanyOptions,
  fetchMenteeJourneys,
  setCompanyOption,
  setMenteeOutcome,
  type MenteeJourney,
  type MenteeStatus,
  type PipelineTier,
  type ResolvedMenteeStatus,
  type StageBasis,
} from "../db";
import { HelpButton } from "../components/HelpDrawer";

const TIER_LABEL: Record<PipelineTier, string> = { jumpstart: "JumpStart", "4x": "4x", "2x": "2x", "1x": "1x", graduated: "Graduated" };

// Whole days from a to b (YYYY-MM-DD), for stage-gap labels.
function spanDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const AXIS = "#94a3b8";
const GRID = "#1e293b";
const TOOLTIP = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" };
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
// previous node rendered on the connector.
function StageNode({ label, date, gap }: { label: string; date: string | null; gap?: string }) {
  return (
    <div className="stage">
      {gap !== undefined && <div className="stage__gap">{gap}</div>}
      <div className={`stage__node ${date ? "" : "stage__node--empty"}`}>
        <span className="stage__dot" />
        <span className="stage__label">{label}</span>
        <span className="stage__date">{date ?? "—"}</span>
      </div>
    </div>
  );
}

function Timeline({ journey, userId, onSaved, onError }: { journey: MenteeJourney; userId: string; onSaved: () => void; onError: (m: string) => void }) {
  const [status, setStatus] = useState<MenteeStatus | "">(journey.override ?? "");
  const [date, setDate] = useState(journey.overrideDate ?? "");
  const [notes, setNotes] = useState(journey.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

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

  // Observed meeting rhythm: meetings per calendar month across the engagement.
  const rhythm = useMemo(() => {
    const m = new Map<string, number>();
    for (const mt of journey.meetings) {
      const k = mt.date.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, count]) => {
      const [y, mo] = k.split("-").map(Number);
      return { month: `${SHORT[mo - 1]} ’${String(y).slice(2)}`, Meetings: count };
    });
  }, [journey.meetings]);

  return (
    <div className="journey">
      <div className="journey__head">
        <div>
          <h2>{journey.name}</h2>
          <div className="journey__sub muted">
            {journey.meetingCount} meeting{journey.meetingCount === 1 ? "" : "s"}
            {journey.engagementIds.length > 1 && <> · {journey.engagementIds.length} engagements</>}
          </div>
        </div>
        <StatusPill status={journey.resolvedStatus} />
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
        <StageNode label="Discovery" date={journey.discoveryDate} />
        <StageNode label="JumpStart" date={journey.stageDates.jumpstart} gap={humanizeDays(spanDays(journey.discoveryDate, journey.stageDates.jumpstart))} />
        <StageNode label="4x mentoring" date={journey.stageDates["4x"]} gap={humanizeDays(spanDays(journey.stageDates.jumpstart, journey.stageDates["4x"]))} />
        <StageNode label="2x mentoring" date={journey.stageDates["2x"]} gap={humanizeDays(spanDays(journey.stageDates["4x"], journey.stageDates["2x"]))} />
        <StageNode label="1x mentoring" date={journey.stageDates["1x"]} gap={humanizeDays(spanDays(journey.stageDates["2x"], journey.stageDates["1x"]))} />
        <StageNode label="Graduation" date={journey.stageDates.graduated} gap={humanizeDays(spanDays(journey.stageDates["1x"], journey.stageDates.graduated))} />
      </div>

      <div className="journey__rhythm">
        <div className="journey__rhythm-head">
          <h3>Observed meeting rhythm</h3>
          <span className="muted">Meetings per month — actual meeting cadence (the tier comes from the engagement, shown above).</span>
        </div>
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rhythm}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} width={24} tick={{ fill: AXIS, fontSize: 11 }} stroke={GRID} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Bar dataKey="Meetings" fill="#a78bfa" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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

function LegTooltip({ active, payload }: { active?: boolean; payload?: { payload: { leg: string; avg: number | null; median: number | null; n: number } }[] }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP, padding: "6px 10px", fontSize: 13 }}>
      <div style={{ marginBottom: 4 }}>{p.leg}</div>
      <div>Average: {humanizeDays(p.avg)}</div>
      <div>Median: {humanizeDays(p.median)}</div>
      <div className="muted" style={{ marginTop: 2 }}>n = {p.n} mentees</div>
    </div>
  );
}

// Board-level roll-up of the pipeline-leg durations across every mentee.
function PipelineSummary({ journeys }: { journeys: MenteeJourney[] }) {
  const legs = useMemo(() => aggregateJourneyDurations(journeys), [journeys]);
  const counts = useMemo(() => {
    let active = 0;
    let graduated = 0;
    for (const j of journeys) {
      if (j.resolvedStatus === "active") active++;
      if (j.resolvedStatus === "graduated") graduated++;
    }
    return { total: journeys.length, active, graduated };
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
              <Tooltip content={<LegTooltip />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
              <Bar dataKey="avg" fill="#38bdf8" radius={[0, 3, 3, 0]} />
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

export function JourneysView() {
  const { user } = useAuth();
  const [journeys, setJourneys] = useState<MenteeJourney[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageBasis, setStageBasis] = useState<StageBasis>("engagement_start");

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
    setLoading(false);
  }

  // On mount, read the org-wide stage-date basis (Company options), then load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let basis: StageBasis = "engagement_start";
      try {
        const v = (await fetchCompanyOptions())["journeys_stage_basis"];
        if (v === "first_meeting" || v === "engagement_start") basis = v;
      } catch {
        /* fall back to the default basis */
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
                  className={`journeys__row ${j.clientId === selected ? "journeys__row--active" : ""}`}
                  onClick={() => setSelected(j.clientId)}
                >
                  <span className="journeys__row-name">{j.name}</span>
                  <span className="journeys__row-meta">
                    <StatusPill status={j.resolvedStatus} />
                    <span className="muted">{j.lastMeeting ?? "—"}</span>
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <div className="muted" style={{ padding: 12 }}>No mentees match “{search}”.</div>}
            </div>
          </div>
          <div className="journeys__detail">
            {current ? (
              <Timeline journey={current} userId={user?.id ?? ""} onSaved={() => load(stageBasis)} onError={setError} />
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
