import { useEffect, useMemo, useRef, useState } from "react";
import {
  jyfEngagementNames,
  setJyfOverride,
  countJyfOverrides,
  saveJyfCohortOverrides,
  JYF_ASSIGNMENT_LABELS,
  JYF_COHORT_LABELS,
  type CohortEngagementInput,
  type JyfCohortAssignment,
  type JyfCohortKey,
  type JyfCohortOverrides,
  type JyfEngagementNameRow,
} from "../db";
import { SectionId } from "./SectionId";
import { num } from "../format";

// §005 cohort settings (§910): opened from the ⚙ in the corner of the "JYF vs
// Active Mentoring" card. Lists every engagement name in the mirror, grouped by
// the cohort it currently counts toward, with a "Counts as" dropdown per name:
// Auto (what its wording says), JumpStart (JYF), 4x, 2x, 1x, or Not counted.
// Changes apply to the card at once (the parent re-computes from the same rows)
// and are saved org-wide to app_settings, debounced, like Payment groups (§451).
interface Props {
  engagements: CohortEngagementInput[];
  overrides: JyfCohortOverrides;
  onChange: (next: JyfCohortOverrides) => void;
  onClose: () => void;
}

type Group = JyfCohortKey | "off";
const GROUP_ORDER: readonly Group[] = ["jyf", "4x", "2x", "1x", "off"];
const GROUP_TITLES: Record<Group, string> = {
  jyf: "Counted as JumpStart (JYF)",
  "4x": "Counted as Active Mentoring — 4x",
  "2x": "Counted as Active Mentoring — 2x",
  "1x": "Counted as Active Mentoring — 1x",
  off: "Not counted on this card",
};
const CHOICES: readonly JyfCohortAssignment[] = ["jyf", "4x", "2x", "1x", "off"];

const autoLabel = (auto: JyfCohortKey | null) =>
  `Auto — ${auto ? JYF_COHORT_LABELS[auto] : "Not counted"}`;

