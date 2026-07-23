import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import {
  fetchMentees,
  saveMenteeHand,
  createMentee,
  rebuildMenteesFromCa,
  fetchMenteeMeetings,
  fetchMenteeEngagements,
  fetchCompanyOptions,
  stageColorsFromRaw,
  toEffectiveMentee,
  mapNotionStatus,
  DEFAULT_STAGE_COLORS,
  MENTEE_STATUSES,
  type MenteeRow,
  type MenteeHandEdit,
  type MenteeMgmtStatus,
  type EffectiveMentee,
  type MenteeMeetingLite,
  type MenteeEngagementLite,
  type NotionImportResult,
} from "../db";
import { SortableTable, type SortColumn, type Row } from "../components/SortableTable";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";
import { CollapsibleCard } from "../components/Collapsible";
import { NotionImportModal } from "../components/NotionImportModal";
import { fmtDate } from "../format";

// The per-mentee rail: the 6 canonical pipeline stages (Discovery … Graduation),
// matched to the 6-color journeys_stage_colors palette. (pre_waiting is a rare
// holding stage shown on the funnel, not the individual rail.)
const STAGES: { key: string; label: string; colorIndex: number; reached: (m: EffectiveMentee) => string | null }[] = [
  { key: "discovery", label: "Discovery", colorIndex: 0, reached: (m) => m.discoveryDate },
  { key: "jumpstart", label: "JumpStart", colorIndex: 1, reached: (m) => m.jumpstartDate },
  { key: "4x", label: "4x", colorIndex: 2, reached: (m) => m.tier4xDate },
  { key: "2x", label: "2x", colorIndex: 3, reached: (m) => m.tier2xDate },
  { key: "1x", label: "1x", colorIndex: 4, reached: (m) => m.tier1xDate },
  { key: "graduated", label: "Graduated", colorIndex: 5, reached: (m) => m.graduationDate },
];

const STATUS_LABELS: Record<MenteeMgmtStatus, string> = {
  active: "Active", graduated: "Graduated", quit: "Quit", fired: "Fired", no_mentoring: "No mentoring", declined: "Declined", imn: "IMN",
};
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— Unclassified (use Notion / CA) —" },
  ...MENTEE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];
const STATUS_STAGE_OPTIONS = ["", "pre_waiting", "discovery", "jumpstart", "4x", "2x", "1x"];

// First-class roster status filter (on the effective resolved status).
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "active", label: "Active" },
  { value: "graduated", label: "Graduated" },
  { value: "declined", label: "Declined" },
  { value: "quit", label: "Quit" },
  { value: "fired", label: "Fired" },
  { value: "no_mentoring", label: "No mentoring" },
  { value: "imn", label: "IMN" },
  { value: "inactive", label: "Unclassified" },
];
const STAGE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "pre_waiting", label: "Pre-Waiting" },
  { value: "discovery", label: "Discovery" },
  { value: "jumpstart", label: "JumpStart" },
  { value: "4x", label: "4x" },
  { value: "2x", label: "2x" },
  { value: "1x", label: "1x" },
  { value: "graduated", label: "Graduated" },
];

function pillClass(m: EffectiveMentee): string {
  const s = m.effectiveStatus ?? (m.caStatus === "graduated" ? "graduated" : m.caStatus === "active" ? "active" : "inactive");
  return `pill pill--mentee-${s}`;
}

// The stage-date override fields, paired with their CA value for the hint.
const DATE_FIELDS: { key: keyof MenteeHandEdit; label: string; ca?: keyof MenteeRow }[] = [
  { key: "pre_waiting_date_override", label: "Pre-Waiting" },
  { key: "discovery_date_override", label: "Discovery", ca: "ca_discovery_date" },
  { key: "jumpstart_date_override", label: "JumpStart", ca: "ca_jumpstart_date" },
  { key: "tier_4x_date_override", label: "4x", ca: "ca_tier_4x_date" },
  { key: "tier_2x_date_override", label: "2x", ca: "ca_tier_2x_date" },
  { key: "tier_1x_date_override", label: "1x", ca: "ca_tier_1x_date" },
  { key: "graduation_date_override", label: "Graduation", ca: "ca_graduation_date" },
];

