// Browser-side data access. The dashboard reads the CA mirror and reads/writes
// discovery outcomes directly via supabase-js; row-level security enforces that
// only signed-in staff can touch them.

import { supabase } from "./lib/supabase";
import { CONVERSION_OFFERING_IDS, PIPELINE_TIERS, engagementTier, type PipelineTier } from "../lib/config";

export { PIPELINE_TIERS, engagementTier };
export type { PipelineTier };
import {
  resolveDiscoveryOutcome,
  todayYmd,
  type DiscoveryOutcomeValue,
  type ResolvedOutcome,
  type ResolvedOutcomeSource,
} from "../lib/conversion";

export { resolveDiscoveryOutcome };
export type { DiscoveryOutcomeValue, ResolvedOutcome, ResolvedOutcomeSource };

import { computePayReport, computePayTimeline, distinctServiceMonths, payoutMonths, PAY_RAMP } from "../lib/pay";
import type { PayInvoiceInput, PayEngagementInput, PayReport, PayTimeline, PayMonth, PayLedgerRow, PayMenteeLine } from "../lib/pay";
export { computePayReport, computePayTimeline, distinctServiceMonths, payoutMonths, PAY_RAMP };
export type { PayReport, PayTimeline, PayMonth, PayLedgerRow, PayInvoiceInput, PayEngagementInput, PayMenteeLine };

// Pure "Build payout" review math (per-line include/exclude/override + totals),
// re-exported so the frontend imports lib through db.ts — same pattern as above.
import { summarizeBuild, effectiveLinePayout, isDefaultLineState, DEFAULT_LINE_STATE } from "../lib/payBuild";
import type { BuildLineState, BuildLineInput, BuildSummary, BuildStatus } from "../lib/payBuild";
export { summarizeBuild, effectiveLinePayout, isDefaultLineState, DEFAULT_LINE_STATE };
export type { BuildLineState, BuildLineInput, BuildSummary, BuildStatus };

// Pure period-comparison helpers (Metrics "Compare" mode), re-exported so the
// frontend imports lib through db.ts — same pattern as the pay engine above.
export { COMPARE_PRESETS, derivePeriodB, delta, shiftMonths } from "../lib/compare";
export type { CompareKey, ComparePreset, Delta, Range as ComparePeriod } from "../lib/compare";

// Pure mentor-capacity helpers (1-on-1 mentees per coach, excluding group slots).
export { oneOnOneMenteesByCoach, groupSlotKeys } from "../lib/capacity";
export type { CapacityAppt } from "../lib/capacity";

// Pure "Meetings to Freedom!" metric (1-on-1 sessions JumpStart-end → graduation).
export { computeMeetingsToFreedom } from "../lib/freedom";
export type { FreedomMenteeInput, FreedomRow, FreedomReport } from "../lib/freedom";

// Pure pipeline stage-date logic (engagement-start vs first-meeting basis).
import {
  computeStageDates,
  highestTier,
  type StageBasis,
  type EngagementStageInput,
  type MeetingStageInput,
} from "../lib/journey";
export type { StageBasis };

// This client's qualifying (supervised JumpStart) purchase dates, keyed by
// client id and sorted ascending. Empty when nothing counts toward conversion.
async function fetchConversionPurchasesByClient(clientIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!clientIds.length || !CONVERSION_OFFERING_IDS.length) return out;
  const chunk = 200;
  for (let i = 0; i < clientIds.length; i += chunk) {
    const slice = clientIds.slice(i, i + chunk);
    const { data, error } = await supabase
      .from("ca_offering_submissions")
      .select("client_id,date_added")
      .in("offering_id", CONVERSION_OFFERING_IDS)
      .in("client_id", slice)
      .not("date_added", "is", null);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { client_id: number | null; date_added: string | null }[]) {
      if (r.client_id == null || r.date_added == null) continue;
      const arr = out.get(r.client_id);
      if (arr) arr.push(r.date_added);
      else out.set(r.client_id, [r.date_added]);
    }
  }
  for (const arr of out.values()) arr.sort();
  return out;
}

// A discovery-call appointment pulled from the CA mirror, joined with whatever
// outcome staff have recorded against it.
export interface DiscoveryCall {
  appointmentId: number;
  clientId: number | null;
  prospect: string;
  type: "phone" | "zoom" | "other";
  date: string | null; // YYYY-MM-DD (account-local)
  month: number | null;
  outcomeId: string | null;
  outcome: DiscoveryOutcomeValue | null; // manual override, if any
  followUpOn: string | null;
  notes: string | null;
  // Resolved status: the manual override when present, otherwise the rule's
  // verdict. `autoOutcome` is always the rule's verdict (shown even when an
  // override hides it, so staff can see what the data says).
  resolvedOutcome: DiscoveryOutcomeValue;
  source: ResolvedOutcomeSource;
  resolvedReason: string;
  autoOutcome: DiscoveryOutcomeValue;
  autoReason: string;
}

export interface SyncRun {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  calls_made: number;
  records_synced: number;
  error: string | null;
}

function err<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

// --- Discovery calls (mirror appointments + recorded outcomes) ---

