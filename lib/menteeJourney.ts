// Pure derivation of a mentee's CA layer from CoachAccountable history. This is
// the "first layer" of the rebuilt Mentee management system (2026-06-24): the
// objective facts CA knows about each mentee — owner coach, pipeline stage dates,
// meeting counts, current tier, a coarse status guess — computed from the synced
// ca_* mirror tables.
//
// It feeds the CA columns of the `mentees` source-of-truth table (migration 9975),
// written by the sync (lib/sync.ts) and the manual "Rebuild from CA" path
// (src/db.ts rebuildMenteesFromCa). The HAND layer (status / *_override / notes /
// is_test) is the staff source of truth and is NEVER written here — a CA refresh
// only ever touches the ca_* columns.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §20.

import { PIPELINE_TIERS, type PipelineTier, engagementTier } from "./config.js";
import { computeStageDates, highestTier, type StageBasis, type EngagementStageInput, type MeetingStageInput } from "./journey.js";

// A mentee with no activity for this many days (and no open engagement) is guessed
// "inactive". Matches the legacy Journeys window so behavior doesn't shift.
export const MENTEE_ACTIVE_WINDOW_DAYS = 45;

export interface CaClientInput {
  id: number;
  name: string | null;
  coachId: number | null; // CA primary coach = the mentee's OWNER
  isExcluded: boolean; // compile-time placeholder/group client — dropped entirely
}
export interface CaEngagementInput {
  id: number | null;
  clientId: number | null;
  name: string | null; // parsed into a pipeline tier
  startDate: string | null;
  endDate: string | null;
  isComplete: boolean;
  isCanceled: boolean;
}
export interface CaAppointmentInput {
  clientId: number | null;
  coachId: number | null;
  engagementId: number | null;
  category: string; // 'mentoring' | 'group' | 'discoveryPhone' | 'discoveryZoom' | …
  date: string | null; // YYYY-MM-DD (start_date)
}
export interface CaCoachInput {
  id: number;
  name: string | null;
}
export interface JyfPurchaseInput {
  clientId: number;
  date: string; // YYYY-MM-DD supervised-JumpStart purchase
}

// CA's coarse status guess. The hand layer's status overrides it.
export type CaMenteeStatus = "active" | "graduated" | "inactive";