export function JyfCohortSettingsModal({ engagements, overrides, onChange, onClose }: Props) {
  const [status, setStatus] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<JyfCohortOverrides | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Flush a pending debounced save so closing the dialog quickly (< 500ms
      // after the last change) never drops the last edit.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        if (pendingRef.current) saveJyfCohortOverrides(pendingRef.current).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => jyfEngagementNames(engagements, overrides), [engagements, overrides]);
  const closedOnly = rows.filter((r) => r.openPeople === 0).length;
  const visible = showClosed ? rows : rows.filter((r) => r.openPeople > 0 || r.override);
  const groups = useMemo(() => {
    const g: Record<Group, JyfEngagementNameRow[]> = {
      jyf: [],
      "4x": [],
      "2x": [],
      "1x": [],
      off: [],
    };
    for (const r of visible) g[r.effective ?? "off"].push(r);
    return g;
  }, [visible]);
  const nOverrides = countJyfOverrides(overrides);

  // Apply optimistically (the card updates at once) and persist debounced.
  function mutate(next: JyfCohortOverrides) {
    onChange(next);
    setStatus("Saving…");
    setSaveError(null);
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await saveJyfCohortOverrides(next);
        pendingRef.current = null;
        if (!mountedRef.current) return;
        setStatus("Saved ✓");
        window.setTimeout(() => setStatus((s) => (s === "Saved ✓" ? "" : s)), 1800);
      } catch (e) {
        pendingRef.current = null;
        if (!mountedRef.current) return;
        setStatus("");
        setSaveError(String(e instanceof Error ? e.message : e));
      }
    }, 500);
  }

  const setRow = (r: JyfEngagementNameRow, value: string) => {
    const assignment = value === "auto" ? null : (value as JyfCohortAssignment);
    mutate(setJyfOverride(overrides, r.name, assignment));
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>
            JYF vs Active Mentoring — cohort settings <SectionId id="metrics.jyfCohortSettings" />
          </h2>
          <div className="jyf-settings__actions">
            {status && <span className="muted">{status}</span>}
            <button
              className="btn btn--sm"
              onClick={() => mutate({ byName: {} })}
              disabled={nOverrides === 0}
              title="Put every engagement name back on Auto"
            >
              Reset all
            </button>
            <button className="btn btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="modal__body">
          <p className="view__hint">
            Each row is an engagement name from CoachAccountable. <strong>Auto</strong> is what its
            wording says it is (JumpStart / 0x / JYF → JYF; 4x / 2x / 1x → that tier; anything else
            → not counted). Pick a cohort to move a name, or <strong>Not counted</strong> to take it
            off the card. Changes apply to the tiles, chart, table, drill-downs and the CSV at once,
            for everyone — <em>the earlier-day Compare snapshots use the same settings.</em>
            {nOverrides > 0 && (
              <>
                {" "}
                <strong>
                  {num(nOverrides)} name{nOverrides === 1 ? " is" : "s are"} overridden.
                </strong>
              </>
            )}
          </p>
          {saveError && (
            <p className="view__hint" style={{ color: "var(--err-text)" }}>
              <strong>Not saved:</strong> {saveError}
              {saveError.includes("seeded") && (
                <>
                  {" "}
                  Apply <code>9960_jyf_cohort_overrides.sql</code> in the Supabase SQL Editor, then
                  change the setting again. The card keeps your choice until the page reloads.
                </>
              )}
            </p>
          )}
          {GROUP_ORDER.map((g) =>
            groups[g].length === 0 ? null : (
              <div key={g} className="jyf-settings__group">
                <h3 className="jyf-settings__title">
                  {GROUP_TITLES[g]}{" "}
                  <span className="muted">
                    ({num(groups[g].length)} name{groups[g].length === 1 ? "" : "s"})
                  </span>
                </h3>
                <div className="table-scroll">
                  <table className="table jyf-settings__table">
                    <thead>
                      <tr>
                        <th>Engagement name</th>
                        <th className="num" title="Distinct people with this engagement open today">
                          Open
                        </th>
                        <th className="num" title="Distinct people who ever had this engagement">
                          Ever
                        </th>
                        <th>Counts as</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups[g].map((r) => (
                        <tr key={r.key} className={r.override ? "jyf-settings__row--set" : ""}>
                          <td>
                            {r.name}
                            {r.override && (
                              <span
                                className="jyf-settings__tag"
                                title={`Auto would be: ${autoLabel(r.auto).replace("Auto — ", "")}`}
                              >
                                overridden
                              </span>
                            )}
                          </td>
                          <td className="num">{num(r.openPeople)}</td>
                          <td className="num">{num(r.allPeople)}</td>
                          <td>
                            <select
                              className="jyf-settings__select"
                              value={r.override ?? "auto"}
                              onChange={(e) => setRow(r, e.target.value)}
                              aria-label={`Cohort for ${r.name}`}
                            >
                              <option value="auto">{autoLabel(r.auto)}</option>
                              {CHOICES.map((c) => (
                                <option key={c} value={c}>
                                  {JYF_ASSIGNMENT_LABELS[c]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          )}
          {visible.length === 0 && <p className="muted">No engagements in the mirror yet.</p>}
          {closedOnly > 0 && (
            <p className="view__hint">
              <label style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(e) => setShowClosed(e.target.checked)}
                />{" "}
                Also show the {num(closedOnly)} name{closedOnly === 1 ? "" : "s"} with no open
                engagement today (they only affect the earlier-day Compare snapshots).
              </label>
            </p>
          )}
        </div>
        <div className="modal__foot muted">
          Saved org-wide (app_settings · <code>jyf_cohort_overrides</code>). Names match
          case-insensitively with whitespace collapsed, so a renamed template in CA shows as a new
          row on Auto.
        </div>
      </div>
    </div>
  );
}
