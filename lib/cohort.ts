// Pure "JYF vs Active Mentoring" cohort metric (src/views/MetricsView.tsx).
//
// A current-state snapshot (not date-range scoped): how many people are
// currently in the SUPERVISED start (JumpStart Your Freedom) versus how many
// are in ongoing 1-on-1 mentoring (4x / 2x / 1x). Both sides count distinct
// PEOPLE (clients), and only OPEN engagements — an engagement is open when it
// is neither complete nor canceled. Completed JumpStarts and graduated mentees
// drop out; this is "who is in the room right now", by phase.
//
// - jyf       = distinct clients with an open JumpStart ("jumpstart") engagement.
// - mentoring = distinct clients with an open 4x / 2x / 1x engagement.
// - byTier    = distinct clients per ongoing tier. A person with two open
//               mentoring engagements of different tiers (rare) appears under
//               both, so the byTier values can sum to MORE than `mentoring`;
//               `mentoring` is the de-duplicated headline.
//
// Tier resolution is delegated to engagementTier() so it stays in lockstep with
// the rest of the app. Exclusions (placeholder/group clients, staff-excluded
// test mentees) are applied by the caller before handing engagements here.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §15.

import { engagementTier } from "./config";
import { normalizeTemplateName } from "./payGroups";

export interface CohortEngagementInput {
  clientId: number;
  name: string | null;
  isComplete: boolean | null;
  isCanceled: boolean | null;
  // The person's display name (ca_clients). Only the CSV export reads it; the
  // counts never do, so it is optional and older callers/tests still compile.
  clientName?: string | null;
}

export type MentoringTier = "4x" | "2x" | "1x";

export interface JyfVsMentoring {
  jyf: number; // distinct clients with an open JumpStart engagement
  mentoring: number; // distinct clients with an open 4x/2x/1x engagement
  byTier: Record<MentoringTier, number>; // distinct clients per ongoing tier (may overlap)
  total: number; // distinct clients in either bucket (de-duplicated)
}

const MENTORING_TIERS: ReadonlySet<string> = new Set<MentoringTier>(["4x", "2x", "1x"]);

// ---------------------------------------------------------------------------
// Cohort settings (the ⚙ in the corner of the card): which engagement NAMES
// fall into which cohort. By default a name's cohort comes from engagementTier()
// ("auto"): JumpStart / 0x / JYF names → JYF, 4x / 2x / 1x names → that tier,
// everything else → not counted. An override pins one name to a cohort, or
// switches it off ("not counted") — e.g. an "IMN Subscription" that reads as
// JYF by name but shouldn't be in the JYF count. Keyed by the normalized name
// (whitespace collapsed, lowercased) so incidental drift in CA never splits a
// setting. Org-wide: stored as a JSON string in app_settings under
// `jyf_cohort_overrides` (migration 9960), edited on the card itself.
// ---------------------------------------------------------------------------

export type JyfCohortKey = "jyf" | "4x" | "2x" | "1x";

// What a name counts as when overridden: a cohort, or "off" (not counted).
export type JyfCohortAssignment = JyfCohortKey | "off";

export interface JyfCohortOverrides {
  // normalized engagement name → assignment. Only names that differ from auto
  // need an entry, but an entry equal to auto is harmless (it is "pinned").
  byName: Record<string, JyfCohortAssignment>;
}

export const JYF_COHORT_OVERRIDES_KEY = "jyf_cohort_overrides";

export const DEFAULT_JYF_COHORT_OVERRIDES: JyfCohortOverrides = { byName: {} };

const ASSIGNMENTS: ReadonlySet<string> = new Set<JyfCohortAssignment>([
  "jyf",
  "4x",
  "2x",
  "1x",
  "off",
]);

export function isJyfCohortAssignment(x: unknown): x is JyfCohortAssignment {
  return typeof x === "string" && ASSIGNMENTS.has(x);
}

