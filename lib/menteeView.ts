// Pure view-model + board roll-ups for the rebuilt Mentee management system
// (2026-06-24). Collapses a two-layer `mentees` row (CA layer + hand layer) into
// the EFFECTIVE values the UI shows — hand override wins over the CA value, and a
// hand-set status wins over CA's guess — and rolls those up into the pipeline-leg
// durations and (lib/menteeFunnel.ts) the funnel.
//
// No I/O, no React. Structural input (MenteeRowLike) so this never imports db.ts.
// Unit-tested in scripts/verify-metrics.ts §21.

import { type PipelineTier } from "./config.js";

// Hand-classified lifecycle status (the source-of-truth status). CA only ever
// guesses active/graduated/inactive; staff classify the real outcome here.
export type MenteeMgmtStatus = "active" | "graduated" | "quit" | "fired" | "paused" | "declined";
export const MENTEE_STATUSES: MenteeMgmtStatus[] = ["active", "graduated", "quit", "fired", "paused", "declined"];
// Statuses that END the journey somewhere other than graduation.
export const MENTEE_EXIT_STATUSES: MenteeMgmtStatus[] = ["quit", "fired", "declined"];

// Funnel stages in order. "discovery" precedes the pipeline tiers; everyone enters
// at a discovery call.
export const FUNNEL_STAGES = ["discovery", "jumpstart", "4x", "2x", "1x", "graduated"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// The subset of a `mentees` row this module reads. db.ts's MenteeRow satisfies it
// structurally (so callers pass a MenteeRow directly).
export interface MenteeRowLike {
  id: string;
  client_id: number | null;
  ca_name: string | null;
  ca_owner_coach_id: number | null;
  ca_owner_coach_name: string | null;
  ca_discovery_date: string | null;
  ca_jumpstart_date: string | null;
  ca_tier_4x_date: string | null;
  ca_tier_2x_date: string | null;
  ca_tier_1x_date: string | null;
  ca_graduation_date: string | null;
  ca_first_meeting: string | null;
  ca_last_meeting: string | null;
  ca_meeting_count: number;
  ca_jumpstart_end: string | null;
  ca_jyf_purchase_date: string | null;
  ca_start_date: string | null;
  ca_status: string | null;
  ca_synced_at: string | null;
  name_override: string | null;
  status: MenteeMgmtStatus | null;
  status_stage: string | null;
  status_date: string | null;
  discovery_date_override: string | null;
  jumpstart_date_override: string | null;
  tier_4x_date_override: string | null;
  tier_2x_date_override: string | null;
  tier_1x_date_override: string | null;
  graduation_date_override: string | null;
  owner_coach_id_override: number | null;
  is_test: boolean;
}

export interface EffectiveMentee {
  id: string;
  clientId: number | null;
  name: string;
  ownerCoachId: number | null;
  ownerCoachName: string | null;
  // Effective stage dates (hand override ?? CA).
  discoveryDate: string | null;
  jumpstartDate: string | null;
  tier4xDate: string | null;
  tier2xDate: string | null;
  tier1xDate: string | null;
  graduationDate: string | null;
  stageDates: Record<PipelineTier, string | null>; // jumpstart..graduated (for leg agg)
  firstMeeting: string | null;
  lastMeeting: string | null;
  meetingCount: number;
  jumpstartEnd: string | null;
  startDate: string | null; // system start
  currentTier: PipelineTier | null; // highest pipeline tier reached
  currentStage: FunnelStage | null; // where they are now (discovery if only a discovery call)
  status: MenteeMgmtStatus | null; // hand-classified status (null = unclassified)
  caStatus: string | null; // CA guess (active | graduated | inactive)
  resolvedStatus: string; // status ?? mapped CA guess — for roll-up filtering
  statusLabel: string; // display ("Active" / "Quit" / "Unclassified" …)
  statusStage: FunnelStage | null; // stage at exit/graduation (hand)
  statusDate: string | null;
  daysInSystem: number | null;
  syncedAt: string | null;
  isTest: boolean;
}

function dayspan(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
function maxDate(ds: (string | null)[]): string | null {
  let m: string | null = null;
  for (const d of ds) if (d && (!m || d > m)) m = d;
  return m;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Collapse a row into its effective view-model. `today` is passed in (determinism).
export function toEffectiveMentee(r: MenteeRowLike, today: string): EffectiveMentee {
  const discoveryDate = r.discovery_date_override ?? r.ca_discovery_date;
  const jumpstartDate = r.jumpstart_date_override ?? r.ca_jumpstart_date;
  const tier4xDate = r.tier_4x_date_override ?? r.ca_tier_4x_date;
  const tier2xDate = r.tier_2x_date_override ?? r.ca_tier_2x_date;
  const tier1xDate = r.tier_1x_date_override ?? r.ca_tier_1x_date;
  const graduationDate = r.graduation_date_override ?? r.ca_graduation_date;
  const stageDates: Record<PipelineTier, string | null> = {
    jumpstart: jumpstartDate,
    "4x": tier4xDate,
    "2x": tier2xDate,
    "1x": tier1xDate,
    graduated: graduationDate,
  };
  const currentTier: PipelineTier | null = graduationDate
    ? "graduated"
    : tier1xDate
    ? "1x"
    : tier2xDate
    ? "2x"
    : tier4xDate
    ? "4x"
    : jumpstartDate
    ? "jumpstart"
    : null;
  const currentStage: FunnelStage | null = currentTier ?? (discoveryDate ? "discovery" : null);

  const status = r.status ?? null;
  const caStatus = r.ca_status ?? null;
  const resolvedStatus = status ?? (caStatus === "graduated" ? "graduated" : caStatus === "active" ? "active" : "inactive");
  const statusLabel = status
    ? cap(status)
    : caStatus === "graduated"
    ? "Graduated"
    : caStatus === "active"
    ? "Active"
    : "Unclassified";

  const firstMeeting = r.ca_first_meeting;
  const lastMeeting = r.ca_last_meeting;
  const startDate = discoveryDate ?? jumpstartDate ?? r.ca_jyf_purchase_date ?? firstMeeting ?? r.ca_start_date;
  const lastActivity = lastMeeting ?? maxDate([discoveryDate, jumpstartDate, tier4xDate, tier2xDate, tier1xDate, graduationDate]);
  const isExitStatus = status != null && MENTEE_EXIT_STATUSES.includes(status);
  const exitDate =
    (isExitStatus || status === "graduated") && r.status_date
      ? r.status_date
      : graduationDate
      ? graduationDate
      : resolvedStatus === "active"
      ? today
      : lastActivity;

  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name_override ?? r.ca_name ?? (r.client_id != null ? `#${r.client_id}` : "(unnamed)"),
    ownerCoachId: r.owner_coach_id_override ?? r.ca_owner_coach_id,
    ownerCoachName: r.owner_coach_id_override != null ? `#${r.owner_coach_id_override}` : r.ca_owner_coach_name,
    discoveryDate,
    jumpstartDate,
    tier4xDate,
    tier2xDate,
    tier1xDate,
    graduationDate,
    stageDates,
    firstMeeting,
    lastMeeting,
    meetingCount: r.ca_meeting_count,
    jumpstartEnd: r.ca_jumpstart_end,
    startDate,
    currentTier,
    currentStage,
    status,
    caStatus,
    resolvedStatus,
    statusLabel,
    statusStage: (r.status_stage as FunnelStage | null) ?? null,
    statusDate: r.status_date,
    daysInSystem: dayspan(startDate, exitDate),
    syncedAt: r.ca_synced_at,
    isTest: r.is_test,
  };
}

// --- Pipeline-leg durations (the §102 board roll-up, now off effective mentees) ---
export interface LegStat {
  key: string;
  label: string;
  n: number; // mentees with this leg measurable
  avgDays: number | null;
  medianDays: number | null;
}

export function aggregateLegDurations(mentees: EffectiveMentee[]): LegStat[] {
  const items = mentees.filter((m) => !m.isTest);
  const legs: { key: string; label: string; pick: (m: EffectiveMentee) => number | null }[] = [
    { key: "dc_js", label: "Discovery → JumpStart", pick: (m) => dayspan(m.discoveryDate, m.jumpstartDate) },
    { key: "js_4x", label: "JumpStart → 4x", pick: (m) => dayspan(m.jumpstartDate, m.tier4xDate) },
    { key: "4x_2x", label: "4x → 2x", pick: (m) => dayspan(m.tier4xDate, m.tier2xDate) },
    { key: "2x_1x", label: "2x → 1x", pick: (m) => dayspan(m.tier2xDate, m.tier1xDate) },
    { key: "1x_grad", label: "1x → graduation", pick: (m) => dayspan(m.tier1xDate, m.graduationDate) },
    { key: "dc_grad", label: "Discovery → graduation", pick: (m) => dayspan(m.discoveryDate, m.graduationDate) },
  ];
  return legs.map((leg) => {
    const vals = items
      .map(leg.pick)
      .filter((v): v is number => v != null && v >= 0)
      .sort((a, b) => a - b);
    const n = vals.length;
    const avgDays = n ? Math.round(vals.reduce((s, v) => s + v, 0) / n) : null;
    const medianDays = n ? (n % 2 ? vals[(n - 1) / 2] : Math.round((vals[n / 2 - 1] + vals[n / 2]) / 2)) : null;
    return { key: leg.key, label: leg.label, n, avgDays, medianDays };
  });
}
