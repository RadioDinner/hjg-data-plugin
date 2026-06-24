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
  DEFAULT_STAGE_COLORS,
  MENTEE_STATUSES,
  type MenteeRow,
  type MenteeHandEdit,
  type MenteeMgmtStatus,
  type EffectiveMentee,
  type MenteeMeetingLite,
  type MenteeEngagementLite,
} from "../db";
import { SortableTable, type SortColumn, type Row } from "../components/SortableTable";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";
import { fmtDate } from "../format";

// The funnel stages, in order, with display labels + the stage-palette index used
// for the rail colors (0 Discovery … 5 Graduation — matches journeys_stage_colors).
const STAGES: { key: string; label: string; colorIndex: number; reached: (m: EffectiveMentee) => string | null }[] = [
  { key: "discovery", label: "Discovery", colorIndex: 0, reached: (m) => m.discoveryDate },
  { key: "jumpstart", label: "JumpStart", colorIndex: 1, reached: (m) => m.jumpstartDate },
  { key: "4x", label: "4x", colorIndex: 2, reached: (m) => m.tier4xDate },
  { key: "2x", label: "2x", colorIndex: 3, reached: (m) => m.tier2xDate },
  { key: "1x", label: "1x", colorIndex: 4, reached: (m) => m.tier1xDate },
  { key: "graduated", label: "Graduated", colorIndex: 5, reached: (m) => m.graduationDate },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— Unclassified (use CA guess) —" },
  ...MENTEE_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
];
const STATUS_STAGE_OPTIONS = ["", "discovery", "jumpstart", "4x", "2x", "1x"];

// Pill class per effective status (reuses the mentee-status pill palette).
function pillClass(m: EffectiveMentee): string {
  const s = m.status ?? (m.caStatus === "graduated" ? "graduated" : m.caStatus === "active" ? "active" : "inactive");
  return `pill pill--mentee-${s}`;
}

// The six effective stage-date override fields, paired with their CA value for the hint.
const DATE_FIELDS: { key: keyof MenteeHandEdit; label: string; ca: keyof MenteeRow }[] = [
  { key: "discovery_date_override", label: "Discovery", ca: "ca_discovery_date" },
  { key: "jumpstart_date_override", label: "JumpStart", ca: "ca_jumpstart_date" },
  { key: "tier_4x_date_override", label: "4x", ca: "ca_tier_4x_date" },
  { key: "tier_2x_date_override", label: "2x", ca: "ca_tier_2x_date" },
  { key: "tier_1x_date_override", label: "1x", ca: "ca_tier_1x_date" },
  { key: "graduation_date_override", label: "Graduation", ca: "ca_graduation_date" },
];