// The cohort a name gets with NO overrides (from its wording alone).
export function autoJyfCohort(name: string | null | undefined): JyfCohortKey | null {
  const tier = engagementTier(name);
  if (tier === "jumpstart") return "jyf";
  return MENTORING_TIERS.has(tier) ? (tier as MentoringTier) : null;
}

// The override for a name, if any (null when the name is on auto).
export function jyfOverrideFor(
  name: string | null | undefined,
  overrides: JyfCohortOverrides | undefined,
): JyfCohortAssignment | null {
  if (!overrides) return null;
  const v = overrides.byName[normalizeTemplateName(name)];
  return isJyfCohortAssignment(v) ? v : null;
}

// The cohort a name counts toward on the card: its override when it has one
// ("off" → null, i.e. not counted), else the auto cohort.
export function resolveJyfCohort(
  name: string | null | undefined,
  overrides?: JyfCohortOverrides,
): JyfCohortKey | null {
  const o = jyfOverrideFor(name, overrides);
  if (o) return o === "off" ? null : o;
  return autoJyfCohort(name);
}

// Set (or clear, with null) the override for one name. Returns a new object;
// an override equal to the name's auto cohort is dropped, so the stored config
// only ever lists real deviations.
export function setJyfOverride(
  overrides: JyfCohortOverrides,
  name: string,
  assignment: JyfCohortAssignment | null,
): JyfCohortOverrides {
  const key = normalizeTemplateName(name);
  const byName = { ...overrides.byName };
  const auto = autoJyfCohort(name) ?? "off";
  if (!key || assignment == null || assignment === auto) delete byName[key];
  else byName[key] = assignment;
  return { byName };
}

export function countJyfOverrides(overrides: JyfCohortOverrides | undefined): number {
  return overrides ? Object.keys(overrides.byName).length : 0;
}

// Stored form: a JSON string (app_settings rides string values). Unknown keys
// and bad assignments are dropped on parse; malformed JSON → no overrides.
export function parseJyfCohortOverrides(raw: string | null | undefined): JyfCohortOverrides {
  if (!raw) return { byName: {} };
  try {
    const v = JSON.parse(raw) as { byName?: unknown } | null;
    const src =
      v && typeof v === "object" && v.byName && typeof v.byName === "object" ? v.byName : {};
    const byName: Record<string, JyfCohortAssignment> = {};
    for (const [k, a] of Object.entries(src as Record<string, unknown>)) {
      const key = normalizeTemplateName(k);
      if (key && isJyfCohortAssignment(a)) byName[key] = a;
    }
    return { byName };
  } catch {
    return { byName: {} };
  }
}

export function serializeJyfCohortOverrides(overrides: JyfCohortOverrides): string {
  const keys = Object.keys(overrides.byName).sort();
  const byName: Record<string, JyfCohortAssignment> = {};
  for (const k of keys) byName[k] = overrides.byName[k];
  return JSON.stringify({ byName });
}

// One row of the settings dialog: an engagement name as it appears in CA, what
// it counts as automatically, its override (if any), the cohort it ends up in,
// and how many distinct people hold it (open today / ever). Names are merged
// by normalized key; the first spelling seen is the display name.
export interface JyfEngagementNameRow {
  key: string; // normalized name
  name: string; // display spelling
  auto: JyfCohortKey | null;
  override: JyfCohortAssignment | null;
  effective: JyfCohortKey | null;
  openPeople: number; // distinct clients with this engagement open today
  allPeople: number; // distinct clients that ever had it
}

