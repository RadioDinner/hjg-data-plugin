// Pure view-model + board roll-ups for the rewritten Mentee management system
// (2026-06-27, session 010). Collapses a THREE-ZONE `mentees` row into the
// EFFECTIVE values the UI shows:
//
//   * CA zone     (ca_*)      — synced CoachAccountable facts
//   * NOTION zone (notion_*)  — the human record imported from Notion
//   * HAND zone   (*_override / status* / notes) — staff edits, source of truth
//
// Shared fields resolve hand ?? notion ?? ca; single-owner fields pass through
// their zone. Disagreements between zones are surfaced as `conflicts` so the
// detail panel can show CA / Notion / Hand side-by-side with one-click
// "accept into hand". Also rolls effective mentees up into the pipeline-leg
// durations and (lib/menteeFunnel.ts) the funnel.
//
// No I/O, no React. Structural input (MenteeRowLike) so this never imports db.ts.
// Unit-tested in scripts/verify-metrics.ts §21.

import { type PipelineTier } from "./config.js";

// Hand-classified lifecycle status (the source-of-truth status). CA only ever
// guesses active/graduated/inactive; staff classify the real outcome here.
//  - quit / fired / no_mentoring / declined END the journey somewhere other than
//    graduation.
//  - imn ("Independent Mentor") is kept on the roster but sits OUTSIDE the funnel.
export type MenteeMgmtStatus = "active" | "graduated" | "quit" | "fired" | "no_mentoring" | "declined" | "imn";
export const MENTEE_STATUSES: MenteeMgmtStatus[] = ["active", "graduated", "quit", "fired", "no_mentoring", "declined", "imn"];
// Statuses that END the journey somewhere other than graduation.
export const MENTEE_EXIT_STATUSES: MenteeMgmtStatus[] = ["quit", "fired", "no_mentoring", "declined"];
// Statuses kept on the roster but excluded from the funnel.
export const OUT_OF_FUNNEL_STATUSES: MenteeMgmtStatus[] = ["imn"];

const STATUS_LABEL: Record<MenteeMgmtStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  quit: "Quit",
  fired: "Fired",
  no_mentoring: "No mentoring",
  declined: "Declined",
  imn: "IMN",
};