// Build the hand-zone draft from a row (only the editable fields).
function draftFromRow(r: MenteeRow): MenteeHandEdit {
  return {
    name_override: r.name_override ?? "",
    status: r.status,
    status_stage: r.status_stage,
    status_date: r.status_date,
    pre_waiting_date_override: r.pre_waiting_date_override,
    discovery_date_override: r.discovery_date_override,
    jumpstart_date_override: r.jumpstart_date_override,
    tier_4x_date_override: r.tier_4x_date_override,
    tier_2x_date_override: r.tier_2x_date_override,
    tier_1x_date_override: r.tier_1x_date_override,
    graduation_date_override: r.graduation_date_override,
    email_override: r.email_override ?? "",
    phone_override: r.phone_override ?? "",
    coach_override: r.coach_override ?? "",
    notes: r.notes ?? "",
    is_test: r.is_test,
  };
}

export function MenteesView() {
  const { user } = useAuth();
  const [rows, setRows] = useState<MenteeRow[]>([]);
  const [stageColors, setStageColors] = useState<string[]>(DEFAULT_STAGE_COLORS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [stageF, setStageF] = useState<string>("all");
  const [ownerF, setOwnerF] = useState<string>("all");
  const [hideTest, setHideTest] = useState(true);
  const [conflictsOnly, setConflictsOnly] = useState(false);

  // Selection + detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MenteeHandEdit>({});
  const [saving, setSaving] = useState(false);
  const [meetings, setMeetings] = useState<MenteeMeetingLite[]>([]);
  const [engagements, setEngagements] = useState<MenteeEngagementLite[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Inline roster editing: an uncontrolled-ish buffer for the free-text Coach
  // cells, keyed by row id and committed on blur (selects/dates commit on change).
  const [coachBuffer, setCoachBuffer] = useState<Record<string, string>>({});

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchMentees();
      setRows(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetchCompanyOptions()
      .then((o) => setStageColors(stageColorsFromRaw(o.journeys_stage_colors)))
      .catch(() => setStageColors(DEFAULT_STAGE_COLORS));
  }, []);

  // Effective view-models, keyed by row id.
  const effById = useMemo(() => {
    const m = new Map<string, EffectiveMentee>();
    for (const r of rows) m.set(r.id, toEffectiveMentee(r, today));
    return m;
  }, [rows, today]);
  const effective = useMemo(() => [...effById.values()], [effById]);

  const owners = useMemo(() => {
    const s = new Set<string>();
    for (const m of effective) if (!m.isTest && m.ownerCoachName) s.add(m.ownerCoachName);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [effective]);

  const conflictCount = useMemo(() => effective.filter((m) => !m.isTest && (m.conflicts.length > 0 || m.coarseExit)).length, [effective]);

  // A reload (re-import / Rebuild from CA) can drop the selected coach from the
  // roster; reset the filter so the table doesn't silently show 0 rows.
  useEffect(() => {
    if (ownerF !== "all" && !owners.includes(ownerF)) setOwnerF("all");
  }, [owners, ownerF]);

  // Apply filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effective.filter((m) => {
      if (hideTest && m.isTest) return false;
      if (statusF !== "all" && m.resolvedStatus !== statusF) return false;
      if (stageF !== "all" && m.currentStage !== stageF) return false;
      if (ownerF !== "all" && m.ownerCoachName !== ownerF) return false;
      if (conflictsOnly && m.conflicts.length === 0 && !m.coarseExit) return false;
      if (q && !m.name.toLowerCase().includes(q) && !(m.ownerCoachName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [effective, search, statusF, stageF, ownerF, hideTest, conflictsOnly]);

  const columns: SortColumn[] = [
    {
      key: "name",
      label: "Mentee",
      format: (r: Row) => (
        <button
          className="linkbtn"
          onClick={() => setSelectedId(String(r._id))}
          title="Open to edit details on the right"
          style={selectedId === r._id ? { fontWeight: 700 } : undefined}
        >
          {String(r.name)}
          {r.conflict ? (
            <span className="pill" style={{ marginLeft: 6 }} title="CA / Notion / hand disagree, or a coarse Notion exit to classify">
              ⚠
            </span>
          ) : null}
          {r.test ? (
            <span className="pill" style={{ marginLeft: 6 }}>
              test
            </span>
          ) : null}
        </button>
      ),
    },
    {
      key: "status",
      label: "Status",
      // Inline-editable: sets the hand-zone status (overrides Notion/CA).
      format: (r: Row) => {
        const m = effById.get(String(r._id));
        if (!m) return String(r.status ?? "—");
        return (
          <select
            className="cell-edit"
            value={m.status ?? ""}
            onChange={(e) => inlineSave(m.id, { status: (e.target.value || null) as MenteeMgmtStatus | null })}
            title="Hand-zone status (wins over Notion/CA). Blank = use the auto-derived value."
          >
            <option value="">{m.status == null ? `— ${m.statusLabel} (auto) —` : "— Unclassified —"}</option>
            {MENTEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        );
      },
    },
    { key: "stage", label: "Stage" },
    {
      key: "coach",
      label: "Coach",
      // Inline-editable free text: writes coach_override on blur when changed.
      format: (r: Row) => {
        const m = effById.get(String(r._id));
        if (!m) return String(r.coach ?? "—");
        const eff = m.ownerCoachName ?? "";
        const val = coachBuffer[m.id] ?? eff;
        return (
          <input
            className="cell-edit"
            value={val}
            placeholder="—"
            onChange={(e) => setCoachBuffer((b) => ({ ...b, [m.id]: e.target.value }))}
            onBlur={() => commitCoach(m.id, eff)}
            title="Coach override (hand zone). Blank reverts to Notion/CA."
          />
        );
      },
    },
    { key: "notionStatus", label: "Notion status" },
    {
      key: "discovery",
      label: "Discovery",
      // Inline-editable date: writes discovery_date_override on change.
      format: (r: Row) => {
        const m = effById.get(String(r._id));
        if (!m) return String(r.discovery ?? "—");
        return (
          <input
            type="date"
            className="cell-edit"
            value={m.discoveryDate ?? ""}
            onChange={(e) => inlineSave(m.id, { discovery_date_override: e.target.value || null })}
            title="Discovery-date override (hand zone). Blank reverts to Notion/CA."
          />
        );
      },
    },
    { key: "lastMeeting", label: "Last meeting" },
    { key: "meetings", label: "Meetings", numeric: true },
  ];

  const tableRows: Row[] = filtered.map((m) => ({
    _id: m.id,
    name: m.name,
    test: m.isTest,
    conflict: m.conflicts.length > 0 || m.coarseExit,
    status: m.statusLabel,
    stage: m.currentStage ? STAGE_FILTERS.find((s) => s.value === m.currentStage)?.label ?? m.currentStage : "—",
    coach: m.ownerCoachName ?? "—",
    notionStatus: m.notionStatus ?? "—",
    discovery: m.discoveryDate ?? "",
    lastMeeting: m.lastMeeting ?? "",
    meetings: m.meetingCount,
  }));

  const selectedRow = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const selectedEff = selectedId ? effById.get(selectedId) ?? null : null;

  // Load detail (meetings + engagements) when selection changes.
  useEffect(() => {
    if (!selectedRow) {
      setMeetings([]);
      setEngagements([]);
      return;
    }
    setDraft(draftFromRow(selectedRow));
    const clientId = selectedRow.client_id;
    if (clientId == null) {
      setMeetings([]);
      setEngagements([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([fetchMenteeMeetings(clientId), fetchMenteeEngagements(clientId)])
      .then(([m, e]) => {
        if (cancelled) return;
        setMeetings(m);
        setEngagements(e);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function setDraftField<K extends keyof MenteeHandEdit>(key: K, value: MenteeHandEdit[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!selectedRow) return;
    setSaving(true);
    try {
      // Normalize empties to null so blanks clear an override rather than store "".
      const edit: MenteeHandEdit = { ...draft };
      for (const k of Object.keys(edit) as (keyof MenteeHandEdit)[]) {
        if ((edit[k] as unknown) === "") (edit[k] as unknown) = null;
      }
      await saveMenteeHand(selectedRow.id, edit);
      await load();
      setNote("Saved ✓");
      setTimeout(() => setNote(null), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // Persist a single hand-zone edit from an inline roster cell. Optimistically
  // patches local state (so the effective view updates instantly), mirrors into
  // the open detail draft if it's the same mentee, then saves in the background.
  function inlineSave(id: string, patch: MenteeHandEdit) {
    const norm: MenteeHandEdit = { ...patch };
    for (const k of Object.keys(norm) as (keyof MenteeHandEdit)[]) {
      if ((norm[k] as unknown) === "") (norm[k] as unknown) = null;
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...norm } : r)));
    if (id === selectedId) setDraft((d) => ({ ...d, ...norm }));
    saveMenteeHand(id, norm)
      .then(() => {
        setNote("Saved ✓");
        setTimeout(() => setNote(null), 1500);
      })
      .catch((e) => {
        setError(String(e));
        load(); // resync from the server on failure
      });
  }

  // Commit a Coach cell on blur: only write coach_override when it actually
  // changed from the effective value (blank reverts to Notion/CA).
  function commitCoach(id: string, effCoach: string) {
    const v = (coachBuffer[id] ?? effCoach).trim();
    setCoachBuffer((b) => {
      const n = { ...b };
      delete n[id];
      return n;
    });
    if (v !== effCoach.trim()) inlineSave(id, { coach_override: v || null });
  }

  async function rebuild() {
    setRebuilding(true);
    try {
      const n = await rebuildMenteesFromCa();
      await load();
      setNote(`Rebuilt CA layer for ${n} mentees ✓`);
      setTimeout(() => setNote(null), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setRebuilding(false);
    }
  }

  async function addMentee() {
    const name = window.prompt("New mentee name (a hand-added prospect, not yet in CoachAccountable):");
    if (!name || !name.trim()) return;
    try {
      const created = await createMentee(user?.id ?? "", name.trim());
      await load();
      setSelectedId(created.id);
    } catch (e) {
      setError(String(e));
    }
  }

  function onImported(r: NotionImportResult) {
    setImporting(false);
    load();
    const amb = r.ambiguous.length ? ` · ${r.ambiguous.length} ambiguous (skipped: ${r.ambiguous.map((a) => a.name).join(", ")})` : "";
    setNote(`Imported Notion — ${r.updated} updated, ${r.inserted} added${amb}`);
    setTimeout(() => setNote(null), 6000);
  }

  // Three-source rows for the selected mentee's detail panel.
  const conflictFields = useMemo(() => new Set((selectedEff?.conflicts ?? []).map((c) => c.field)), [selectedEff]);
  type SourceRow = { field: string; label: string; ca: string | null; notion: string | null; eff: string | null; acceptCa?: () => void; acceptNotion?: () => void };
  const sources: SourceRow[] = selectedRow && selectedEff
    ? [
        { field: "name", label: "Name", ca: selectedRow.ca_name, notion: selectedRow.notion_name, eff: selectedEff.name, acceptCa: () => setDraftField("name_override", selectedRow.ca_name ?? ""), acceptNotion: () => setDraftField("name_override", selectedRow.notion_name ?? "") },
        { field: "coach", label: "Coach", ca: selectedRow.ca_owner_coach_name, notion: selectedRow.notion_coach, eff: selectedEff.ownerCoachName, acceptCa: () => setDraftField("coach_override", selectedRow.ca_owner_coach_name ?? ""), acceptNotion: () => setDraftField("coach_override", selectedRow.notion_coach ?? "") },
        { field: "email", label: "Email", ca: null, notion: selectedRow.notion_email, eff: selectedEff.email, acceptNotion: () => setDraftField("email_override", selectedRow.notion_email ?? "") },
        { field: "phone", label: "Phone", ca: null, notion: selectedRow.notion_phone, eff: selectedEff.phone, acceptNotion: () => setDraftField("phone_override", selectedRow.notion_phone ?? "") },
        { field: "discoveryDate", label: "Discovery date", ca: fmtDate(selectedRow.ca_discovery_date) || null, notion: fmtDate(selectedRow.notion_dc_date) || null, eff: fmtDate(selectedEff.discoveryDate) || null, acceptCa: () => setDraftField("discovery_date_override", selectedRow.ca_discovery_date), acceptNotion: () => setDraftField("discovery_date_override", selectedRow.notion_dc_date) },
        { field: "status", label: "Status", ca: selectedRow.ca_status, notion: selectedRow.notion_status, eff: selectedEff.statusLabel, acceptNotion: () => { const m = mapNotionStatus(selectedRow.notion_status); if (m) setDraftField("status", m.status); } },
      ]
    : [];

  return (
    <div className="view">
      <div className="view__header">
        <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Mentees <HelpButton id="mentees.screen" label="Mentee management" />
          <SectionId id="mentees.screen" />
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {note && <span className="pill pill--success">{note}</span>}
          <button className="btn btn--sm" onClick={() => setImporting(true)} title="Import a Notion Mentees Database CSV into the Notion zone (matched by name; never clobbers CA or your edits)">
            Import Notion CSV
          </button>
          <button className="btn btn--sm" onClick={addMentee}>
            + Add mentee
          </button>
          <button
            className="btn btn--sm"
            onClick={rebuild}
            disabled={rebuilding}
            title="Recompute the CA zone from the synced mirror (no CoachAccountable calls). Your hand edits + Notion data are untouched."
          >
            {rebuilding ? "Rebuilding…" : "Rebuild from CA"}
          </button>
        </div>
      </div>
      <p className="view__hint">
        HJG's <strong>source of truth</strong> for every mentee. Each row blends three zones — a <strong>CA zone</strong> (refreshed from
        CoachAccountable every sync), a <strong>Notion zone</strong> (imported from your Notion export), and a <strong>hand zone</strong>
        (your edits, never overwritten). The table shows the <strong>effective</strong> value (hand wins, then Notion, then CA). Edit{" "}
        <strong>Status</strong>, <strong>Coach</strong> and <strong>Discovery</strong> right in the grid, or click a name to open the full editor
        on the right. Funnel &amp; exits now live on the <strong>Metrics</strong> tab.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="mentee-layout">
        <div className="mentee-layout__main">
      <CollapsibleCard variant="inset" id="mentees.roster" title="Roster" sectionId="mentees.roster" style={{ marginBottom: 16 }}>
        <div className="journey-filters">
          <label className="journey-filters__field">
            <span>Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or coach…" />
          </label>
          <label className="journey-filters__field">
            <span>Status</span>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
              {STATUS_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="journey-filters__field">
            <span>Stage</span>
            <select value={stageF} onChange={(e) => setStageF(e.target.value)}>
              {STAGE_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {owners.length > 0 && (
            <label className="journey-filters__field">
              <span>Coach</span>
              <select value={ownerF} onChange={(e) => setOwnerF(e.target.value)}>
                <option value="all">Any</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="journey-filters__check" title="Only mentees where CA / Notion / hand disagree, or a coarse Notion exit needs classifying">
            <input type="checkbox" checked={conflictsOnly} onChange={(e) => setConflictsOnly(e.target.checked)} />
            <span>Conflicts only ({conflictCount})</span>
          </label>
          <label className="journey-filters__check">
            <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} />
            <span>Hide test mentees</span>
          </label>
          <span className="journey-filters__count muted">
            {filtered.length} of {effective.filter((m) => !hideTest || !m.isTest).length}
          </span>
        </div>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <SortableTable columns={columns} rows={tableRows} exportName="mentees" maxRows={500} emptyText="No mentees match the filters." />
        )}
      </CollapsibleCard>
        </div>

        <aside className="mentee-panel">
        {selectedRow && selectedEff ? (
        <CollapsibleCard
          id="mentees.detail"
          sectionId="mentees.detail"
          style={{ marginBottom: 18 }}
          title={<>{selectedEff.name} <span className={pillClass(selectedEff)}>{selectedEff.statusLabel}</span></>}
          actions={
            <button className="btn btn--sm" onClick={() => setSelectedId(null)}>
              Close
            </button>
          }
        >
          <p className="view__hint" style={{ marginTop: 4 }}>
            Coach: <strong>{selectedEff.ownerCoachName ?? "—"}</strong> · {selectedEff.meetingCount} meetings ·{" "}
            {selectedRow.client_id != null ? `CA client #${selectedRow.client_id}` : "Notion-only (no CA client)"} · CA synced:{" "}
            {selectedRow.ca_synced_at ? fmtDate(selectedRow.ca_synced_at) : "—"} · Notion imported:{" "}
            {selectedRow.notion_imported_at ? fmtDate(selectedRow.notion_imported_at) : "—"}
          </p>

          {selectedEff.coarseExit && (
            <div className="notice notice--warn" style={{ marginBottom: 8 }}>
              Notion records this exit coarsely (<strong>{selectedEff.notionStatus}</strong>). Classify it precisely below — set the real
              status (quit / no mentoring / fired / declined) and the exit stage.
            </div>
          )}
          {selectedEff.notionCoachConflict && (
            <div className="notice notice--warn" style={{ marginBottom: 8 }}>
              Notion's <strong>Mentor 1</strong> and <strong>Mentor</strong> disagree for this mentee — they should match. Set the coach by hand below.
            </div>
          )}

          {/* Stage rail (effective dates) */}
          <div className="mentee-rail">
            {STAGES.map((s) => {
              const d = s.reached(selectedEff);
              const color = stageColors[s.colorIndex] ?? "#94a3b8";
              return (
                <div key={s.key} className="mentee-rail__node">
                  <span className="mentee-rail__dot" style={{ background: d ? color : "transparent", borderColor: color }} />
                  <span className="mentee-rail__label">{s.label}</span>
                  <span className="mentee-rail__date muted">{d ? fmtDate(d) : "—"}</span>
                </div>
              );
            })}
          </div>

          {/* Three-source provenance + accept-into-hand */}
          <h3 style={{ marginBottom: 6 }}>Data sources — CoachAccountable · Notion · your edits</h3>
          <div className="table-scroll" style={{ marginBottom: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>CoachAccountable</th>
                  <th>Notion</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const conflict = conflictFields.has(s.field);
                  return (
                    <tr key={s.field} style={conflict ? { background: "rgba(245,158,11,0.10)" } : undefined}>
                      <td>
                        {s.label}
                        {conflict ? (
                          <span className="pill" style={{ marginLeft: 6 }}>
                            conflict
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {s.ca ?? "—"}
                        {s.ca && s.acceptCa ? (
                          <button className="linkbtn" style={{ marginLeft: 6 }} onClick={s.acceptCa} title="Copy into your hand edit">
                            → hand
                          </button>
                        ) : null}
                      </td>
                      <td>
                        {s.notion ?? "—"}
                        {s.notion && s.acceptNotion ? (
                          <button className="linkbtn" style={{ marginLeft: 6 }} onClick={s.acceptNotion} title="Copy into your hand edit">
                            → hand
                          </button>
                        ) : null}
                      </td>
                      <td>
                        <strong>{s.eff ?? "—"}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mentee-detail__grid">
            {/* Hand-zone editor */}
            <div>
              <h3 style={{ marginTop: 0 }}>Your edits (the source of truth — wins over Notion + CA)</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Name (override)</span>
                  <input
                    value={(draft.name_override as string) ?? ""}
                    placeholder={selectedEff.name}
                    onChange={(e) => setDraftField("name_override", e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Status</span>
                  <select value={draft.status ?? ""} onChange={(e) => setDraftField("status", (e.target.value || null) as MenteeMgmtStatus | null)}>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Exit/grad stage</span>
                  <select value={draft.status_stage ?? ""} onChange={(e) => setDraftField("status_stage", e.target.value || null)}>
                    {STATUS_STAGE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s === "" ? "—" : s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Status date</span>
                  <input type="date" value={draft.status_date ?? ""} onChange={(e) => setDraftField("status_date", e.target.value || null)} />
                </label>
                {DATE_FIELDS.map((f) => (
                  <label key={f.key as string} className="form-field">
                    <span>
                      {f.label} {f.ca ? <span className="muted">(CA: {fmtDate(selectedRow[f.ca] as string | null) || "—"})</span> : null}
                    </span>
                    <input
                      type="date"
                      value={(draft[f.key] as string) ?? ""}
                      onChange={(e) => setDraftField(f.key, (e.target.value || null) as never)}
                    />
                  </label>
                ))}
                <label className="form-field">
                  <span>Coach (override)</span>
                  <input value={(draft.coach_override as string) ?? ""} placeholder={selectedEff.ownerCoachName ?? ""} onChange={(e) => setDraftField("coach_override", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Email (override)</span>
                  <input value={(draft.email_override as string) ?? ""} onChange={(e) => setDraftField("email_override", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Phone (override)</span>
                  <input value={(draft.phone_override as string) ?? ""} onChange={(e) => setDraftField("phone_override", e.target.value)} />
                </label>
                <label className="form-field form-field--wide">
                  <span>Notes</span>
                  <textarea rows={3} value={(draft.notes as string) ?? ""} onChange={(e) => setDraftField("notes", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Test / placeholder</span>
                  <span>
                    <input type="checkbox" checked={!!draft.is_test} onChange={(e) => setDraftField("is_test", e.target.checked)} /> Exclude from metrics
                  </span>
                </label>
                {selectedEff.offeringSignup ? (
                  <label className="form-field">
                    <span>Offering signup (Notion)</span>
                    <span className="muted">{selectedEff.offeringSignup}</span>
                  </label>
                ) : null}
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {/* CA history */}
            <div>
              <h3 style={{ marginTop: 0 }}>Engagements (CoachAccountable)</h3>
              {detailLoading ? (
                <div className="muted">Loading…</div>
              ) : engagements.length === 0 ? (
                <div className="muted">No engagements.</div>
              ) : (
                <div className="table-scroll" style={{ marginBottom: 14 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {engagements.map((e, i) => (
                        <tr key={i}>
                          <td>{e.tier}</td>
                          <td>{fmtDate(e.startDate) || "—"}</td>
                          <td>{fmtDate(e.endDate) || "—"}</td>
                          <td>{e.isCanceled ? "canceled" : e.isComplete ? "complete" : "open"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3>Meetings ({meetings.length})</h3>
              {detailLoading ? (
                <div className="muted">Loading…</div>
              ) : meetings.length === 0 ? (
                <div className="muted">No meetings.</div>
              ) : (
                <div className="table-scroll" style={{ maxHeight: 320 }}>
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
                      {meetings.map((m, i) => (
                        <tr key={i}>
                          <td>{fmtDate(m.date)}</td>
                          <td>
                            {m.name}
                            {m.isGroup ? (
                              <span className="pill" style={{ marginLeft: 6 }}>
                                group
                              </span>
                            ) : null}
                          </td>
                          <td>{m.tier ?? "—"}</td>
                          <td>{m.coachName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </CollapsibleCard>
        ) : (
          <div className="card mentee-panel__empty">
            <p className="muted" style={{ margin: 0 }}>
              Select a mentee from the grid to view and edit their details here.
            </p>
          </div>
        )}
        </aside>
      </div>

      {importing && <NotionImportModal userId={user?.id} onClose={() => setImporting(false)} onImported={onImported} />}
    </div>
  );
}