// Build the hand-layer draft from a row (only the editable fields).
function draftFromRow(r: MenteeRow): MenteeHandEdit {
  return {
    name_override: r.name_override ?? "",
    status: r.status,
    status_stage: r.status_stage,
    status_date: r.status_date,
    discovery_date_override: r.discovery_date_override,
    jumpstart_date_override: r.jumpstart_date_override,
    tier_4x_date_override: r.tier_4x_date_override,
    tier_2x_date_override: r.tier_2x_date_override,
    tier_1x_date_override: r.tier_1x_date_override,
    graduation_date_override: r.graduation_date_override,
    email: r.email ?? "",
    phone: r.phone ?? "",
    mentor: r.mentor ?? "",
    notion_status: r.notion_status ?? "",
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

  // Filters
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [stageF, setStageF] = useState<string>("all");
  const [ownerF, setOwnerF] = useState<string>("all");
  const [hideTest, setHideTest] = useState(true);

  // Selection + detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MenteeHandEdit>({});
  const [saving, setSaving] = useState(false);
  const [meetings, setMeetings] = useState<MenteeMeetingLite[]>([]);
  const [engagements, setEngagements] = useState<MenteeEngagementLite[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // Apply filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effective.filter((m) => {
      if (hideTest && m.isTest) return false;
      if (statusF !== "all" && m.resolvedStatus !== statusF) return false;
      if (stageF !== "all" && (m.currentStage ?? "discovery") !== stageF) return false;
      if (ownerF !== "all" && m.ownerCoachName !== ownerF) return false;
      if (q && !m.name.toLowerCase().includes(q) && !(m.ownerCoachName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [effective, search, statusF, stageF, ownerF, hideTest]);

  const columns: SortColumn[] = [
    {
      key: "name",
      label: "Mentee",
      format: (r: Row) => (
        <button className="linkbtn" onClick={() => setSelectedId(String(r._id))} title="Open mentee">
          {String(r.name)}
          {r.test ? (
            <span className="pill" style={{ marginLeft: 6 }}>
              test
            </span>
          ) : null}
        </button>
      ),
    },
    { key: "status", label: "Status" },
    { key: "stage", label: "Stage" },
    { key: "owner", label: "Owner" },
    { key: "discovery", label: "Discovery" },
    { key: "started", label: "Started" },
    { key: "lastMeeting", label: "Last meeting" },
    { key: "meetings", label: "Meetings", numeric: true },
  ];

  const tableRows: Row[] = filtered.map((m) => ({
    _id: m.id,
    name: m.name,
    test: m.isTest,
    status: m.statusLabel,
    stage: m.currentStage ? STAGES.find((s) => s.key === m.currentStage)?.label ?? m.currentStage : "—",
    owner: m.ownerCoachName ?? "—",
    discovery: m.discoveryDate ?? "",
    started: m.startDate ?? "",
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

  return (
    <div className="view">
      <div className="view__header">
        <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Mentees <HelpButton id="mentees.screen" label="Mentee management" />
          <SectionId id="mentees.screen" />
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {note && <span className="pill pill--success">{note}</span>}
          <button className="btn btn--sm" onClick={addMentee}>
            + Add mentee
          </button>
          <button
            className="btn btn--sm"
            onClick={rebuild}
            disabled={rebuilding}
            title="Recompute the CA layer from the synced mirror (no CoachAccountable calls). Your hand edits are untouched."
          >
            {rebuilding ? "Rebuilding…" : "Rebuild from CA"}
          </button>
        </div>
      </div>
      <p className="view__hint">
        HJG's <strong>source of truth</strong> for every mentee. Each row has a <strong>CA layer</strong> (refreshed from
        CoachAccountable on every sync) and a <strong>hand layer</strong> (status, corrections, notes — yours, never
        overwritten by a sync). The table shows the <strong>effective</strong> value (your edit wins over CA).
      </p>

      {error && <div className="error">{error}</div>}

      <div className="card card--inset" style={{ marginBottom: 16 }}>
        <div className="journey-filters">
          <label className="journey-filters__field">
            <span>Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or coach…" />
          </label>
          <label className="journey-filters__field">
            <span>Status</span>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
              <option value="all">Any</option>
              <option value="active">Active</option>
              <option value="graduated">Graduated</option>
              <option value="quit">Quit</option>
              <option value="fired">Fired</option>
              <option value="paused">Paused</option>
              <option value="declined">Declined</option>
              <option value="inactive">Inactive (unclassified)</option>
            </select>
          </label>
          <label className="journey-filters__field">
            <span>Stage</span>
            <select value={stageF} onChange={(e) => setStageF(e.target.value)}>
              <option value="all">Any</option>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {owners.length > 0 && (
            <label className="journey-filters__field">
              <span>Owner</span>
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
          <label className="journey-filters__check">
            <input type="checkbox" checked={hideTest} onChange={(e) => setHideTest(e.target.checked)} />
            <span>Hide test mentees</span>
          </label>
          <span className="journey-filters__count muted">
            {filtered.length} of {effective.filter((m) => !m.isTest).length}
          </span>
        </div>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <>
            <SectionId id="mentees.roster" />
            <SortableTable columns={columns} rows={tableRows} exportName="mentees" maxRows={500} emptyText="No mentees match the filters." />
          </>
        )}
      </div>

      {selectedRow && selectedEff && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              {selectedEff.name} <span className={pillClass(selectedEff)}>{selectedEff.statusLabel}</span>
              <SectionId id="mentees.detail" />
            </h2>
            <button className="btn btn--sm" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <p className="view__hint" style={{ marginTop: 4 }}>
            Owner: <strong>{selectedEff.ownerCoachName ?? "—"}</strong> · {selectedEff.meetingCount} meetings ·{" "}
            {selectedRow.client_id != null ? `CA client #${selectedRow.client_id}` : "hand-added (no CA client)"} · CA synced:{" "}
            {selectedRow.ca_synced_at ? fmtDate(selectedRow.ca_synced_at) : "—"}
          </p>

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

          <div className="mentee-detail__grid">
            {/* Hand-layer editor */}
            <div>
              <h3 style={{ marginTop: 0 }}>Status &amp; info (your edits — the source of truth)</h3>
              <div className="form-grid">
                <label className="form-field">
                  <span>Name (override)</span>
                  <input
                    value={(draft.name_override as string) ?? ""}
                    placeholder={selectedRow.ca_name ?? ""}
                    onChange={(e) => setDraftField("name_override", e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Status</span>
                  <select
                    value={draft.status ?? ""}
                    onChange={(e) => setDraftField("status", (e.target.value || null) as MenteeMgmtStatus | null)}
                  >
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
                      {f.label} <span className="muted">(CA: {fmtDate(selectedRow[f.ca] as string | null) || "—"})</span>
                    </span>
                    <input
                      type="date"
                      value={(draft[f.key] as string) ?? ""}
                      onChange={(e) => setDraftField(f.key, (e.target.value || null) as never)}
                    />
                  </label>
                ))}
                <label className="form-field">
                  <span>Email</span>
                  <input value={(draft.email as string) ?? ""} onChange={(e) => setDraftField("email", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Phone</span>
                  <input value={(draft.phone as string) ?? ""} onChange={(e) => setDraftField("phone", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Mentor (Notion)</span>
                  <input value={(draft.mentor as string) ?? ""} onChange={(e) => setDraftField("mentor", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Notion status</span>
                  <input value={(draft.notion_status as string) ?? ""} onChange={(e) => setDraftField("notion_status", e.target.value)} />
                </label>
                <label className="form-field form-field--wide">
                  <span>Notes</span>
                  <textarea rows={3} value={(draft.notes as string) ?? ""} onChange={(e) => setDraftField("notes", e.target.value)} />
                </label>
                <label className="form-field">
                  <span>Test / placeholder</span>
                  <span>
                    <input type="checkbox" checked={!!draft.is_test} onChange={(e) => setDraftField("is_test", e.target.checked)} /> Exclude from
                    metrics
                  </span>
                </label>
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
        </div>
      )}
    </div>
  );
}