export interface MenteeCaRecord {
  clientId: number;
  name: string | null;
  ownerCoachId: number | null;
  ownerCoachName: string | null;
  ownerSource: "primary" | "fallback" | "none";
  discoveryDate: string | null;
  jumpstartDate: string | null;
  tier4xDate: string | null;
  tier2xDate: string | null;
  tier1xDate: string | null;
  graduationDate: string | null;
  firstMeeting: string | null;
  lastMeeting: string | null;
  meetingCount: number;
  currentTier: PipelineTier | null;
  jumpstartEnd: string | null; // latest JumpStart engagement end (completion)
  jyfPurchaseDate: string | null;
  startDate: string | null; // system start: discovery → jumpstart → JYF purchase → first meeting
  hasOpen: boolean; // any pipeline engagement still open
  status: CaMenteeStatus;
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

// Derive one CA record per mentee. A "mentee" is any non-excluded CA client with
// at least one funnel signal: a discovery call, a mentoring/group meeting, a
// pipeline engagement, or a supervised-JumpStart purchase. (Discovery-only clients
// ARE included so the funnel can count who declined after a discovery call.)
export function deriveMenteeCaRecords(input: {
  clients: CaClientInput[];
  engagements: CaEngagementInput[];
  appointments: CaAppointmentInput[];
  coaches: CaCoachInput[];
  purchases: JyfPurchaseInput[];
  today: string; // YYYY-MM-DD anchor (passed in for determinism)
  basis?: StageBasis; // defaults to first_meeting (the pinned production basis)
}): MenteeCaRecord[] {
  const basis: StageBasis = input.basis ?? "first_meeting";
  const pipeline = new Set<string>(PIPELINE_TIERS);

  const coachMap = new Map<number, string | null>();
  for (const c of input.coaches) coachMap.set(c.id, c.name);

  const clientMap = new Map<number, CaClientInput>();
  for (const c of input.clients) if (!c.isExcluded) clientMap.set(c.id, c);

  // engagement id -> pipeline tier (skip mentor_training / group / other).
  const engTierById = new Map<number, PipelineTier>();
  for (const e of input.engagements) {
    if (e.id == null || e.clientId == null) continue;
    const t = engagementTier(e.name);
    if (pipeline.has(t)) engTierById.set(e.id, t as PipelineTier);
  }

  // per-client engagement stage inputs + open flag + JumpStart end date.
  const engByClient = new Map<number, EngagementStageInput[]>();
  const hasOpen = new Map<number, boolean>();
  const jumpstartEnd = new Map<number, string>();
  for (const e of input.engagements) {
    if (e.clientId == null || !clientMap.has(e.clientId)) continue;
    const t = engagementTier(e.name);
    if (!pipeline.has(t)) continue;
    const pt = t as PipelineTier;
    const arr = engByClient.get(e.clientId) ?? [];
    arr.push({ tier: pt, startDate: e.startDate });
    engByClient.set(e.clientId, arr);
    if (!e.isComplete && !e.isCanceled) hasOpen.set(e.clientId, true);
    if (pt === "jumpstart" && e.endDate) {
      const cur = jumpstartEnd.get(e.clientId);
      if (!cur || e.endDate > cur) jumpstartEnd.set(e.clientId, e.endDate);
    }
  }

  // per-client meetings (mentoring + group) and the earliest discovery date.
  interface Mtg {
    date: string;
    tier: PipelineTier | null;
    isGroup: boolean;
    coachId: number | null;
  }
  const meetsByClient = new Map<number, Mtg[]>();
  const discoveryByClient = new Map<number, string>();
  for (const a of input.appointments) {
    if (a.clientId == null || !clientMap.has(a.clientId)) continue;
    if (a.category === "discoveryPhone" || a.category === "discoveryZoom") {
      if (a.date) {
        const cur = discoveryByClient.get(a.clientId);
        if (!cur || a.date < cur) discoveryByClient.set(a.clientId, a.date);
      }
      continue;
    }
    if ((a.category === "mentoring" || a.category === "group") && a.date) {
      const arr = meetsByClient.get(a.clientId) ?? [];
      arr.push({
        date: a.date,
        tier: a.engagementId != null ? engTierById.get(a.engagementId) ?? null : null,
        isGroup: a.category === "group",
        coachId: a.coachId,
      });
      meetsByClient.set(a.clientId, arr);
    }
  }

  // earliest supervised-JumpStart purchase per client.
  const purchaseByClient = new Map<number, string>();
  for (const p of input.purchases) {
    if (!clientMap.has(p.clientId)) continue;
    const cur = purchaseByClient.get(p.clientId);
    if (!cur || p.date < cur) purchaseByClient.set(p.clientId, p.date);
  }

  // candidate clients = any funnel signal.
  const candidates = new Set<number>();
  for (const id of discoveryByClient.keys()) candidates.add(id);
  for (const id of meetsByClient.keys()) candidates.add(id);
  for (const id of engByClient.keys()) candidates.add(id);
  for (const id of purchaseByClient.keys()) candidates.add(id);

  const out: MenteeCaRecord[] = [];
  for (const clientId of candidates) {
    const client = clientMap.get(clientId);
    if (!client) continue;
    const meets = (meetsByClient.get(clientId) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const meetInputs: MeetingStageInput[] = meets.map((m) => ({ tier: m.tier, date: m.date, isGroup: m.isGroup }));
    const stageDates = computeStageDates(basis, engByClient.get(clientId) ?? [], meetInputs);
    const discoveryDate = discoveryByClient.get(clientId) ?? null;
    const firstMeeting = meets.length ? meets[0].date : null;
    const lastMeeting = meets.length ? meets[meets.length - 1].date : null;
    const open = hasOpen.get(clientId) ?? false;
    const lastActivity = lastMeeting ?? maxDate([discoveryDate, ...PIPELINE_TIERS.map((t) => stageDates[t])]);
    const active = (dayspan(lastActivity, input.today) ?? Infinity) <= MENTEE_ACTIVE_WINDOW_DAYS || open;
    const status: CaMenteeStatus = stageDates.graduated ? "graduated" : active ? "active" : "inactive";
    const currentTier = highestTier(stageDates);

    // Owner = CA primary coach; fall back to the most recent meeting's coach.
    const ownerCoachId = client.coachId ?? null;
    let ownerCoachName: string | null = null;
    let ownerSource: "primary" | "fallback" | "none" = "none";
    if (ownerCoachId != null) {
      ownerCoachName = coachMap.get(ownerCoachId) ?? `#${ownerCoachId}`;
      ownerSource = "primary";
    } else if (meets.length) {
      const lastCoachId = meets[meets.length - 1].coachId;
      ownerCoachName = (lastCoachId != null ? coachMap.get(lastCoachId) : null) ?? (lastCoachId != null ? `#${lastCoachId}` : null);
      ownerSource = ownerCoachName ? "fallback" : "none";
    }

    const jyfPurchaseDate = purchaseByClient.get(clientId) ?? null;
    const startDate = discoveryDate ?? stageDates.jumpstart ?? jyfPurchaseDate ?? firstMeeting;

    out.push({
      clientId,
      name: client.name,
      ownerCoachId,
      ownerCoachName,
      ownerSource,
      discoveryDate,
      jumpstartDate: stageDates.jumpstart,
      tier4xDate: stageDates["4x"],
      tier2xDate: stageDates["2x"],
      tier1xDate: stageDates["1x"],
      graduationDate: stageDates.graduated,
      firstMeeting,
      lastMeeting,
      meetingCount: meets.length,
      currentTier,
      jumpstartEnd: jumpstartEnd.get(clientId) ?? null,
      jyfPurchaseDate,
      startDate,
      hasOpen: open,
      status,
    });
  }
  return out;
}

// The CA-layer columns of a `mentees` row (migration 9975). Used to upsert ONLY
// the ca_* columns (onConflict client_id) so the hand layer is never touched.
export interface MenteeCaUpsertRow {
  client_id: number;
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
  ca_current_tier: string | null;
  ca_jumpstart_end: string | null;
  ca_jyf_purchase_date: string | null;
  ca_start_date: string | null;
  ca_has_open: boolean;
  ca_status: string;
  ca_synced_at: string;
}

export function toMenteeCaUpsertRow(r: MenteeCaRecord, syncedAt: string): MenteeCaUpsertRow {
  return {
    client_id: r.clientId,
    ca_name: r.name,
    ca_owner_coach_id: r.ownerCoachId,
    ca_owner_coach_name: r.ownerCoachName,
    ca_discovery_date: r.discoveryDate,
    ca_jumpstart_date: r.jumpstartDate,
    ca_tier_4x_date: r.tier4xDate,
    ca_tier_2x_date: r.tier2xDate,
    ca_tier_1x_date: r.tier1xDate,
    ca_graduation_date: r.graduationDate,
    ca_first_meeting: r.firstMeeting,
    ca_last_meeting: r.lastMeeting,
    ca_meeting_count: r.meetingCount,
    ca_current_tier: r.currentTier,
    ca_jumpstart_end: r.jumpstartEnd,
    ca_jyf_purchase_date: r.jyfPurchaseDate,
    ca_start_date: r.startDate,
    ca_has_open: r.hasOpen,
    ca_status: r.status,
    ca_synced_at: syncedAt,
  };
}