export function jyfEngagementNames(
  engagements: CohortEngagementInput[],
  overrides?: JyfCohortOverrides,
): JyfEngagementNameRow[] {
  const m = new Map<string, { name: string; open: Set<number>; all: Set<number> }>();
  for (const e of engagements) {
    if (e.clientId == null) continue;
    const key = normalizeTemplateName(e.name);
    if (!key) continue;
    let x = m.get(key);
    if (!x) {
      x = { name: (e.name ?? "").replace(/\s+/g, " ").trim(), open: new Set(), all: new Set() };
      m.set(key, x);
    }
    x.all.add(e.clientId);
    if (!e.isComplete && !e.isCanceled) x.open.add(e.clientId);
  }
  // Overridden names with no engagement rows (e.g. a template renamed in CA)
  // still show, so a stale setting can be seen and cleared.
  for (const key of Object.keys(overrides?.byName ?? {})) {
    if (!m.has(key)) m.set(key, { name: key, open: new Set(), all: new Set() });
  }
  const rows: JyfEngagementNameRow[] = [...m.entries()].map(([key, x]) => ({
    key,
    name: x.name,
    auto: autoJyfCohort(x.name),
    override: jyfOverrideFor(x.name, overrides),
    effective: resolveJyfCohort(x.name, overrides),
    openPeople: x.open.size,
    allPeople: x.all.size,
  }));
  rows.sort(
    (a, b) =>
      b.openPeople - a.openPeople ||
      b.allPeople - a.allPeople ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return rows;
}

export function computeJyfVsMentoring(
  engagements: CohortEngagementInput[],
  overrides?: JyfCohortOverrides,
): JyfVsMentoring {
  const jyfClients = new Set<number>();
  const mentoringClients = new Set<number>();
  const tierClients: Record<MentoringTier, Set<number>> = {
    "4x": new Set<number>(),
    "2x": new Set<number>(),
    "1x": new Set<number>(),
  };
  for (const e of engagements) {
    if (e.clientId == null) continue;
    if (e.isComplete || e.isCanceled) continue; // only open / active engagements
    const cohort = resolveJyfCohort(e.name, overrides);
    if (cohort === "jyf") {
      jyfClients.add(e.clientId);
    } else if (cohort) {
      mentoringClients.add(e.clientId);
      tierClients[cohort].add(e.clientId);
    }
  }
  return {
    jyf: jyfClients.size,
    mentoring: mentoringClients.size,
    byTier: {
      "4x": tierClients["4x"].size,
      "2x": tierClients["2x"].size,
      "1x": tierClients["1x"].size,
    },
    total: new Set<number>([...jyfClients, ...mentoringClients]).size,
  };
}

// ---------------------------------------------------------------------------
// Point-in-time reconstruction ("what would this card have shown on day D?").
//
// The mirror keeps no history of the card's numbers, but every engagement row
// carries the dates that decide whether it was open on a given day:
//   dateAdded  — when it was created in CoachAccountable (it can't have been
//                counted before that, whatever its start date);
//   dateClosed — when it was completed or canceled (null while it is open).
// So an engagement was OPEN as of D when it existed by D and had not been
// closed by D. Two fallbacks cover missing dates: existence falls back to
// startDate (and to "assume it existed" when both are missing, mirroring the
// live card, which never looks at dates); a COMPLETED engagement with no
// dateClosed falls back to its endDate (CA can close "as of the end date").
// A closed engagement with no usable close date is UNKNOWN: it is left out of
// the past snapshot and counted in `unknownClose` so the UI can say so.
//
// Limits (stated in the help article): the mirror never drops engagements that
// were deleted in CA, exclusions and tier names are today's, and a re-opened
// engagement reads as open for the whole interval.
// ---------------------------------------------------------------------------

export interface CohortEngagementAsOfInput extends CohortEngagementInput {
  dateAdded: string | null; // YYYY-MM-DD — created in CA
  startDate: string | null; // YYYY-MM-DD — fallback for existence
  dateClosed: string | null; // YYYY-MM-DD — completed/canceled on (null while open)
  endDate: string | null; // YYYY-MM-DD — fallback close for a completed engagement
}

export type AsOfState = "open" | "not_yet" | "closed" | "unknown_close";

// State of one engagement at the END of day `asOf` (YYYY-MM-DD). Dates compare
// as strings (ISO order == chronological order).
export function engagementStateAsOf(e: CohortEngagementAsOfInput, asOf: string): AsOfState {
  const existedBy = e.dateAdded ?? e.startDate;
  if (existedBy != null && existedBy > asOf) return "not_yet";
  if (!e.isComplete && !e.isCanceled) return "open";
  const closedOn = e.dateClosed ?? (e.isComplete ? e.endDate : null);
  if (closedOn == null) return "unknown_close";
  return closedOn > asOf ? "open" : "closed";
}

export interface JyfVsMentoringAsOf extends JyfVsMentoring {
  asOf: string; // the day this snapshot reconstructs (YYYY-MM-DD)
  unknownClose: number; // pipeline engagements closed on an unknown date, left out
}

// The card's numbers as they would have read on day `asOf`. For asOf = today
// this reproduces computeJyfVsMentoring on the same rows (verify §28).
export function computeJyfVsMentoringAsOf(
  engagements: CohortEngagementAsOfInput[],
  asOf: string,
  overrides?: JyfCohortOverrides,
): JyfVsMentoringAsOf {
  const open: CohortEngagementInput[] = [];
  let unknownClose = 0;
  for (const e of engagements) {
    if (e.clientId == null) continue;
    const state = engagementStateAsOf(e, asOf);
    if (state === "open") {
      open.push({ clientId: e.clientId, name: e.name, isComplete: false, isCanceled: false });
    } else if (state === "unknown_close") {
      if (resolveJyfCohort(e.name, overrides)) unknownClose++;
    }
  }
  return { ...computeJyfVsMentoring(open, overrides), asOf, unknownClose };
}

// ---------------------------------------------------------------------------
// Roster ("Export CSV"): WHO is behind each number on the card.
//
// One row per (cohort, person) — the same distinct-people rule as the counts,
// so filtering the rows by cohort reproduces the tiles exactly: the JYF rows
// number `jyf`, the 4x rows `byTier["4x"]`, and so on. A person with two open
// engagements in the same tier is one row listing both engagement names; a
// person in two different cohorts is one row per cohort (like the tiles).
// With `asOf`, membership is decided by engagementStateAsOf (the compare
// tool's reconstruction); without it, by today's open/closed flags.
// ---------------------------------------------------------------------------

export const JYF_COHORT_LABELS: Record<JyfCohortKey, string> = {
  jyf: "JumpStart (JYF)",
  "4x": "Active Mentoring — 4x",
  "2x": "Active Mentoring — 2x",
  "1x": "Active Mentoring — 1x",
};

// Labels for the settings dialog's "Counts as" choices (the cohorts + "off").
export const JYF_ASSIGNMENT_LABELS: Record<JyfCohortAssignment, string> = {
  ...JYF_COHORT_LABELS,
  off: "Not counted",
};

const JYF_COHORT_ORDER: readonly JyfCohortKey[] = ["jyf", "4x", "2x", "1x"];

export interface JyfRosterRow {
  cohort: JyfCohortKey;
  clientId: number;
  clientName: string | null;
  engagements: string; // open engagement name(s) in this cohort, " / "-joined
  startDate: string | null; // earliest start_date across those engagements
  dateAdded: string | null; // earliest date_added across those engagements
}

function minDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a < b ? a : b;
}