export async function fetchDiscoveryCalls(year: number): Promise<DiscoveryCall[]> {
  const appts = err<
    { id: number; client_id: number | null; category: string; start_date: string | null; start_month: number | null }[]
  >(
    await supabase
      .from("ca_appointments")
      .select("id,client_id,category,start_date,start_month")
      .in("category", ["discoveryPhone", "discoveryZoom"])
      .eq("start_year", year)
      .eq("status", "A")
      .order("start_date", { ascending: false })
  );

  const clientIds = [...new Set(appts.map((a) => a.client_id).filter((x): x is number => x != null))];
  const clientRows = clientIds.length
    ? err<{ id: number; name: string | null; is_excluded: boolean }[]>(
        await supabase.from("ca_clients").select("id,name,is_excluded").in("id", clientIds)
      )
    : [];
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));

  const apptIds = appts.map((a) => a.id);
  const outcomeRows = apptIds.length
    ? err<
        { id: string; appointment_id: number; outcome: DiscoveryOutcomeValue; follow_up_on: string | null; notes: string | null }[]
      >(
        await supabase
          .from("discovery_outcomes")
          .select("id,appointment_id,outcome,follow_up_on,notes")
          .in("appointment_id", apptIds)
      )
    : [];
  const outcomeMap = new Map(outcomeRows.map((o) => [o.appointment_id, o]));

  const purchasesByClient = await fetchConversionPurchasesByClient(clientIds);
  const today = todayYmd();

  const calls: DiscoveryCall[] = [];
  for (const a of appts) {
    const client = a.client_id != null ? clientMap.get(a.client_id) : undefined;
    if (client?.is_excluded) continue; // skip placeholder / group "clients"
    const o = outcomeMap.get(a.id);
    const manual = o?.outcome ?? null;
    const purchases = a.client_id != null ? purchasesByClient.get(a.client_id) ?? [] : [];
    const auto = resolveDiscoveryOutcome({ callDate: a.start_date, manual: null, conversionPurchaseDates: purchases, today });
    const resolved = manual ? resolveDiscoveryOutcome({ callDate: a.start_date, manual, conversionPurchaseDates: purchases, today }) : auto;
    calls.push({
      appointmentId: a.id,
      clientId: a.client_id,
      prospect: client?.name ?? (a.client_id != null ? `#${a.client_id}` : "Unknown"),
      type: a.category === "discoveryPhone" ? "phone" : a.category === "discoveryZoom" ? "zoom" : "other",
      date: a.start_date,
      month: a.start_month,
      outcomeId: o?.id ?? null,
      outcome: manual,
      followUpOn: o?.follow_up_on ?? null,
      notes: o?.notes ?? null,
      resolvedOutcome: resolved.outcome,
      source: resolved.source,
      resolvedReason: resolved.reason,
      autoOutcome: auto.outcome,
      autoReason: auto.reason,
    });
  }
  return calls;
}

