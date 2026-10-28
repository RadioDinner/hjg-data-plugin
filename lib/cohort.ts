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

export function computeJyfVsMentoring(engagements: CohortEngagementInput[]): JyfVsMentoring {
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
    const tier = engagementTier(e.name);
    if (tier === "jumpstart") {
      jyfClients.add(e.clientId);
    } else if (MENTORING_TIERS.has(tier)) {
      mentoringClients.add(e.clientId);
      tierClients[tier as MentoringTier].add(e.clientId);
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
): JyfVsMentoringAsOf {
  const open: CohortEngagementInput[] = [];
  let unknownClose = 0;
  for (const e of engagements) {
    if (e.clientId == null) continue;
    const state = engagementStateAsOf(e, asOf);
    if (state === "open") {
      open.push({ clientId: e.clientId, name: e.name, isComplete: false, isCanceled: false });
    } else if (state === "unknown_close") {
      const tier = engagementTier(e.name);
      if (tier === "jumpstart" || MENTORING_TIERS.has(tier)) unknownClose++;
    }
  }
  return { ...computeJyfVsMentoring(open), asOf, unknownClose };
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

export type JyfCohortKey = "jyf" | "4x" | "2x" | "1x";

export const JYF_COHORT_LABELS: Record<JyfCohortKey, string> = {
  jyf: "JumpStart (JYF)",
  "4x": "Active Mentoring — 4x",
  "2x": "Active Mentoring — 2x",
  "1x": "Active Mentoring — 1x",
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
): JyfRosterRow[] {
  const byKey = new Map<string, JyfRosterRow & { names: Set<string> }>();
  for (const e of engagements) {
    if (e.clientId == null) continue;
    const open = asOf ? engagementStateAsOf(e, asOf) === "open" : !e.isComplete && !e.isCanceled;
    if (!open) continue;
    const tier = engagementTier(e.name);
    const cohort: JyfCohortKey | null =
      tier === "jumpstart" ? "jyf" : MENTORING_TIERS.has(tier) ? (tier as MentoringTier) : null;
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