export function jyfVsMentoringRoster(
  engagements: CohortEngagementAsOfInput[],
  asOf?: string,
  overrides?: JyfCohortOverrides,
): JyfRosterRow[] {
  const byKey = new Map<string, JyfRosterRow & { names: Set<string> }>();
  for (const e of engagements) {
    if (e.clientId == null) continue;
    const open = asOf ? engagementStateAsOf(e, asOf) === "open" : !e.isComplete && !e.isCanceled;
    if (!open) continue;
    const cohort = resolveJyfCohort(e.name, overrides);
    if (!cohort) continue;
    const key = `${cohort}:${e.clientId}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        cohort,
        clientId: e.clientId,
        clientName: e.clientName ?? null,
        engagements: "",
        startDate: null,
        dateAdded: null,
        names: new Set<string>(),
      };
      byKey.set(key, row);
    }
    if (e.name) row.names.add(e.name);
    if (!row.clientName && e.clientName) row.clientName = e.clientName;
    row.startDate = minDate(row.startDate, e.startDate);
    row.dateAdded = minDate(row.dateAdded, e.dateAdded);
  }
  const rows: JyfRosterRow[] = [...byKey.values()].map(({ names, ...r }) => ({
    ...r,
    engagements: [...names].join(" / "),
  }));
  rows.sort((a, b) => {
    const c = JYF_COHORT_ORDER.indexOf(a.cohort) - JYF_COHORT_ORDER.indexOf(b.cohort);
    if (c !== 0) return c;
    const an = (a.clientName ?? "").toLowerCase();
    const bn = (b.clientName ?? "").toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.clientId - b.clientId;
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Drill-down ("who makes up each cohort"): the card's table rows open into the
// people behind them. Six groups, matching the six table rows:
//   jyf / 4x / 2x / 1x — one member per roster row of that cohort;
//   mentoring          — distinct people across 4x/2x/1x (= the headline);
//   total              — distinct people across all four (= "Total in pipeline").
// A person in several cohorts is ONE member of `mentoring` / `total`, with
// every cohort they're in listed in `cohorts`. Group sizes equal the tiles.
// ---------------------------------------------------------------------------

export type JyfGroupKey = "jyf" | "mentoring" | "4x" | "2x" | "1x" | "total";

export interface JyfMember {
  clientId: number;
  clientName: string | null;
  cohorts: JyfCohortKey[]; // in JYF, 4x, 2x, 1x order
  engagements: string; // open engagement name(s) across those cohorts, " / "-joined
  startDate: string | null; // earliest engagement start across them
}

function byName(a: JyfMember, b: JyfMember): number {
  const an = (a.clientName ?? "").toLowerCase();
  const bn = (b.clientName ?? "").toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.clientId - b.clientId;
}

function mergeMembers(rows: JyfRosterRow[]): JyfMember[] {
  const m = new Map<number, JyfMember & { names: string[] }>();
  for (const r of rows) {
    let x = m.get(r.clientId);
    if (!x) {
      x = {
        clientId: r.clientId,
        clientName: r.clientName,
        cohorts: [],
        engagements: "",
        startDate: null,
        names: [],
      };
      m.set(r.clientId, x);
    }
    if (!x.cohorts.includes(r.cohort)) x.cohorts.push(r.cohort);
    for (const n of r.engagements.split(" / ")) if (n && !x.names.includes(n)) x.names.push(n);
    if (!x.clientName && r.clientName) x.clientName = r.clientName;
    x.startDate = minDate(x.startDate, r.startDate);
  }
  return [...m.values()]
    .map(({ names, ...x }) => ({
      ...x,
      cohorts: JYF_COHORT_ORDER.filter((k) => x.cohorts.includes(k)),
      engagements: names.join(" / "),
    }))
    .sort(byName);
}

export function jyfGroupMembers(roster: JyfRosterRow[]): Record<JyfGroupKey, JyfMember[]> {
  const of = (keys: JyfCohortKey[]) => mergeMembers(roster.filter((r) => keys.includes(r.cohort)));
  return {
    jyf: of(["jyf"]),
    mentoring: of(["4x", "2x", "1x"]),
    "4x": of(["4x"]),
    "2x": of(["2x"]),
    "1x": of(["1x"]),
    total: of(["jyf", "4x", "2x", "1x"]),
  };
}

// Compare mode: who is in a group today but wasn't on the earlier day
// (`joined`), and who was then but isn't now (`left`). By client ID.
export function diffMembers(
  now: JyfMember[],
  then: JyfMember[],
): { joined: Set<number>; left: JyfMember[] } {
  const nowIds = new Set(now.map((m) => m.clientId));
  const thenIds = new Set(then.map((m) => m.clientId));
  return {
    joined: new Set(now.filter((m) => !thenIds.has(m.clientId)).map((m) => m.clientId)),
    left: then.filter((m) => !nowIds.has(m.clientId)),
  };
}