export async function setDiscoveryOutcome(
  createdBy: string,
  call: { appointmentId: number; clientId: number; existingId: string | null },
  values: { outcome: DiscoveryOutcomeValue; followUpOn: string | null; notes: string | null }
): Promise<void> {
  if (call.existingId) {
    const { error } = await supabase
      .from("discovery_outcomes")
      .update({ outcome: values.outcome, follow_up_on: values.followUpOn, notes: values.notes })
      .eq("id", call.existingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("discovery_outcomes").insert({
      appointment_id: call.appointmentId,
      client_id: call.clientId,
      outcome: values.outcome,
      follow_up_on: values.followUpOn,
      notes: values.notes,
      created_by: createdBy,
    });
    if (error) throw new Error(error.message);
  }
}

// Remove a manual override so the call reverts to its automatic outcome.
export async function clearDiscoveryOutcome(id: string): Promise<void> {
  const { error } = await supabase.from("discovery_outcomes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- Appointments in a date range (powers the Metrics dashboard) ---

export type ApptCategory = "mentoring" | "discoveryPhone" | "discoveryZoom";

export interface RangeAppt {
  id: number;
  category: ApptCategory;
  // True for multi-mentee GROUP sessions (In Depth / Tracking Together). These
  // carry category "mentoring" so they count in meeting/mentee metrics, but the
  // capacity calc excludes them so group attendees don't inflate a mentor's
  // 1-on-1 utilization. See GROUP_SESSION_CONTAINS in lib/config.ts.
  isGroup: boolean;
  name: string;
  date: string | null; // YYYY-MM-DD (account-local)
  // Exact CA start datetime (mentoring rows only; null for discovery). Lets the
  // capacity calc spot multi-client time slots that `date` (day-only) can't.
  startRaw: string | null;
  clientId: number | null;
  clientName: string;
  coachId: number | null;
  coachName: string;
}

// Shape returned by the appointment pagers below. `start_raw` is the exact CA
// start datetime (mentoring rows only; null for discovery) — used by the capacity
// calc to detect multi-client time slots.
interface PagedAppt {
  id: number;
  category: ApptCategory;
  is_group: boolean;
  name: string;
  date: string | null;
  start_raw: string | null;
  client_id: number | null;
  coach_id: number | null;
}

// Page ca_appointments for the given categories, filtering/normalizing on the
// supplied date column. `date` in the result is the column we counted by.
// `categories` are raw DB category values. The "group" category (multi-mentee
// In-Depth / Tracking-Together sessions) is surfaced as `category: "mentoring"`
// with `is_group: true`, so every mentoring metric keeps counting it while the
// capacity calc can drop group attendees (see GROUP_SESSION_CONTAINS in config).
async function pageAppts(
  categories: string[],
  dateCol: "start_date" | "date_added",
  from: string,
  to: string
): Promise<PagedAppt[]> {
  const pageSize = 1000;
  const out: PagedAppt[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select(`id,category,name,client_id,coach_id,start_raw,${dateCol}`)
      .in("category", categories)
      .eq("status", "A")
      .gte(dateCol, from)
      .lte(dateCol, to)
      .order(dateCol, { ascending: true })
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    for (const r of batch) {
      const isGroup = r.category === "group";
      out.push({
        id: r.id as number,
        category: (isGroup ? "mentoring" : (r.category as ApptCategory)),
        is_group: isGroup,
        name: r.name as string,
        date: (r[dateCol] as string | null) ?? null,
        start_raw: (r.start_raw as string | null) ?? null,
        client_id: (r.client_id as number | null) ?? null,
        coach_id: (r.coach_id as number | null) ?? null,
      });
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

// Discovery appointments counted by SIGNUP date (date_added), falling back to
// the scheduled date when date_added isn't populated yet (e.g. before a re-sync
// backfills it), so the metric is never blank during the transition.
async function pageDiscovery(
  from: string,
  to: string
): Promise<PagedAppt[]> {
  const pageSize = 1000;
  const out: PagedAppt[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select("id,category,name,client_id,coach_id,start_date,date_added")
      .in("category", ["discoveryPhone", "discoveryZoom"])
      .eq("status", "A")
      .or(
        `and(date_added.gte.${from},date_added.lte.${to}),and(date_added.is.null,start_date.gte.${from},start_date.lte.${to})`
      )
      .order("id", { ascending: true })
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    for (const r of batch) {
      out.push({
        id: r.id as number,
        category: r.category as ApptCategory,
        is_group: false,
        name: r.name as string,
        date: ((r.date_added as string | null) ?? (r.start_date as string | null)) ?? null,
        start_raw: null,
        client_id: (r.client_id as number | null) ?? null,
        coach_id: (r.coach_id as number | null) ?? null,
      });
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

// Appointments that count within [from, to] (inclusive, YYYY-MM-DD), status
// active, placeholder/group clients excluded, enriched with prospect/mentor
// names. Mentee meetings are counted by the SCHEDULED date; discovery calls are
// counted by the SIGNUP/booking date (dateAdded). `date` carries whichever date
// the row is counted by.
export async function fetchRangeAppointments(from: string, to: string): Promise<RangeAppt[]> {
  const [mentoring, discovery, excludedSet] = await Promise.all([
    pageAppts(["mentoring", "group"], "start_date", from, to),
    pageDiscovery(from, to),
    fetchExcludedClientIds(),
  ]);
  const rows = [...mentoring, ...discovery];

  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((x): x is number => x != null))];
  const coachIds = [...new Set(rows.map((r) => r.coach_id).filter((x): x is number => x != null))];

  const clientMap = new Map<number, { name: string | null; is_excluded: boolean }>();
  if (clientIds.length) {
    const { data, error } = await supabase.from("ca_clients").select("id,name,is_excluded").in("id", clientIds);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { id: number; name: string | null; is_excluded: boolean }[]) {
      clientMap.set(c.id, { name: c.name, is_excluded: c.is_excluded });
    }
  }

  const coachMap = new Map<number, string | null>();
  if (coachIds.length) {
    const { data, error } = await supabase.from("ca_coaches").select("id,name").in("id", coachIds);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { id: number; name: string | null }[]) coachMap.set(c.id, c.name);
  }

  return rows
    .filter((r) => r.client_id == null || (!clientMap.get(r.client_id)?.is_excluded && !excludedSet.has(r.client_id)))
    .map((r) => ({
      id: r.id,
      category: r.category,
      isGroup: r.is_group,
      name: r.name,
      date: r.date,
      startRaw: r.start_raw,
      clientId: r.client_id,
      clientName:
        (r.client_id != null ? clientMap.get(r.client_id)?.name : null) ??
        (r.client_id != null ? `#${r.client_id}` : "Unknown"),
      coachId: r.coach_id,
      coachName: (r.coach_id != null ? coachMap.get(r.coach_id) : null) ?? (r.coach_id != null ? `#${r.coach_id}` : "Unknown"),
    }));
}

// Recorded outcomes for the given appointment ids, keyed by appointment id.
export async function fetchOutcomesByAppointment(apptIds: number[]): Promise<Map<number, DiscoveryOutcomeValue>> {
  const out = new Map<number, DiscoveryOutcomeValue>();
  const chunk = 200;
  for (let i = 0; i < apptIds.length; i += chunk) {
    const slice = apptIds.slice(i, i + chunk);
    if (!slice.length) break;
    const { data, error } = await supabase
      .from("discovery_outcomes")
      .select("appointment_id,outcome")
      .in("appointment_id", slice);
    if (error) throw new Error(error.message);
    for (const o of (data ?? []) as { appointment_id: number | null; outcome: DiscoveryOutcomeValue }[]) {
      if (o.appointment_id != null) out.set(o.appointment_id, o.outcome);
    }
  }
  return out;
}

// Resolve each discovery appointment to its outcome (manual override or the
// automatic rule), keyed by appointment id. Powers the Metrics conversion panel.
export async function fetchResolvedOutcomes(
  appts: { id: number; clientId: number | null; date: string | null }[]
): Promise<Map<number, ResolvedOutcome>> {
  const result = new Map<number, ResolvedOutcome>();
  if (!appts.length) return result;
  const clientIds = [...new Set(appts.map((a) => a.clientId).filter((x): x is number => x != null))];
  const [manualMap, purchasesByClient] = await Promise.all([
    fetchOutcomesByAppointment(appts.map((a) => a.id)),
    fetchConversionPurchasesByClient(clientIds),
  ]);
  const today = todayYmd();
  for (const a of appts) {
    const purchases = a.clientId != null ? purchasesByClient.get(a.clientId) ?? [] : [];
    result.set(
      a.id,
      resolveDiscoveryOutcome({ callDate: a.date, manual: manualMap.get(a.id) ?? null, conversionPurchaseDates: purchases, today })
    );
  }
  return result;
}

// Timestamp of the most recent successful sync (data freshness).
export async function fetchLastSyncedAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("sync_runs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.finished_at as string | undefined) ?? null;
}

// --- Manual metrics (board numbers with no CoachAccountable source) ---
// Staff enter one count per metric per month on the Admin tab; the Metrics
// dashboard sums them over its date range. Add a metric here (key must match
// what's stored in manual_metrics.metric) and it shows up in both places — no
// migration needed.

export interface ManualMetricDef {
  key: string;
  label: string; // full label (charts, tables, Admin field)
  short: string; // compact KPI-card label
}

export const MANUAL_METRICS: ManualMetricDef[] = [
  { key: "triggers_pdf_downloads", label: "“Identify Your Triggers” downloads", short: "Triggers PDF downloads" },
  { key: "sast_worksheets", label: "SAST worksheets completed", short: "SAST worksheets" },
];

export interface ManualMetricRow {
  id: string;
  metric: string;
  periodMonth: string; // YYYY-MM-01
  value: number;
  notes: string | null;
}

// First day of the month containing the given YYYY-MM-DD (or YYYY-MM) date.
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

// Every manual-metric entry whose month falls within [from, to] (inclusive).
// period_month is always a day-1 date, so comparing it directly against the
// range bounds buckets each entry into the right month.
export async function fetchManualMetrics(from: string, to: string): Promise<ManualMetricRow[]> {
  const { data, error } = await supabase
    .from("manual_metrics")
    .select("id,metric,period_month,value,notes")
    .gte("period_month", monthStart(from))
    .lte("period_month", to)
    .order("period_month", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; metric: string; period_month: string; value: number; notes: string | null }[]).map(
    (r) => ({ id: r.id, metric: r.metric, periodMonth: r.period_month, value: r.value, notes: r.notes })
  );
}

// Values for a single month (YYYY-MM), keyed by metric — prefills the editor.
export async function fetchManualMetricsForMonth(monthYm: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("manual_metrics")
    .select("metric,value")
    .eq("period_month", monthStart(monthYm));
  if (error) throw new Error(error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { metric: string; value: number }[]) out.set(r.metric, r.value);
  return out;
}

// Insert or update the count for one metric in one month (YYYY-MM).
export async function upsertManualMetric(
  createdBy: string,
  metric: string,
  monthYm: string,
  value: number
): Promise<void> {
  const { error } = await supabase
    .from("manual_metrics")
    .upsert(
      { metric, period_month: monthStart(monthYm), value, created_by: createdBy || null },
      { onConflict: "metric,period_month" }
    );
  if (error) throw new Error(error.message);
}

// --- Mentor capacity (coach_settings, HJG-owned) ---

export interface CoachWithSettings {
  coachId: number;
  name: string;
  isMentor: boolean;
  capacity: number | null;
  notes: string | null;
  payStartMonth: string | null; // 'YYYY-MM' override for the pay-ramp start; null = derived
}

// Every coach from ca_coaches with their HJG-owned mentor flag + capacity
// (left-join). Coaches with no coach_settings row come back as
// is_mentor=false, capacity=null, notes=null, payStartMonth=null.
export async function fetchCoachesWithSettings(): Promise<CoachWithSettings[]> {
  const [coachesRes, settingsRes] = await Promise.all([
    supabase.from("ca_coaches").select("id,name").order("name", { ascending: true }),
    supabase.from("coach_settings").select("coach_id,is_mentor,capacity,notes,pay_start_month"),
  ]);
  if (coachesRes.error) throw new Error(coachesRes.error.message);
  if (settingsRes.error) throw new Error(settingsRes.error.message);
  const settings = new Map<number, { is_mentor: boolean; capacity: number | null; notes: string | null; pay_start_month: string | null }>();
  for (const s of (settingsRes.data ?? []) as { coach_id: number; is_mentor: boolean; capacity: number | null; notes: string | null; pay_start_month: string | null }[]) {
    settings.set(s.coach_id, { is_mentor: s.is_mentor, capacity: s.capacity, notes: s.notes, pay_start_month: s.pay_start_month });
  }
  return ((coachesRes.data ?? []) as { id: number; name: string | null }[]).map((c) => {
    const s = settings.get(c.id);
    return {
      coachId: c.id,
      name: c.name ?? `#${c.id}`,
      isMentor: s?.is_mentor ?? false,
      capacity: s?.capacity ?? null,
      notes: s?.notes ?? null,
      payStartMonth: s?.pay_start_month ?? null,
    };
  });
}

// Set of coach IDs flagged as mentors. The Metrics dashboard uses this to
// filter the Mentors metric to the real mentor roster. Returns an empty set
// (meaning "no filter — count everyone") until staff start flagging coaches.
export async function fetchMentorCoachIds(): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("coach_settings")
    .select("coach_id")
    .eq("is_mentor", true);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { coach_id: number }[]).map((r) => r.coach_id));
}

export async function upsertCoachSettings(
  coachId: number,
  patch: { isMentor: boolean; capacity: number | null; notes: string | null; payStartMonth: string | null }
): Promise<void> {
  const createdBy = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { error } = await supabase
    .from("coach_settings")
    .upsert(
      {
        coach_id: coachId,
        is_mentor: patch.isMentor,
        capacity: patch.capacity,
        notes: patch.notes,
        pay_start_month: patch.payStartMonth,
        created_by: createdBy,
        updated_by: createdBy,
      },
      { onConflict: "coach_id" }
    );
  if (error) throw new Error(error.message);
}

// --- Mentee journeys (Journeys tab) ---
// One mentee's path through the HJG pipeline, assembled from the mirror:
//   Discovery Call -> JumpStart (Supervised) purchase -> mentoring meetings -> exit.
// The 4x/2x/1x cadence tiers are NOT recorded in the appointment data (mentees
// meet ~weekly throughout), so the timeline reports the OBSERVED meeting rhythm
// rather than claiming tiers. Exit status is inferred from activity (active vs
// dormant) and can be overridden by staff via mentee_outcomes.

export type MenteeStatus = "active" | "graduated" | "quit" | "fired";
// Inferred view adds "inactive": meetings stopped, but we can't know why
// (graduated vs quit vs fired) until staff classify it.
export type ResolvedMenteeStatus = MenteeStatus | "inactive";

// A mentee counts as active if they've met within this many days of today.
export const MENTEE_ACTIVE_WINDOW_DAYS = 45;

export interface MenteeMeeting {
  date: string; // YYYY-MM-DD (scheduled)
  name: string;
  engagementId: number | null;
  isGroup: boolean; // group session (In Depth / Tracking Together) vs 1-on-1
  coachName: string;
}

export interface MenteeJourney {
  clientId: number;
  name: string;
  discoveryDate: string | null; // earliest discovery call (signup date)
  jyfPurchaseDate: string | null; // earliest supervised JumpStart purchase
  firstMeeting: string | null;
  lastMeeting: string | null;
  meetingCount: number;
  meetings: MenteeMeeting[]; // ascending by date
  engagementIds: number[];
  // Pipeline stage entry dates from engagements (earliest start per tier), and
  // the highest tier reached. graduated date comes from an "After Graduation
  // Care" engagement.
  stageDates: Record<PipelineTier, string | null>;
  currentTier: PipelineTier | null;
  // Latest JumpStart-engagement end date (when JumpStart Your Freedom completed),
  // used as the "Meetings to Freedom!" window start. Null if no ended JumpStart.
  jumpstartEndDate: string | null;
  // Manual override (mentee_outcomes), if any.
  overrideId: string | null;
  override: MenteeStatus | null;
  overrideDate: string | null;
  notes: string | null;
  // Resolved status: override wins; else a real "After Graduation Care"
  // engagement => graduated; else inferred active/inactive from activity.
  resolvedStatus: ResolvedMenteeStatus;
  source: ResolvedOutcomeSource;
  // Durations in whole days (null when an endpoint is missing).
  activeSpanDays: number | null; // first -> last meeting
  daysInSystem: number | null; // earliest start -> exit / last activity / today
  // Staff-set exclusion (mentee_exclusions): test/placeholder mentee hidden from
  // metrics + the pipeline aggregates. Still listed (greyed) so it's reversible.
  excluded: boolean;
}

// Whole days from `a` to `b` (both YYYY-MM-DD), parsed at UTC midnight.
function dayspan(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// Latest non-null YYYY-MM-DD from a list (or null if all empty).
function maxDate(ds: (string | null)[]): string | null {
  let m: string | null = null;
  for (const d of ds) if (d && (!m || d > m)) m = d;
  return m;
}

// Page every active mentoring appointment across all history (the pipeline spans
// years, so this is not date-bounded). Used only by the Journeys tab.
async function fetchAllMentoring(): Promise<
  { id: number; client_id: number | null; coach_id: number | null; engagement_id: number | null; name: string; category: string; start_date: string | null }[]
> {
  const pageSize = 1000;
  const out: { id: number; client_id: number | null; coach_id: number | null; engagement_id: number | null; name: string; category: string; start_date: string | null }[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select("id,client_id,coach_id,engagement_id,name,category,start_date")
      .in("category", ["mentoring", "group"])
      .eq("status", "A")
      .order("start_date", { ascending: true })
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as typeof out;
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

// Earliest discovery-call date per client. Matched by NAME ("Discovery Call…")
// rather than category so it's correct even before a re-sync reclassifies the
// older generic bookings. Uses signup date (date_added) when present, else the
// scheduled date — the same basis the rest of the app counts discovery by.
async function fetchDiscoveryDatesByClient(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const pageSize = 1000;
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select("client_id,start_date,date_added")
      .ilike("name", "discovery call%")
      .eq("status", "A")
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { client_id: number | null; start_date: string | null; date_added: string | null }[];
    for (const r of batch) {
      if (r.client_id == null) continue;
      const d = r.date_added ?? r.start_date;
      if (!d) continue;
      const cur = out.get(r.client_id);
      if (!cur || d < cur) out.set(r.client_id, d);
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

interface EngagementRow {
  id: number | null;
  client_id: number | null;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_complete: boolean | null;
  is_canceled: boolean | null;
}

// Page every engagement across all history (for the pipeline-stage timeline).
async function fetchAllEngagements(): Promise<EngagementRow[]> {
  const pageSize = 1000;
  const out: EngagementRow[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_engagements")
      .select("id,client_id,name,start_date,end_date,is_complete,is_canceled")
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as EngagementRow[];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

// Per-client pipeline stages from engagements: the earliest start date for each
// tier (jumpstart/4x/2x/1x/graduated), the highest tier reached, and whether any
// pipeline engagement is still open (not complete, not canceled).
interface ClientStages {
  stageDates: Record<PipelineTier, string | null>;
  currentTier: PipelineTier | null;
  hasOpen: boolean;
  jumpstartEnd: string | null; // latest JumpStart engagement end (completion) date
}
// Build per-client stages for the chosen basis. Engagements give each tier's
// start date + the engagement→tier map; meetings (tagged with their engagement's
// tier) feed the "first meeting" basis. currentTier = highest tier with a date.
function buildClientStages(
  engagements: EngagementRow[],
  meetingsByClient: Map<number, MenteeMeeting[]>,
  basis: StageBasis
): Map<number, ClientStages> {
  const pipeline = new Set<string>(PIPELINE_TIERS);
  const engTierById = new Map<number, PipelineTier>();
  const engByClient = new Map<number, EngagementStageInput[]>();
  const hasOpen = new Map<number, boolean>();
  const jumpstartEnd = new Map<number, string>();
  for (const e of engagements) {
    if (e.client_id == null) continue;
    const tier = engagementTier(e.name);
    if (!pipeline.has(tier)) continue; // skip mentor_training/group/other
    const pt = tier as PipelineTier;
    if (e.id != null) engTierById.set(e.id, pt);
    const arr = engByClient.get(e.client_id) ?? [];
    arr.push({ tier: pt, startDate: e.start_date });
    engByClient.set(e.client_id, arr);
    if (!e.is_complete && !e.is_canceled) hasOpen.set(e.client_id, true);
    // Latest JumpStart-engagement end date = when JumpStart Your Freedom completed.
    if (pt === "jumpstart" && e.end_date) {
      const cur = jumpstartEnd.get(e.client_id);
      if (!cur || e.end_date > cur) jumpstartEnd.set(e.client_id, e.end_date);
    }
  }
  // Tag each meeting with its engagement's tier so "first meeting" can date stages.
  const meetByClient = new Map<number, MeetingStageInput[]>();
  for (const [clientId, meetings] of meetingsByClient) {
    meetByClient.set(
      clientId,
      meetings.map<MeetingStageInput>((m) => ({
        tier: m.engagementId != null ? engTierById.get(m.engagementId) ?? null : null,
        date: m.date || null,
        isGroup: m.isGroup,
      }))
    );
  }
  const out = new Map<number, ClientStages>();
  for (const clientId of new Set<number>([...engByClient.keys(), ...meetByClient.keys()])) {
    const stageDates = computeStageDates(basis, engByClient.get(clientId) ?? [], meetByClient.get(clientId) ?? []);
    out.set(clientId, {
      stageDates,
      currentTier: highestTier(stageDates),
      hasOpen: hasOpen.get(clientId) ?? false,
      jumpstartEnd: jumpstartEnd.get(clientId) ?? null,
    });
  }
  return out;
}

// Assemble a journey per mentee (any client with a mentoring meeting or a
// pipeline engagement), sorted by most-recent activity first. Excludes
// placeholder/group "clients". Reads the full mirror once; the tab filters it.
export async function fetchMenteeJourneys(stageBasis: StageBasis = "engagement_start"): Promise<MenteeJourney[]> {
  const [mentoring, engagements, discoveryDates, clientsRes, coachesRes, outcomesRes, excludedSet] = await Promise.all([
    fetchAllMentoring(),
    fetchAllEngagements(),
    fetchDiscoveryDatesByClient(),
    supabase.from("ca_clients").select("id,name,is_excluded"),
    supabase.from("ca_coaches").select("id,name"),
    supabase.from("mentee_outcomes").select("id,client_id,status,status_date,notes"),
    fetchExcludedClientIds(),
  ]);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (coachesRes.error) throw new Error(coachesRes.error.message);
  if (outcomesRes.error) throw new Error(outcomesRes.error.message);

  const clientMap = new Map<number, { name: string | null; is_excluded: boolean }>();
  for (const c of (clientsRes.data ?? []) as { id: number; name: string | null; is_excluded: boolean }[]) {
    clientMap.set(c.id, { name: c.name, is_excluded: c.is_excluded });
  }
  const coachMap = new Map<number, string | null>();
  for (const c of (coachesRes.data ?? []) as { id: number; name: string | null }[]) coachMap.set(c.id, c.name);

  const overrideMap = new Map<number, { id: string; status: MenteeStatus; status_date: string | null; notes: string | null }>();
  for (const o of (outcomesRes.data ?? []) as { id: string; client_id: number; status: MenteeStatus; status_date: string | null; notes: string | null }[]) {
    overrideMap.set(o.client_id, o);
  }

  const purchasesByClient = await fetchConversionPurchasesByClient([...clientMap.keys()]);

  // Group mentoring meetings by client.
  const byClient = new Map<number, MenteeMeeting[]>();
  for (const a of mentoring) {
    if (a.client_id == null) continue;
    if (clientMap.get(a.client_id)?.is_excluded) continue;
    const arr = byClient.get(a.client_id) ?? [];
    arr.push({
      date: a.start_date ?? "",
      name: a.name,
      engagementId: a.engagement_id,
      isGroup: a.category === "group",
      coachName: (a.coach_id != null ? coachMap.get(a.coach_id) : null) ?? (a.coach_id != null ? `#${a.coach_id}` : "Unknown"),
    });
    byClient.set(a.client_id, arr);
  }

  const stages = buildClientStages(engagements, byClient, stageBasis);
  const today = todayYmd();
  const emptyStages = (): Record<PipelineTier, string | null> => ({ jumpstart: null, "4x": null, "2x": null, "1x": null, graduated: null });
  const clientIds = new Set<number>([...byClient.keys(), ...stages.keys()]);
  const journeys: MenteeJourney[] = [];
  for (const clientId of clientIds) {
    if (clientMap.get(clientId)?.is_excluded) continue;
    const meetings = (byClient.get(clientId) ?? []).filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
    const st = stages.get(clientId);
    if (!meetings.length && !st) continue; // nothing to show
    const stageDates = st?.stageDates ?? emptyStages();
    const currentTier = st?.currentTier ?? null;
    const hasOpen = st?.hasOpen ?? false;

    const firstMeeting = meetings.length ? meetings[0].date : null;
    const lastMeeting = meetings.length ? meetings[meetings.length - 1].date : null;
    const discoveryDate = discoveryDates.get(clientId) ?? null;
    const jyfPurchaseDate = purchasesByClient.get(clientId)?.[0] ?? null;
    const engagementIds = [...new Set(meetings.map((m) => m.engagementId).filter((x): x is number => x != null && x !== 0))];

    const o = overrideMap.get(clientId);
    const override = o?.status ?? null;
    const overrideDate = o?.status_date ?? null;

    // Activity: latest meeting, else the latest known stage date.
    const lastActivity = lastMeeting ?? maxDate(Object.values(stageDates));
    const active = (dayspan(lastActivity, today) ?? Infinity) <= MENTEE_ACTIVE_WINDOW_DAYS || hasOpen;

    // Resolved status: override wins; else a real "After Graduation Care"
    // engagement => graduated; else inferred from activity.
    const resolvedStatus: ResolvedMenteeStatus =
      override ?? (stageDates.graduated ? "graduated" : active ? "active" : "inactive");
    const source: ResolvedOutcomeSource = override ? "manual" : "auto";

    const startDate = discoveryDate ?? stageDates.jumpstart ?? jyfPurchaseDate ?? firstMeeting;
    const exitDate =
      override && override !== "active" && overrideDate
        ? overrideDate
        : !override && stageDates.graduated
        ? stageDates.graduated
        : resolvedStatus === "active"
        ? today
        : lastActivity;

    journeys.push({
      clientId,
      name: clientMap.get(clientId)?.name ?? `#${clientId}`,
      discoveryDate,
      jyfPurchaseDate,
      firstMeeting,
      lastMeeting,
      meetingCount: meetings.length,
      meetings,
      engagementIds,
      stageDates,
      currentTier,
      jumpstartEndDate: st?.jumpstartEnd ?? null,
      overrideId: o?.id ?? null,
      override,
      overrideDate,
      notes: o?.notes ?? null,
      resolvedStatus,
      source,
      activeSpanDays: dayspan(firstMeeting, lastMeeting),
      daysInSystem: dayspan(startDate, exitDate),
      excluded: excludedSet.has(clientId),
    });
  }

  journeys.sort((a, b) => (b.lastMeeting ?? b.discoveryDate ?? "").localeCompare(a.lastMeeting ?? a.discoveryDate ?? ""));
  return journeys;
}

// Set (or update) a mentee's pipeline outcome override. One row per client.
export async function setMenteeOutcome(
  createdBy: string,
  clientId: number,
  values: { status: MenteeStatus; statusDate: string | null; notes: string | null }
): Promise<void> {
  const { error } = await supabase.from("mentee_outcomes").upsert(
    {
      client_id: clientId,
      status: values.status,
      status_date: values.statusDate,
      notes: values.notes,
      created_by: createdBy || null,
    },
    { onConflict: "client_id" }
  );
  if (error) throw new Error(error.message);
}

// Remove a mentee's override so status reverts to the inferred active/inactive.
export async function clearMenteeOutcome(clientId: number): Promise<void> {
  const { error } = await supabase.from("mentee_outcomes").delete().eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

// --- Mentee exclusions (test/placeholder mentees hidden dashboard-wide) ---
// Reversible, staff-owned sibling of ca_clients.is_excluded. The returned set is
// honored by fetchRangeAppointments (Metrics) and flagged on fetchMenteeJourneys
// (Journeys keeps showing the mentee greyed so it can be re-included).

export async function fetchExcludedClientIds(): Promise<Set<number>> {
  const { data, error } = await supabase.from("mentee_exclusions").select("client_id");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => (r as { client_id: number }).client_id));
}

// Exclude a mentee (idempotent — one row per client_id).
export async function addMenteeExclusion(createdBy: string, clientId: number, reason: string | null): Promise<void> {
  const { error } = await supabase
    .from("mentee_exclusions")
    .upsert({ client_id: clientId, reason, created_by: createdBy || null }, { onConflict: "client_id" });
  if (error) throw new Error(error.message);
}

// Re-include a previously excluded mentee.
export async function removeMenteeExclusion(clientId: number): Promise<void> {
  const { error } = await supabase.from("mentee_exclusions").delete().eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

// Board-level roll-up of how long each pipeline leg takes, across all mentees.
// Each leg is averaged only over mentees where BOTH endpoints exist (so a small
// n is honest, not zero-padded), and negative spans (data anomalies) are dropped.
// Pure over the journeys it's given — no I/O — so it's easy to reason about.
export interface LegStat {
  key: string;
  label: string;
  n: number; // mentees with this leg measurable
  avgDays: number | null;
  medianDays: number | null;
}

export function aggregateJourneyDurations(allJourneys: MenteeJourney[]): LegStat[] {
  const journeys = allJourneys.filter((j) => !j.excluded); // excluded mentees don't skew the board aggregate
  const legs: { key: string; label: string; pick: (j: MenteeJourney) => number | null }[] = [
    { key: "dc_js", label: "Discovery → JumpStart", pick: (j) => dayspan(j.discoveryDate, j.stageDates.jumpstart) },
    { key: "js_4x", label: "JumpStart → 4x", pick: (j) => dayspan(j.stageDates.jumpstart, j.stageDates["4x"]) },
    { key: "4x_2x", label: "4x → 2x", pick: (j) => dayspan(j.stageDates["4x"], j.stageDates["2x"]) },
    { key: "2x_1x", label: "2x → 1x", pick: (j) => dayspan(j.stageDates["2x"], j.stageDates["1x"]) },
    { key: "1x_grad", label: "1x → graduation", pick: (j) => dayspan(j.stageDates["1x"], j.stageDates.graduated) },
    { key: "dc_grad", label: "Discovery → graduation", pick: (j) => dayspan(j.discoveryDate, j.stageDates.graduated) },
  ];
  return legs.map((leg) => {
    const vals = journeys
      .map(leg.pick)
      .filter((v): v is number => v != null && v >= 0)
      .sort((a, b) => a - b);
    const n = vals.length;
    const avgDays = n ? Math.round(vals.reduce((s, v) => s + v, 0) / n) : null;
    const medianDays = n ? (n % 2 ? vals[(n - 1) / 2] : Math.round((vals[n / 2 - 1] + vals[n / 2]) / 2)) : null;
    return { key: leg.key, label: leg.label, n, avgDays, medianDays };
  });
}

// --- Staff payment (Pay staff tab) ---
// Pulls the raw inputs the pure payroll engine (lib/pay) needs: billed + collected
// invoice revenue by service month, the mentee↔mentor↔tier engagements, and the
// coach/client name lookups. The view computes a per-month report from these.

export interface PayData {
  invoices: PayInvoiceInput[];
  engagements: PayEngagementInput[];
  coachName: (id: number) => string;
  clientName: (id: number) => string;
  months: string[]; // payout months (each service month + its rollover tail), newest first
  // coachId -> 'YYYY-MM' staff override for the pay-ramp start (coach_settings).
  // The engine falls back to the mentor's earliest engagement when absent.
  startMonthOverride: Map<number, string>;
}

async function fetchAllPayEngagements(): Promise<PayEngagementInput[]> {
  const pageSize = 1000;
  const out: PayEngagementInput[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_engagements")
      .select("client_id,coach_id,start_date,end_date,is_canceled,name")
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as {
      client_id: number | null;
      coach_id: number | null;
      start_date: string | null;
      end_date: string | null;
      is_canceled: boolean | null;
      name: string | null;
    }[];
    for (const e of batch) {
      if (e.client_id == null) continue;
      out.push({
        clientId: e.client_id,
        coachId: e.coach_id,
        startDate: e.start_date,
        endDate: e.end_date,
        isCanceled: e.is_canceled ?? false,
        name: e.name,
      });
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

async function fetchAllPayInvoices(): Promise<PayInvoiceInput[]> {
  const pageSize = 1000;
  const out: PayInvoiceInput[] = [];
  for (let f = 0; ; f += pageSize) {
    // date_of is the full service date — its DAY drives Clayton's proration split.
    const { data, error } = await supabase
      .from("ca_invoices")
      .select("client_id,date_of,date_of_year,date_of_month,amount,amount_paid")
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as {
      client_id: number | null;
      date_of: string | null;
      date_of_year: number | null;
      date_of_month: number | null;
      amount: number | null;
      amount_paid: number | null;
    }[];
    for (const inv of batch) {
      if (inv.client_id == null) continue;
      // Prefer the full date_of (day precision); fall back to the 1st when only the
      // denormalized year/month is present.
      const serviceDate =
        inv.date_of ??
        (inv.date_of_year != null && inv.date_of_month != null
          ? `${inv.date_of_year}-${String(inv.date_of_month).padStart(2, "0")}-01`
          : null);
      if (!serviceDate) continue;
      out.push({
        clientId: inv.client_id,
        serviceDate,
        billed: Number(inv.amount) || 0,
        collected: Number(inv.amount_paid) || 0,
      });
    }
    if (batch.length < pageSize) break;
  }
  return out;
}

export async function fetchPayData(): Promise<PayData> {
  const [invoices, engagements, coachesRes, clientsRes, settingsRes] = await Promise.all([
    fetchAllPayInvoices(),
    fetchAllPayEngagements(),
    supabase.from("ca_coaches").select("id,name"),
    supabase.from("ca_clients").select("id,name"),
    supabase.from("coach_settings").select("coach_id,pay_start_month"),
  ]);
  if (coachesRes.error) throw new Error(coachesRes.error.message);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (settingsRes.error) throw new Error(settingsRes.error.message);

  const coaches = new Map<number, string>();
  for (const c of (coachesRes.data ?? []) as { id: number; name: string | null }[]) coaches.set(c.id, c.name ?? `#${c.id}`);
  const clients = new Map<number, string>();
  for (const c of (clientsRes.data ?? []) as { id: number; name: string | null }[]) clients.set(c.id, c.name ?? `#${c.id}`);

  // Staff overrides for the mentor pay-ramp start. Only well-formed 'YYYY-MM'
  // values are honored; anything else falls back to the derived start.
  const startMonthOverride = new Map<number, string>();
  for (const s of (settingsRes.data ?? []) as { coach_id: number; pay_start_month: string | null }[]) {
    if (s.pay_start_month && /^\d{4}-\d{2}$/.test(s.pay_start_month)) startMonthOverride.set(s.coach_id, s.pay_start_month);
  }

  // Payout months = each service month + the following month (the rollover tail).
  const months = payoutMonths(invoices);

  return {
    invoices,
    engagements,
    coachName: (id) => coaches.get(id) ?? `#${id}`,
    clientName: (id) => clients.get(id) ?? `#${id}`,
    months,
    startMonthOverride,
  };
}

// --- Build payout (review records) ---
// A saved human review of one coach's payout for one service month: which lines
// were included, any per-line overrides + notes, the signed-off total, and a
// draft/approved status. One row per (coachId, serviceMonth). The engine numbers
// are recomputed live from fetchPayData; this only persists the human decisions.

export interface PayoutBuildRecord {
  coachId: number;
  serviceMonth: string; // 'YYYY-MM'
  status: BuildStatus;
  builtTotal: number; // signed-off total at save time
  computedTotal: number; // engine total at save time (drift reference)
  lineStates: Record<number, BuildLineState>; // clientId -> review decision (non-default only)
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null; // updated_at
}

function buildKey(coachId: number, serviceMonth: string): string {
  return `${coachId}|${serviceMonth}`;
}
export { buildKey as payoutBuildKey };

// All saved builds, indexed by `${coachId}|${serviceMonth}`. The table is small
// (one row per reviewed coach-month), so a single fetch backs the whole view.
export async function fetchPayoutBuilds(): Promise<Map<string, PayoutBuildRecord>> {
  const { data, error } = await supabase
    .from("payout_builds")
    .select("coach_id,service_month,status,built_total,computed_total,line_states,notes,reviewed_by,updated_at");
  if (error) throw new Error(error.message);
  const out = new Map<string, PayoutBuildRecord>();
  for (const r of (data ?? []) as {
    coach_id: number;
    service_month: string;
    status: BuildStatus;
    built_total: number | null;
    computed_total: number | null;
    line_states: Record<string, BuildLineState> | null;
    notes: string | null;
    reviewed_by: string | null;
    updated_at: string | null;
  }[]) {
    const lineStates: Record<number, BuildLineState> = {};
    for (const [k, v] of Object.entries(r.line_states ?? {})) lineStates[Number(k)] = v;
    out.set(buildKey(r.coach_id, r.service_month), {
      coachId: r.coach_id,
      serviceMonth: r.service_month,
      status: r.status,
      builtTotal: Number(r.built_total) || 0,
      computedTotal: Number(r.computed_total) || 0,
      lineStates,
      notes: r.notes,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.updated_at,
    });
  }
  return out;
}

// Upsert one coach-month's review (draft or approved). line_states keeps only
// non-default decisions so the JSON stays compact and a clean review is empty.
export async function savePayoutBuild(
  reviewedBy: string,
  rec: {
    coachId: number;
    serviceMonth: string;
    status: BuildStatus;
    builtTotal: number;
    computedTotal: number;
    lineStates: Record<number, BuildLineState>;
    notes: string | null;
  }
): Promise<void> {
  const compact: Record<string, BuildLineState> = {};
  for (const [k, v] of Object.entries(rec.lineStates)) {
    if (!isDefaultLineState(v)) compact[k] = v;
  }
  const { error } = await supabase.from("payout_builds").upsert(
    {
      coach_id: rec.coachId,
      service_month: rec.serviceMonth,
      status: rec.status,
      built_total: rec.builtTotal,
      computed_total: rec.computedTotal,
      line_states: compact,
      notes: rec.notes,
      reviewed_by: reviewedBy || null,
    },
    { onConflict: "coach_id,service_month" }
  );
  if (error) throw new Error(error.message);
}

// Discard a saved review (RLS lets a reviewer delete only their own records).
export async function deletePayoutBuild(coachId: number, serviceMonth: string): Promise<void> {
  const { error } = await supabase
    .from("payout_builds")
    .delete()
    .eq("coach_id", coachId)
    .eq("service_month", serviceMonth);
  if (error) throw new Error(error.message);
}

// --- Raw data viewer ---

export const RAW_TABLES = [
  "ca_appointments",
  "ca_clients",
  "ca_coaches",
  "ca_engagements",
  "ca_invoices",
  "ca_offerings",
  "ca_offering_submissions",
  "coach_settings",
  "discovery_outcomes",
  "manual_metrics",
  "mentee_exclusions",
  "mentee_outcomes",
  "payout_builds",
  "sync_runs",
] as const;

export type RawTable = (typeof RAW_TABLES)[number];

export async function fetchTable(
  table: RawTable,
  limit = 100
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const { data, error, count } = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return { rows, total: count ?? rows.length };
}

// Page through an entire raw table for CSV export. Supabase caps each request
// at ~1000 rows, so we walk by `range` until the page comes back short.
export async function fetchAllRows(table: RawTable): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

// --- Sync runs + settings (Admin) ---

export async function listSyncRuns(limit = 10): Promise<SyncRun[]> {
  return err<SyncRun[]>(
    await supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(limit)
  );
}

export async function fetchSettings(): Promise<Record<string, number | null>> {
  const rows = err<{ key: string; value: number | null }[]>(await supabase.from("app_settings").select("key,value"));
  const out: Record<string, number | null> = {};
  for (const r of rows) out[r.key] = (r.value as number | null) ?? null;
  return out;
}

export async function updateSetting(key: string, value: number | null): Promise<void> {
  const { error } = await supabase.from("app_settings").update({ value }).eq("key", key);
  if (error) throw new Error(error.message);
}

// --- Company options (org-wide dashboard settings; string-valued app_settings) ---

// All string-valued settings (the Company options live alongside the numeric
// budget/sync settings in app_settings; we surface only the string ones here).
export async function fetchCompanyOptions(): Promise<Record<string, string>> {
  const rows = err<{ key: string; value: unknown }[]>(await supabase.from("app_settings").select("key,value"));
  const out: Record<string, string> = {};
  for (const r of rows) if (typeof r.value === "string") out[r.key] = r.value;
  return out;
}

export async function setCompanyOption(key: string, value: string): Promise<void> {
  const { error } = await supabase.from("app_settings").update({ value }).eq("key", key);
  if (error) throw new Error(error.message);
}