// Funnel stages in order. The pre-mentoring stages (pre_waiting → discovery →
// jumpstart) are strictly sequential; graduation is reachable directly from 4x,
// 2x, or 1x (HJG graduates can skip later tiers).
export const FUNNEL_STAGES = ["pre_waiting", "discovery", "jumpstart", "4x", "2x", "1x", "graduated"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
// The normal sequential path (Discovery onward). Used to infer that a mentee at
// stage k also passed through every earlier stage on this path. pre_waiting is a
// RARE opt-in holding stage (demand overflow), so it is deliberately NOT here —
// it is only "reached" via explicit evidence (a pre_waiting date or a status that
// maps to pre_waiting), never inferred from a later position.
const INFERRABLE_STAGES: FunnelStage[] = ["discovery", "jumpstart", "4x", "2x", "1x"];

// Notion "Status" → lifecycle. Drives the effective status when the hand layer
// hasn't classified the mentee. `stage` places ACTIVE mentees in the funnel;
// `coarse` marks an exit Notion lumps together (staff refine it by hand).
export interface NotionStatusMapping {
  status: MenteeMgmtStatus;
  stage?: FunnelStage;
  coarse?: boolean;
}
export const NOTION_STATUS_MAP: Record<string, NotionStatusMapping> = {
  "pre-waiting list": { status: "active", stage: "pre_waiting" },
  "discovery call": { status: "active", stage: "discovery" },
  "waiting list (jyf)": { status: "active", stage: "jumpstart" },
  "4x mentoring": { status: "active", stage: "4x" },
  "2x mentoring": { status: "active", stage: "2x" },
  "1x mentoring": { status: "active", stage: "1x" },
  "done (graduated)": { status: "graduated", stage: "graduated" },
  "done (quit or no mentoring)": { status: "quit", coarse: true }, // hand can split quit/no_mentoring
  "done (other)": { status: "declined", coarse: true }, // hand can refine fired/declined/other
  imn: { status: "imn" },
};

export function mapNotionStatus(raw: string | null | undefined): NotionStatusMapping | undefined {
  if (!raw) return undefined;
  return NOTION_STATUS_MAP[raw.trim().toLowerCase()];
}

// The subset of a `mentees` row this module reads. db.ts's MenteeRow satisfies it
// structurally (so callers pass a MenteeRow directly).
export interface MenteeRowLike {
  id: string;
  client_id: number | null;
  // CA zone
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
  // Notion zone
  notion_name: string | null;
  notion_status: string | null;
  notion_coach: string | null;
  notion_coach_conflict: boolean;
  notion_email: string | null;
  notion_phone: string | null;
  notion_dc_date: string | null;
  notion_offering_signup: string | null;
  notion_imported_at: string | null;
  // Hand zone
  name_override: string | null;
  status: MenteeMgmtStatus | null;
  status_stage: string | null;
  status_date: string | null;
  pre_waiting_date_override: string | null;
  discovery_date_override: string | null;
  jumpstart_date_override: string | null;
  tier_4x_date_override: string | null;
  tier_2x_date_override: string | null;
  tier_1x_date_override: string | null;
  graduation_date_override: string | null;
  owner_coach_id_override: number | null;
  email_override: string | null;
  phone_override: string | null;
  coach_override: string | null;
  is_test: boolean;
}

// One disagreement between zones for a shared field (rendered in the detail panel).
export interface MenteeConflict {
  field: string; // "name" | "coach" | "email" | "phone" | "discoveryDate" | "status"
  label: string;
  ca: string | null;
  notion: string | null;
  hand: string | null;
  resolved: string | null; // the effective value (hand ?? notion ?? ca)
}

export interface EffectiveMentee {
  id: string;
  clientId: number | null;
  name: string;
  ownerCoachId: number | null;
  ownerCoachName: string | null; // coach_override ?? notion_coach ?? ca_owner_coach_name
  email: string | null; // email_override ?? notion_email
  phone: string | null; // phone_override ?? notion_phone
  offeringSignup: string | null; // notion only
  // Effective stage dates (hand override ?? notion (discovery only) ?? CA).
  preWaitingDate: string | null;
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
  currentTier: PipelineTier | null; // highest pipeline tier reached (by date)
  currentStage: FunnelStage | null; // where they are now
  mappedStage: FunnelStage | null; // stage implied by hand status_stage / Notion status
  status: MenteeMgmtStatus | null; // hand-classified status (null = unclassified)
  notionStatus: string | null; // raw Notion status text
  effectiveStatus: MenteeMgmtStatus | null; // hand ?? Notion-derived (canonical lifecycle)
  coarseExit: boolean; // effective status came from a coarse Notion exit, not yet hand-refined
  caStatus: string | null; // CA guess (active | graduated | inactive)
  resolvedStatus: string; // effective ?? mapped CA guess — for roll-up filtering
  statusLabel: string; // display ("Active" / "Quit" / "Unclassified" …)
  statusStage: FunnelStage | null; // stage at exit/graduation (hand)
  statusDate: string | null;
  daysInSystem: number | null;
  syncedAt: string | null;
  importedAt: string | null;
  notionCoachConflict: boolean; // Mentor 1 ≠ Mentor in Notion
  conflicts: MenteeConflict[];
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
function norm(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
// A conflict exists when ≥2 zones hold non-empty values that disagree (normalized),
// or when `force` is set (e.g. the intra-Notion Mentor 1 ≠ Mentor flag).
function buildConflict(field: string, label: string, ca: string | null, notion: string | null, hand: string | null, force = false): MenteeConflict | null {
  const distinct = new Set([ca, notion, hand].filter((v) => v != null && String(v).trim() !== "").map((v) => norm(String(v))));
  if (!force && distinct.size < 2) return null;
  return { field, label, ca: ca ?? null, notion: notion ?? null, hand: hand ?? null, resolved: hand ?? notion ?? ca ?? null };
}

// Collapse a row into its effective view-model. `today` is passed in (determinism).
export function toEffectiveMentee(r: MenteeRowLike, today: string): EffectiveMentee {
  // Stage dates: hand override ?? (Notion DC for discovery) ?? CA.
  const preWaitingDate = r.pre_waiting_date_override ?? null;
  const discoveryDate = r.discovery_date_override ?? r.notion_dc_date ?? r.ca_discovery_date;
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

  // Status: hand ?? Notion-derived ?? (CA guess for display only).
  const handStatus = r.status ?? null;
  const notionDerived = mapNotionStatus(r.notion_status);
  const effectiveStatus: MenteeMgmtStatus | null = handStatus ?? notionDerived?.status ?? null;
  const coarseExit = handStatus == null && notionDerived?.coarse === true;
  const caStatus = r.ca_status ?? null;

  // Stage implied by the status (hand status_stage wins, else Notion's mapped stage).
  const handStage = (r.status_stage as FunnelStage | null) ?? null;
  const mappedStage: FunnelStage | null = handStage ?? notionDerived?.stage ?? null;

  // Date-derived furthest stage, then fall back to the status-mapped stage.
  const dateStage: FunnelStage | null = currentTier ?? (discoveryDate ? "discovery" : preWaitingDate ? "pre_waiting" : null);
  const currentStage: FunnelStage | null = dateStage ?? mappedStage;

  const resolvedStatus = effectiveStatus ?? (caStatus === "graduated" ? "graduated" : caStatus === "active" ? "active" : "inactive");
  const statusLabel = effectiveStatus
    ? STATUS_LABEL[effectiveStatus]
    : caStatus === "graduated"
    ? "Graduated"
    : caStatus === "active"
    ? "Active"
    : "Unclassified";

  // Shared-field three-zone resolution.
  const name = r.name_override ?? r.notion_name ?? r.ca_name ?? (r.client_id != null ? `#${r.client_id}` : "(unnamed)");
  const email = r.email_override ?? r.notion_email ?? null;
  const phone = r.phone_override ?? r.notion_phone ?? null;
  const ownerCoachName = r.coach_override ?? r.notion_coach ?? r.ca_owner_coach_name ?? null;
  const ownerCoachId = r.owner_coach_id_override ?? r.ca_owner_coach_id;

  const firstMeeting = r.ca_first_meeting;
  const lastMeeting = r.ca_last_meeting;
  const startDate = preWaitingDate ?? discoveryDate ?? jumpstartDate ?? r.ca_jyf_purchase_date ?? firstMeeting ?? r.ca_start_date;
  const lastActivity = lastMeeting ?? maxDate([discoveryDate, jumpstartDate, tier4xDate, tier2xDate, tier1xDate, graduationDate]);
  const isExitStatus = effectiveStatus != null && MENTEE_EXIT_STATUSES.includes(effectiveStatus);
  const exitDate =
    (isExitStatus || effectiveStatus === "graduated") && r.status_date
      ? r.status_date
      : graduationDate
      ? graduationDate
      : resolvedStatus === "active"
      ? today
      : lastActivity;

  // Conflicts across zones (shared fields only).
  const conflicts: MenteeConflict[] = [];
  const push = (c: MenteeConflict | null) => {
    if (c) conflicts.push(c);
  };
  push(buildConflict("name", "Name", r.ca_name, r.notion_name, r.name_override));
  push(buildConflict("coach", "Coach", r.ca_owner_coach_name, r.notion_coach, r.coach_override, r.notion_coach_conflict));
  push(buildConflict("email", "Email", null, r.notion_email, r.email_override));
  push(buildConflict("phone", "Phone", null, r.notion_phone, r.phone_override));
  push(buildConflict("discoveryDate", "Discovery date", r.ca_discovery_date, r.notion_dc_date, r.discovery_date_override));
  // Status: Notion-derived vs hand classification.
  if (handStatus && notionDerived && handStatus !== notionDerived.status) {
    push({ field: "status", label: "Status", ca: caStatus, notion: r.notion_status, hand: STATUS_LABEL[handStatus], resolved: STATUS_LABEL[handStatus] });
  }

  return {
    id: r.id,
    clientId: r.client_id,
    name,
    ownerCoachId,
    ownerCoachName,
    email,
    phone,
    offeringSignup: r.notion_offering_signup ?? null,
    preWaitingDate,
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
    mappedStage,
    status: handStatus,
    notionStatus: r.notion_status ?? null,
    effectiveStatus,
    coarseExit,
    caStatus,
    resolvedStatus,
    statusLabel,
    statusStage: handStage,
    statusDate: r.status_date,
    daysInSystem: dayspan(startDate, exitDate),
    syncedAt: r.ca_synced_at,
    importedAt: r.notion_imported_at,
    notionCoachConflict: r.notion_coach_conflict,
    conflicts,
    isTest: r.is_test,
  };
}

// True when the mentee reached `stage`: a stage DATE for it, or — for the
// sequential pre-graduation stages — their status places them at or beyond it.
export function reachedStage(m: EffectiveMentee, stage: FunnelStage): boolean {
  if (stage === "graduated") return m.graduationDate != null || m.effectiveStatus === "graduated";
  const hasDate: Record<Exclude<FunnelStage, "graduated">, boolean> = {
    pre_waiting: m.preWaitingDate != null,
    discovery: m.discoveryDate != null,
    jumpstart: m.jumpstartDate != null,
    "4x": m.tier4xDate != null,
    "2x": m.tier2xDate != null,
    "1x": m.tier1xDate != null,
  };
  if (hasDate[stage]) return true;
  // Explicit status-at-this-stage (covers the rare pre_waiting).
  if (m.mappedStage === stage) return true;
  // Cumulative forward-fill on the normal path: at stage k ⇒ passed every
  // earlier inferrable stage (Discovery onward; pre_waiting is never inferred).
  const mi = m.mappedStage ? INFERRABLE_STAGES.indexOf(m.mappedStage) : -1;
  const si = INFERRABLE_STAGES.indexOf(stage);
  return mi >= 0 && si >= 0 && si < mi;
}

// --- Pipeline-leg durations (the §102 board roll-up, off effective mentees) ---
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
