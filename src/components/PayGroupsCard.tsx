import { useEffect, useRef, useState } from "react";
import {
  fetchEngagementTemplates,
  fetchPayGroupsConfig,
  savePayGroupsConfig,
  fetchCoachesWithSettings,
  normalizeTemplateName,
  slugifyGroupName,
  type PayGroupsConfig,
  type PayGroup,
  type EngagementTemplate,
} from "../db";
import { refreshEngagementTemplates } from "../api";
import { HelpButton } from "./HelpDrawer";
import { CollapsibleCard } from "./Collapsible";

interface CoachOpt {
  coachId: number;
  name: string;
}

// Company options (§451): the "Payment groups" grid. Rows = CoachAccountable
// engagement templates, columns = staff groups (e.g. "Mentors"); a checked cell
// means that template's revenue counts toward that group's payout. A second grid
// assigns coaches to groups. Saved (debounced) to app_settings under
// `pay_engagement_groups`; the pay engine reads it (an invoice counts iff its
// covering engagement's template is checked for the group).
export function PayGroupsCard() {
  const [cfg, setCfg] = useState<PayGroupsConfig | null>(null);
  const [templates, setTemplates] = useState<EngagementTemplate[]>([]);
  const [coaches, setCoaches] = useState<CoachOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [newGroup, setNewGroup] = useState("");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PayGroupsConfig | null>(null); // last change not yet persisted
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let live = true;
    Promise.all([fetchEngagementTemplates(), fetchCoachesWithSettings(), fetchPayGroupsConfig()])
      .then(([t, c, g]) => {
        if (!live) return;
        setTemplates(t);
        setCoaches(c.map((x) => ({ coachId: x.coachId, name: x.name })));
        setCfg(g);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      mountedRef.current = false;
      // Flush a pending debounced save so a quick navigate-away (< 500ms) doesn't
      // drop the last edit. Fire-and-forget; pendingRef is null once a save lands.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        if (pendingRef.current) savePayGroupsConfig(pendingRef.current).catch(() => {});
      }
    };
  }, []);

  // Apply a config change optimistically and persist it debounced (so toggling
  // several boxes doesn't spam the DB).
  function mutate(next: PayGroupsConfig) {
    setCfg(next);
    setStatus("Saving…");
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await savePayGroupsConfig(next);
        pendingRef.current = null;
        if (!mountedRef.current) return;
        setStatus("Saved ✓");
        window.setTimeout(() => setStatus((s) => (s === "Saved ✓" ? "" : s)), 1800);
      } catch (e) {
        pendingRef.current = null;
        if (!mountedRef.current) return;
        setError(String(e));
        setStatus("");
      }
    }, 500);
  }

  const patchGroup = (groupId: string, fn: (g: PayGroup) => PayGroup) => {
    if (!cfg) return;
    mutate({ groups: cfg.groups.map((g) => (g.id === groupId ? fn(g) : g)) });
  };

  const templateInGroup = (g: PayGroup, tName: string) =>
    g.templateNames.some((n) => normalizeTemplateName(n) === normalizeTemplateName(tName));

  function toggleTemplate(groupId: string, tName: string) {
    patchGroup(groupId, (g) => {
      const on = templateInGroup(g, tName);
      return {
        ...g,
        templateNames: on
          ? g.templateNames.filter((n) => normalizeTemplateName(n) !== normalizeTemplateName(tName))
          : [...g.templateNames, tName],
      };
    });
  }

  function toggleCoach(groupId: string, coachId: number) {
    patchGroup(groupId, (g) => {
      const on = g.coachIds.includes(coachId);
      return { ...g, coachIds: on ? g.coachIds.filter((c) => c !== coachId) : [...g.coachIds, coachId] };
    });
  }

  function addGroup() {
    if (!cfg) return;
    const name = newGroup.trim();
    if (!name) return;
    const base = slugifyGroupName(name);
    let id = base;
    let i = 2;
    while (cfg.groups.some((g) => g.id === id)) id = `${base}-${i++}`;
    mutate({ groups: [...cfg.groups, { id, name, templateNames: [], coachIds: [] }] });
    setNewGroup("");
  }

  function renameGroup(groupId: string, name: string) {
    patchGroup(groupId, (g) => ({ ...g, name }));
  }

  function removeGroup(groupId: string) {
    if (!cfg) return;
    const g = cfg.groups.find((x) => x.id === groupId);
    if (!g) return;
    if (!confirm(`Remove the "${g.name}" payment group? Its template and coach selections will be cleared.`)) return;
    mutate({ groups: cfg.groups.filter((x) => x.id !== groupId) });
  }

  async function doRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const { count } = await refreshEngagementTemplates();
      const t = await fetchEngagementTemplates();
      setTemplates(t);
      setStatus(`Refreshed ${count} templates ✓`);
      window.setTimeout(() => setStatus((s) => (s.startsWith("Refreshed") ? "" : s)), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const groups = cfg?.groups ?? [];

  return (
    <CollapsibleCard
      id="options.payGroups"
      title="Payment groups"
      sectionId="options.payGroups"
      style={{ marginTop: 16 }}
      help={<HelpButton id="options.payGroups" label="Payment groups" />}
      actions={
        <button className="btn btn--sm" onClick={doRefresh} disabled={refreshing} title="Pull the latest engagement templates from CoachAccountable">
          {refreshing ? "Refreshing…" : "Refresh templates"}
        </button>
      }
    >
      <div className="muted" style={{ fontSize: 13, marginTop: -2, marginBottom: 10 }}>
        Check which CoachAccountable <strong>engagement templates</strong> count toward each group of staff for
        payout calculations, and assign coaches to groups. An <strong>invoice line item</strong> counts when it
        starts with a checked template's name — eligibility comes from what was actually <em>billed</em>, not from
        engagement records (which can be stale/canceled while still billing). <strong>Mentors</strong> drives the
        Pay staff / Build payout engine — leaving a group's templates all unchecked keeps the legacy 4×/2×/1×
        auto-detection until you pick them. Unmatched charges and credits are flagged{" "}
        <strong>review</strong> on each payout's drill-down for hand-checking the first rounds.
      </div>

      {error && <div className="notice notice--warn" style={{ marginTop: 8 }}>{error}</div>}
      {status && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{status}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          {/* Add / manage groups */}
          <div className="table-toolbar" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <input
              type="text"
              value={newGroup}
              placeholder="New group name (e.g. Group leaders)"
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
              style={{ minWidth: 220 }}
            />
            <button className="btn btn--sm" onClick={addGroup} disabled={!newGroup.trim()}>
              + Add group
            </button>
          </div>

          {templates.length === 0 ? (
            <p className="notice notice--info" style={{ fontSize: 13, marginTop: 10 }}>
              No engagement templates yet. Apply migration <code>9972_pay_engagement_groups.sql</code>, then click{" "}
              <strong>Refresh templates</strong> (or run Admin → Sync) to pull them from CoachAccountable.
            </p>
          ) : (
            <>
              {/* Templates × groups */}
              <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Engagement templates → groups</h3>
              <div className="table-scroll">
                <table className="table table--center">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", minWidth: 320 }}>Engagement template</th>
                      {groups.map((g) => (
                        <th key={g.id}>
                          <GroupHeader group={g} onRename={(name) => renameGroup(g.id, name)} onRemove={() => removeGroup(g.id)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => (
                      <tr key={t.id}>
                        <td style={{ textAlign: "left" }}>
                          {t.name}
                          {t.allocationUnit ? (
                            <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                              {t.allocation ?? ""} {t.allocationUnit}
                            </span>
                          ) : null}
                        </td>
                        {groups.map((g) => (
                          <td key={g.id}>
                            <input
                              type="checkbox"
                              checked={templateInGroup(g, t.name)}
                              onChange={() => toggleTemplate(g.id, t.name)}
                              aria-label={`Include ${t.name} in ${g.name}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Checked names NOT in the current template list (the list was
                        refreshed, or a fallback name drifted). They still actively
                        gate pay, so they MUST stay visible and uncheckable here —
                        an invisible-but-active rule is how payroll goes wrong. */}
                    {(() => {
                      const known = new Set(templates.map((t) => normalizeTemplateName(t.name)));
                      const orphanByKey = new Map<string, string>();
                      for (const g of groups)
                        for (const n of g.templateNames)
                          if (!known.has(normalizeTemplateName(n))) orphanByKey.set(normalizeTemplateName(n), n);
                      return [...orphanByKey.values()].sort().map((name) => (
                        <tr key={`orphan:${name}`}>
                          <td style={{ textAlign: "left" }}>
                            {name}
                            <span className="pill pill--pending" style={{ marginLeft: 6, fontSize: 10 }} title="This checked name is not in the current template list (refreshed away or renamed) but still gates payouts — uncheck it here to stop it, or re-check the matching current template.">
                              not in current list
                            </span>
                          </td>
                          {groups.map((g) => (
                            <td key={g.id}>
                              <input
                                type="checkbox"
                                checked={templateInGroup(g, name)}
                                onChange={() => toggleTemplate(g.id, name)}
                                aria-label={`Include ${name} in ${g.name}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ));
                    })()}
                    {groups.length === 0 && (
                      <tr>
                        <td colSpan={1} className="muted">Add a group to start checking templates.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Coaches × groups — shown whenever there's at least one group, regardless
              of templates (coach assignment doesn't depend on the template list). */}
          {groups.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "20px 0 6px" }}>Coaches → groups</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 6 }}>
                Which staff belong to each group. (Stored for group-specific pay schemes; the Mentors payout currently
                credits each mentee's owner regardless — this list is the roster you're building toward.)
              </p>
              {coaches.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No coaches synced yet. Run Admin → Sync first.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table table--center">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", minWidth: 220 }}>Coach</th>
                        {groups.map((g) => (
                          <th key={g.id}>{g.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {coaches.map((c) => (
                        <tr key={c.coachId}>
                          <td style={{ textAlign: "left" }}>{c.name}</td>
                          {groups.map((g) => (
                            <td key={g.id}>
                              <input
                                type="checkbox"
                                checked={g.coachIds.includes(c.coachId)}
                                onChange={() => toggleCoach(g.id, c.coachId)}
                                aria-label={`Assign ${c.name} to ${g.name}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}

// A group column header: editable name + a remove (×) button. Kept lightweight —
// the name commits on blur.
function GroupHeader({ group, onRename, onRemove }: { group: PayGroup; onRename: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(group.name);
  useEffect(() => setName(group.name), [group.name]);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const t = name.trim();
          if (t && t !== group.name) onRename(t);
          else if (!t) setName(group.name); // don't leave a blank header box
        }}
        style={{ width: 92, fontSize: 12, textAlign: "center" }}
        aria-label={`Rename ${group.name}`}
      />
      <button className="linkbtn" onClick={onRemove} title={`Remove ${group.name}`} style={{ color: "var(--err-text, #b91c1c)" }}>
        ×
      </button>
    </div>
  );
}
