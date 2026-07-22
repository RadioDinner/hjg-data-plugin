import { useEffect, useMemo, useState } from "react";
import {
  fetchMentees,
  toEffectiveMentee,
  fetchClientEngagements,
  fetchCoachNames,
  fetchCompanyOptions,
  parseTransitionOptions,
  MENTEE_TRANSITION_OPTIONS_KEY,
  type MenteeRow,
  type ClientEngagement,
} from "../db";
import { fmtDate } from "../format";
import { HelpButton } from "../components/HelpDrawer";
import { SectionId } from "../components/SectionId";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

// The engagement that best represents "current": an un-canceled one covering
// today (most recently started wins), else the most recently started overall.
function currentEngagement(engs: ClientEngagement[], today: string): ClientEngagement | null {
  const live = engs.filter(
    (e) => !e.isCanceled && e.startDate && e.startDate <= today && (!e.endDate || e.endDate >= today)
  );
  if (live.length) return live.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
  const any = engs.filter((e) => !e.isCanceled);
  return any.sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0] ?? null;
}

function FromField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 14 }}>{value || "—"}</span>
    </div>
  );
}

// Update Mentee (§551) — forms that change a mentee's state. First form:
// TRANSITION MENTEE (§552). Load a mentee → the left half shows the FROM state
// (name, CA details, our status, current engagement); the right half is the TO
// state — a "Transition to…" dropdown fed from Company options (§451,
// `mentee_transition_options`). Recording/applying the transition is the next
// build phase; this is the bones the user asked for.
export function UpdateMenteeView() {
  const [rows, setRows] = useState<MenteeRow[]>([]);
  const [coachNames, setCoachNames] = useState<Map<number, string>>(new Map());
  const [transitionOptions, setTransitionOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>(""); // mentees.id (uuid)
  const [loadedId, setLoadedId] = useState<string>(""); // the mentee actually loaded into the form
  const [engagements, setEngagements] = useState<ClientEngagement[] | null>(null);
  const [engError, setEngError] = useState<string | null>(null);
  const [transitionTo, setTransitionTo] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([fetchMentees(), fetchCoachNames().catch(() => new Map<number, string>()), fetchCompanyOptions().catch(() => ({} as Record<string, string>))])
      .then(([m, c, opts]) => {
        if (!live) return;
        setRows(m);
        setCoachNames(c);
        setTransitionOptions(parseTransitionOptions(opts[MENTEE_TRANSITION_OPTIONS_KEY]));
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const today = todayYmd();
  const effective = useMemo(() => rows.map((r) => toEffectiveMentee(r, today)), [rows, today]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? effective.filter((m) => m.name.toLowerCase().includes(q)) : effective;
    return [...base].sort((a, b) => a.name.localeCompare(b.name));
  }, [effective, search]);

  const loaded = useMemo(() => effective.find((m) => m.id === loadedId) ?? null, [effective, loadedId]);

  // Pull the loaded mentee's CA engagements (needs a CA client id).
  useEffect(() => {
    if (!loaded) return;
    setEngagements(null);
    setEngError(null);
    if (loaded.clientId == null) return;
    let live = true;
    fetchClientEngagements(loaded.clientId)
      .then((e) => live && setEngagements(e))
      .catch((e) => live && setEngError(String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId, loaded?.clientId]);

  function loadMentee() {
    if (!selectedId) return;
    setLoadedId(selectedId);
    setTransitionTo("");
  }

  const current = engagements ? currentEngagement(engagements, today) : null;
  const currentCoach = current?.coachId != null ? coachNames.get(current.coachId) ?? `#${current.coachId}` : null;

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="notice notice--warn">Failed to load mentees: {error}</div>;

  return (
    <div className="stack">
      <section className="card">
        <div className="card__head">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Update Mentee <SectionId id="updateMentee.screen" />
              <HelpButton id="updateMentee.transition" label="Update Mentee" />
            </h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              Forms that change a mentee's state. The first form is <strong>Transition Mentee</strong>: load a mentee to
              see their current (from) state, then pick what they're transitioning to. Recording the transition is the
              next build phase — today this is the wiring.
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <h2 style={{ fontSize: 15 }}>
            Transition Mentee <SectionId id="updateMentee.transition" />
          </h2>
        </div>

        {/* Picker: search + select + Load. */}
        <div className="filter-bar" style={{ padding: "4px 0 12px", borderBottom: "1px solid var(--line)" }}>
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
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">— pick a mentee —</option>
              {filtered.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.isTest ? " (test)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--sm btn--primary" onClick={loadMentee} disabled={!selectedId}>
            Load mentee
          </button>
        </div>

        {!loaded ? (
          <p className="muted">Load a mentee to fill the form.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)", gap: 16 }}>
            {/* FROM — the mentee's current state. */}
            <div className="card card--inset">
              <h3 style={{ marginTop: 0 }}>From (current state)</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
                <FromField label="Name" value={loaded.name} />
                <FromField label="CA client id" value={loaded.clientId != null ? String(loaded.clientId) : "not linked to CA"} />
                <FromField label="Our status" value={loaded.statusLabel} />
                <FromField label="Current stage" value={loaded.currentStage ?? undefined} />
                <FromField label="Owner / coach" value={loaded.ownerCoachName} />
                <FromField label="Email" value={loaded.email} />
                <FromField label="Phone" value={loaded.phone} />
                <FromField label="CA status" value={loaded.caStatus} />
                <FromField label="First meeting" value={loaded.firstMeeting ? fmtDate(loaded.firstMeeting) : null} />
                <FromField label="Last meeting" value={loaded.lastMeeting ? fmtDate(loaded.lastMeeting) : null} />
                <FromField label="Meetings" value={String(loaded.meetingCount)} />
                <FromField label="Discovery" value={loaded.discoveryDate ? fmtDate(loaded.discoveryDate) : null} />
              </div>

              <h4 style={{ marginBottom: 6 }}>Current engagement (CA)</h4>
              {loaded.clientId == null ? (
                <p className="muted" style={{ margin: 0 }}>Not linked to a CA client — no engagement data.</p>
              ) : engError ? (
                <p className="notice notice--warn" style={{ margin: 0 }}>{engError}</p>
              ) : engagements == null ? (
                <p className="muted" style={{ margin: 0 }}>Loading engagements…</p>
              ) : current == null ? (
                <p className="muted" style={{ margin: 0 }}>No un-canceled engagements on record.</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
                  <FromField label="Engagement" value={current.name} />
                  <FromField label="Coach" value={currentCoach} />
                  <FromField label="Start" value={current.startDate ? fmtDate(current.startDate) : null} />
                  <FromField
                    label="End"
                    value={
                      current.endDate
                        ? `${fmtDate(current.endDate)}${current.endDate < today ? " (ended)" : ""}`
                        : "open"
                    }
                  />
                </div>
              )}
            </div>

            {/* TO — the transition target. */}
            <div className="card card--inset">
              <h3 style={{ marginTop: 0 }}>To (transition)</h3>
              <label className="filter" style={{ width: "100%", maxWidth: 320 }}>
                <span>Transition to…</span>
                <select value={transitionTo} onChange={(e) => setTransitionTo(e.target.value)}>
                  <option value="">— choose —</option>
                  {transitionOptions.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </label>
              <p className="muted" style={{ fontSize: 12 }}>
                The choices come from <strong>Company options (§451) → Update Mentee → “Transition to… options”</strong>.
              </p>
              {transitionTo && (
                <p style={{ fontSize: 14 }}>
                  <strong>{loaded.name}</strong>: {loaded.currentStage ?? loaded.statusLabel} → <strong>{transitionTo}</strong>
                </p>
              )}
              <button
                className="btn btn--sm btn--primary"
                disabled
                title="Coming next: recording the transition (and eventually applying it). This form is the bones."
              >
                Apply transition (coming soon)
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
