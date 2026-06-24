// Browser-side data access. The dashboard reads the CA mirror and reads/writes
// discovery outcomes directly via supabase-js; row-level security enforces that
// only signed-in staff can touch them.

import { supabase } from "./lib/supabase";
import { CONVERSION_OFFERING_IDS, PIPELINE_TIERS, engagementTier, type PipelineTier } from "../lib/config";
import { computeJyfVsMentoring, type CohortEngagementInput, type JyfVsMentoring } from "../lib/cohort";

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

// Pure Margins helpers (program staff-hours vs delivered meeting-hours).
import { PROGRAMS, PROGRAM_MEETING_HOURS, mergeProgramMonths, meetingHours } from "../lib/margins";
import type { ProgramSession } from "../lib/margins";
export { PROGRAMS, PROGRAM_MEETING_HOURS, mergeProgramMonths, meetingHours };
export type { ProgramDef, ProgramMonthRow, ProgramSession } from "../lib/margins";

// Pure "Meetings to Freedom!" metric (1-on-1 sessions JumpStart-end → graduation).
export { computeMeetingsToFreedom } from "../lib/freedom";
export type { FreedomMenteeInput, FreedomRow, FreedomReport } from "../lib/freedom";

// Pure "JYF vs Active Mentoring" cohort snapshot (open engagements by phase).
// computeJyfVsMentoring / the input + result types are imported at the top (used
// by fetchJyfVsMentoring below) and re-exported here for the view.
export { computeJyfVsMentoring };
export type { CohortEngagementInput, JyfVsMentoring };
export type { MentoringTier } from "../lib/cohort";

// Pure Journeys per-stage color logic (gradient interpolation + config resolution).
export {
  STAGE_KEYS,
  STAGE_LABELS,
  STAGE_COUNT,
  DEFAULT_STAGE_COLORS,
  DEFAULT_STAGE_COLOR_CONFIG,
  DEFAULT_GRADIENT_FROM,
  DEFAULT_GRADIENT_TO,
  gradientColors,
  resolveStageColors,
  parseStageColorConfig,
  stageColorsFromRaw,
  serializeStageColorConfig,
} from "../lib/stageColors";
export type { StageKey, StageColorMode, StageColorConfig } from "../lib/stageColors";

// Pure conversion-rate trend-window logic (Metrics conversion card + its Company option).
export {
  DEFAULT_TREND_WINDOW,
  parseTrendWindow,
  serializeTrendWindow,
  trendWindowLabel,
  rollingConversionTrend,
} from "../lib/conversionTrend";
export type { TrendWindow, TrendUnit, TrendCall, TrendPoint } from "../lib/conversionTrend";

// Pure pipeline stage-date logic (engagement-start vs first-meeting basis).
import {
  computeStageDates,
  highestTier,
  type StageBasis,
  type EngagementStageInput,
  type MeetingStageInput,
} from "../lib/journey";
export type { StageBasis };

// Pure cohort-comparison logic for the Pipeline-timing "Compare start-date
// cohorts" tool (windowing + per-cohort roll-up).
export { monthsAgoYmd, inStartWindow, summarizeCohort, startWindowLabel, COHORT_TIERS } from "../lib/cohortCompare";
export type { CohortJourneyInput, CohortStats, CohortTier, StartWindow } from "../lib/cohortCompare";

// Pure CA-layer derivation + effective view-model for the rebuilt Mentee management
// system (migration 9975).
import { deriveMenteeCaRecords, toMenteeCaUpsertRow } from "../lib/menteeJourney";
import { toEffectiveMentee } from "../lib/menteeView";
import { computeMeetingsToFreedom } from "../lib/freedom";
export { toEffectiveMentee, aggregateLegDurations, MENTEE_STATUSES, MENTEE_EXIT_STATUSES, FUNNEL_STAGES } from "../lib/menteeView";
export type { EffectiveMentee, FunnelStage } from "../lib/menteeView";
export { computeFunnel } from "../lib/menteeFunnel";
export type { FunnelReport, FunnelStageStat } from "../lib/menteeFunnel";

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
    fetchTestClientIds(),
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

// "graduated" is the normal ending; "quit" / "fired" / "no_mentoring" are the
// ALTERNATIVE exits — a mentee can leave the pipeline at ANY stage (the Journeys
// rail then shows an exit node in place of Graduation). "no_mentoring" = left the
// pipeline without ongoing mentoring.
export type MenteeStatus = "active" | "graduated" | "quit" | "fired" | "no_mentoring";
// The exit statuses that end the journey somewhere other than graduation.
export const EXIT_STATUSES: readonly MenteeStatus[] = ["quit", "fired", "no_mentoring"];
// Inferred view adds "inactive": meetings stopped, but we can't know why
// (graduated vs quit vs fired vs no-mentoring) until staff classify it.
export type ResolvedMenteeStatus = MenteeStatus | "inactive";

// A mentee counts as active if they've met within this many days of today.
export const MENTEE_ACTIVE_WINDOW_DAYS = 45;

export interface MenteeMeeting {
  date: string; // YYYY-MM-DD (scheduled)
  name: string;
  engagementId: number | null;
  // Pipeline tier of this meeting's engagement (jumpstart/4x/2x/1x/graduated), or
  // null when the engagement isn't a pipeline tier (group/mentor_training/other) or
  // there's no engagement. Lets the Journeys rhythm chart color meetings by tier.
  tier: PipelineTier | null;
  isGroup: boolean; // group session (In Depth / Tracking Together) vs 1-on-1
  coachName: string;
}

// Six pipeline milestone dates (discovery + the five engagement tiers). Used to
// carry both the synced (CoachAccountable) dates and the manual overrides so the
// editor can prefill the override and show the synced value beside it.
export interface StageDates6 {
  discovery: string | null;
  jumpstart: string | null;
  "4x": string | null;
  "2x": string | null;
  "1x": string | null;
  graduated: string | null;
}

export interface MenteeJourney {
  clientId: number;
  name: string;
  discoveryDate: string | null; // earliest discovery call (EFFECTIVE: override ?? synced)
  jyfPurchaseDate: string | null; // earliest supervised JumpStart purchase
  firstMeeting: string | null;
  lastMeeting: string | null;
  meetingCount: number;
  meetings: MenteeMeeting[]; // ascending by date
  engagementIds: number[];
  // Pipeline stage entry dates from engagements (earliest start per tier), and
  // the highest tier reached. graduated date comes from an "After Graduation
  // Care" engagement. EFFECTIVE values: a manual stage-date override wins over
  // the synced date (see stageSynced / stageOverrides below).
  stageDates: Record<PipelineTier, string | null>;
  // The raw synced CA dates (before override) and the manual override values
  // (mentee_outcomes), so the editor can prefill overrides + show the synced date.
  stageSynced: StageDates6;
  stageOverrides: StageDates6;
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
  // System start = first of: discovery call -> JumpStart -> JYF purchase -> first
  // meeting. The basis for `daysInSystem` and the Pipeline-timing start-date
  // cohort split (Compare start-date cohorts). Null when none of those exist.
  startDate: string | null;
  // Durations in whole days (null when an endpoint is missing).
  activeSpanDays: number | null; // first -> last meeting
  daysInSystem: number | null; // earliest start -> exit / last activity / today
  // Staff-set exclusion (mentee_exclusions): test/placeholder mentee hidden from
  // metrics + the pipeline aggregates. Still listed (greyed) so it's reversible.
  excluded: boolean;
  // OWNER = the mentee's coach, decided by CoachAccountable's PRIMARY-coach pairing
  // (ca_clients.coach_id). When the primary coach isn't synced yet it falls back to
  // the coach of the most recent meeting. ownerSource says which one is shown.
  ownerCoachId: number | null;
  ownerCoachName: string | null;
  ownerSource: "primary" | "fallback" | "none";
  // True when this journey's mentee is in the HJG "Mentees source of truth" roster
  // (the Notion-mirrored `mentees` table) — i.e. a real JYF / 4x / 2x / 1x pipeline
  // mentee, not one of CA's OTHER pipelines (independent IMN, after-graduation care,
  // mentor training, …). Matched by client_id or normalized name. Non-roster mentees
  // are dropped from the pipeline metrics. Always true when the roster is unavailable
  // (mentees table missing/empty) so we never hide everyone.
  inSourceOfTruth: boolean;
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

// The mentee's OWNER per client = CoachAccountable's primary-coach pairing,
// mirrored onto ca_clients.coach_id (migration 9984). Defensive: if the column
// isn't applied yet, PostgREST errors on the select — we swallow it and return an
// empty map so every consumer falls back to its prior engagement/appointment coach
// (the dashboard never breaks waiting on the migration + re-sync).
export async function fetchPrimaryCoachByClient(): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const { data, error } = await supabase.from("ca_clients").select("id,coach_id");
  if (error) return out; // column missing (pre-migration) -> graceful empty
  for (const r of (data ?? []) as { id: number; coach_id: number | null }[]) {
    if (r.coach_id != null) out.set(r.id, r.coach_id);
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
// Map each engagement id to its pipeline tier (jumpstart/4x/2x/1x/graduated),
// skipping non-pipeline engagements (mentor_training/group/other). Shared by the
// stage builder and by per-meeting tier-tagging so a meeting can be colored by tier.
function engagementTierMap(engagements: EngagementRow[]): Map<number, PipelineTier> {
  const pipeline = new Set<string>(PIPELINE_TIERS);
  const m = new Map<number, PipelineTier>();
  for (const e of engagements) {
    if (e.id == null || e.client_id == null) continue; // mirror buildClientStages' guards exactly
    const tier = engagementTier(e.name);
    if (!pipeline.has(tier)) continue;
    m.set(e.id, tier as PipelineTier);
  }
  return m;
}

// Build per-client stages for the chosen basis. Engagements give each tier's
// start date; meetings (tagged with their engagement's tier via `engTierById`)
// feed the "first meeting" basis. currentTier = highest tier with a date.
function buildClientStages(
  engagements: EngagementRow[],
  meetingsByClient: Map<number, MenteeMeeting[]>,
  basis: StageBasis,
  engTierById: Map<number, PipelineTier>
): Map<number, ClientStages> {
  const pipeline = new Set<string>(PIPELINE_TIERS);
  const engByClient = new Map<number, EngagementStageInput[]>();
  const hasOpen = new Map<number, boolean>();
  const jumpstartEnd = new Map<number, string>();
  for (const e of engagements) {
    if (e.client_id == null) continue;
    const tier = engagementTier(e.name);
    if (!pipeline.has(tier)) continue; // skip mentor_training/group/other
    const pt = tier as PipelineTier;
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

type OutcomeRow = {
  id: string;
  client_id: number;
  status: MenteeStatus | null;
  status_date: string | null;
  notes: string | null;
  discovery_date: string | null;
  jumpstart_date: string | null;
  tier_4x_date: string | null;
  tier_2x_date: string | null;
  tier_1x_date: string | null;
  graduation_date: string | null;
};

// mentee_outcomes rows including the stage-date override columns (migration 9985).
// Falls back to the base columns if those columns don't exist yet, so the Journeys
// tab keeps working before 9985 is applied (the stage-date overrides just read as
// absent until then).
async function fetchMenteeOutcomeRows(): Promise<OutcomeRow[]> {
  const FULL = "id,client_id,status,status_date,notes,discovery_date,jumpstart_date,tier_4x_date,tier_2x_date,tier_1x_date,graduation_date";
  const full = await supabase.from("mentee_outcomes").select(FULL);
  if (!full.error) return (full.data ?? []) as OutcomeRow[];
  const base = await supabase.from("mentee_outcomes").select("id,client_id,status,status_date,notes");
  if (base.error) throw new Error(base.error.message);
  return (base.data ?? []) as OutcomeRow[];
}

// Assemble a journey per mentee (any client with a mentoring meeting or a
// pipeline engagement), sorted by most-recent activity first. Excludes
// placeholder/group "clients". Reads the full mirror once; the tab filters it.
export async function fetchMenteeJourneys(stageBasis: StageBasis = "engagement_start"): Promise<MenteeJourney[]> {
  const [mentoring, engagements, discoveryDates, clientsRes, coachesRes, outcomeRows, excludedSet, primaryCoach, roster] = await Promise.all([
    fetchAllMentoring(),
    fetchAllEngagements(),
    fetchDiscoveryDatesByClient(),
    supabase.from("ca_clients").select("id,name,is_excluded"),
    supabase.from("ca_coaches").select("id,name"),
    fetchMenteeOutcomeRows(),
    fetchExcludedClientIds(),
    fetchPrimaryCoachByClient(),
    fetchMenteeRosterKeys(),
  ]);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (coachesRes.error) throw new Error(coachesRes.error.message);

  const clientMap = new Map<number, { name: string | null; is_excluded: boolean }>();
  for (const c of (clientsRes.data ?? []) as { id: number; name: string | null; is_excluded: boolean }[]) {
    clientMap.set(c.id, { name: c.name, is_excluded: c.is_excluded });
  }
  const coachMap = new Map<number, string | null>();
  for (const c of (coachesRes.data ?? []) as { id: number; name: string | null }[]) coachMap.set(c.id, c.name);

  const overrideMap = new Map<number, OutcomeRow>();
  for (const o of outcomeRows) {
    overrideMap.set(o.client_id, o);
  }

  const purchasesByClient = await fetchConversionPurchasesByClient([...clientMap.keys()]);

  // Engagement → pipeline tier, used both to tag each meeting (for the rhythm
  // chart's per-tier coloring) and to build the pipeline stages below.
  const engTierById = engagementTierMap(engagements);

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
      tier: a.engagement_id != null ? engTierById.get(a.engagement_id) ?? null : null,
      isGroup: a.category === "group",
      coachName: (a.coach_id != null ? coachMap.get(a.coach_id) : null) ?? (a.coach_id != null ? `#${a.coach_id}` : "Unknown"),
    });
    byClient.set(a.client_id, arr);
  }

  const stages = buildClientStages(engagements, byClient, stageBasis, engTierById);
  const today = todayYmd();
  const emptyStages = (): Record<PipelineTier, string | null> => ({ jumpstart: null, "4x": null, "2x": null, "1x": null, graduated: null });
  const clientIds = new Set<number>([...byClient.keys(), ...stages.keys()]);
  const journeys: MenteeJourney[] = [];
  for (const clientId of clientIds) {
    if (clientMap.get(clientId)?.is_excluded) continue;
    const meetings = (byClient.get(clientId) ?? []).filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
    const st = stages.get(clientId);
    if (!meetings.length && !st) continue; // nothing to show
    const o = overrideMap.get(clientId);
    const hasOpen = st?.hasOpen ?? false;

    // Synced (CoachAccountable) stage dates, then the EFFECTIVE dates with any
    // manual mentee_outcomes stage-date override applied (override ?? synced).
    const syncedStages = st?.stageDates ?? emptyStages();
    const stageSynced: StageDates6 = {
      discovery: discoveryDates.get(clientId) ?? null,
      jumpstart: syncedStages.jumpstart,
      "4x": syncedStages["4x"],
      "2x": syncedStages["2x"],
      "1x": syncedStages["1x"],
      graduated: syncedStages.graduated,
    };
    const stageOverrides: StageDates6 = {
      discovery: o?.discovery_date ?? null,
      jumpstart: o?.jumpstart_date ?? null,
      "4x": o?.tier_4x_date ?? null,
      "2x": o?.tier_2x_date ?? null,
      "1x": o?.tier_1x_date ?? null,
      graduated: o?.graduation_date ?? null,
    };
    const discoveryDate = stageOverrides.discovery ?? stageSynced.discovery;
    const stageDates: Record<PipelineTier, string | null> = {
      jumpstart: stageOverrides.jumpstart ?? stageSynced.jumpstart,
      "4x": stageOverrides["4x"] ?? stageSynced["4x"],
      "2x": stageOverrides["2x"] ?? stageSynced["2x"],
      "1x": stageOverrides["1x"] ?? stageSynced["1x"],
      graduated: stageOverrides.graduated ?? stageSynced.graduated,
    };
    // Highest tier reached, recomputed from the EFFECTIVE dates (graduated > 1x >
    // 2x > 4x > jumpstart) so a manual date override moves the current tier too.
    const currentTier: PipelineTier | null = stageDates.graduated
      ? "graduated"
      : stageDates["1x"]
      ? "1x"
      : stageDates["2x"]
      ? "2x"
      : stageDates["4x"]
      ? "4x"
      : stageDates.jumpstart
      ? "jumpstart"
      : null;

    const firstMeeting = meetings.length ? meetings[0].date : null;
    const lastMeeting = meetings.length ? meetings[meetings.length - 1].date : null;
    const jyfPurchaseDate = purchasesByClient.get(clientId)?.[0] ?? null;
    const engagementIds = [...new Set(meetings.map((m) => m.engagementId).filter((x): x is number => x != null && x !== 0))];

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

    // In the Mentees source-of-truth roster? Match by client_id or normalized name.
    // Fail-open when the roster is unavailable so we never hide every mentee.
    const menteeName = clientMap.get(clientId)?.name ?? null;
    const inSourceOfTruth =
      !roster.available || roster.clientIds.has(clientId) || roster.names.has(normalizeName(menteeName));

    // Owner = CoachAccountable primary coach (ca_clients.coach_id). Falls back to
    // the coach of the most recent meeting until the primary coach is synced.
    const ownerCoachId = primaryCoach.get(clientId) ?? null;
    let ownerCoachName: string | null = null;
    let ownerSource: "primary" | "fallback" | "none" = "none";
    if (ownerCoachId != null) {
      ownerCoachName = coachMap.get(ownerCoachId) ?? `#${ownerCoachId}`;
      ownerSource = "primary";
    } else if (meetings.length) {
      ownerCoachName = meetings[meetings.length - 1].coachName;
      ownerSource = "fallback";
    }

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
      stageSynced,
      stageOverrides,
      currentTier,
      jumpstartEndDate: st?.jumpstartEnd ?? null,
      overrideId: o?.id ?? null,
      override,
      overrideDate,
      notes: o?.notes ?? null,
      resolvedStatus,
      source,
      startDate,
      activeSpanDays: dayspan(firstMeeting, lastMeeting),
      daysInSystem: dayspan(startDate, exitDate),
      excluded: excludedSet.has(clientId),
      ownerCoachId,
      ownerCoachName,
      ownerSource,
      inSourceOfTruth,
    });
  }

  journeys.sort((a, b) => (b.lastMeeting ?? b.discoveryDate ?? "").localeCompare(a.lastMeeting ?? a.discoveryDate ?? ""));
  return journeys;
}

// "JYF vs Active Mentoring" — a current-state cohort snapshot. Reads every
// engagement, drops placeholder/group clients (ca_clients.is_excluded) and
// staff-excluded test mentees (mentee_exclusions), then counts distinct people
// with an OPEN JumpStart engagement vs an open 4x/2x/1x engagement. Pure math in
// lib/cohort.ts; not date-range scoped.
export async function fetchJyfVsMentoring(): Promise<JyfVsMentoring> {
  const [engagements, excludedSet, clientsRes] = await Promise.all([
    fetchAllEngagements(),
    fetchTestClientIds(),
    supabase.from("ca_clients").select("id,is_excluded"),
  ]);
  if (clientsRes.error) throw new Error(clientsRes.error.message);
  const isExcluded = new Map<number, boolean>();
  for (const c of (clientsRes.data ?? []) as { id: number; is_excluded: boolean }[]) isExcluded.set(c.id, c.is_excluded);

  const inputs: CohortEngagementInput[] = [];
  for (const e of engagements) {
    if (e.client_id == null) continue;
    if (isExcluded.get(e.client_id) || excludedSet.has(e.client_id)) continue;
    inputs.push({ clientId: e.client_id, name: e.name, isComplete: e.is_complete, isCanceled: e.is_canceled });
  }
  return computeJyfVsMentoring(inputs);
}

// Set (or update) a mentee's pipeline override. One row per client, holding the
// outcome status (nullable — null = no status override) AND the six manual
// stage-date overrides. The editor always passes the full current state, so the
// upsert replaces every column deterministically.
export async function setMenteeOutcome(
  createdBy: string,
  clientId: number,
  values: {
    status: MenteeStatus | null;
    statusDate: string | null;
    notes: string | null;
    stageDates?: Partial<StageDates6>;
  }
): Promise<void> {
  const sd = values.stageDates ?? {};
  const base = {
    client_id: clientId,
    status: values.status,
    status_date: values.statusDate,
    notes: values.notes,
    created_by: createdBy || null,
  };
  const full = {
    ...base,
    discovery_date: sd.discovery ?? null,
    jumpstart_date: sd.jumpstart ?? null,
    tier_4x_date: sd["4x"] ?? null,
    tier_2x_date: sd["2x"] ?? null,
    tier_1x_date: sd["1x"] ?? null,
    graduation_date: sd.graduated ?? null,
    // Per-exit date columns (9982): record WHEN the chosen exit happened, mirroring
    // status_date for that one status; the others are cleared so only one is set.
    quit_date: values.status === "quit" ? values.statusDate : null,
    no_mentoring_date: values.status === "no_mentoring" ? values.statusDate : null,
    fired_date: values.status === "fired" ? values.statusDate : null,
  };
  let { error } = await supabase.from("mentee_outcomes").upsert(full, { onConflict: "client_id" });
  if (error) {
    // The stage-date columns may not exist yet (migration 9985 not applied) —
    // retry with the base columns so status/notes still save. Date overrides
    // need 9985 applied to persist.
    ({ error } = await supabase.from("mentee_outcomes").upsert(base, { onConflict: "client_id" }));
  }
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

// --- Mentees: HJG's internal SOURCE OF TRUTH (mirrors the Notion "Mentees Database") ---
// One row per mentee (HJG-owned, staff RLS, migration 9986). `client_id` soft-refs
// ca_clients.id (null for prospects not yet in CoachAccountable). Seeded once from
// the Notion export; edited in the dashboard thereafter via the Journeys "Mentee
// record" card. 9 Notion columns (FF amount / Freedom Fight paid? / Wants PP? /
// Date FF paid / Current invoice amount / JS lesson / MN equivalency / dd w a /
// Prayer partner) were removed 2026-06-24 — migration 9979 drops them.

export interface MenteeRecord {
  id: string;
  client_id: number | null;
  notion_key: string;
  name: string;
  mentor_1: string | null;
  status: string | null;
  projected_start: string | null;
  associated_tasks: string | null;
  mentor: string | null;
  offering_signup: string | null;
  dc_date: string | null;
  email: string | null;
  phone: string | null;
  hand_reviewed: boolean; // human/hand-reviewed flag (migration 9977)
  hand_reviewed_at: string | null; // when last marked reviewed
  created_at?: string;
  updated_at?: string;
}

// The fields the Journeys card lets staff edit (everything but identity + audit).
export type MenteeRecordEdit = Partial<
  Omit<MenteeRecord, "id" | "client_id" | "notion_key" | "created_at" | "updated_at">
>;

const MENTEE_SELECT =
  "id,client_id,notion_key,name,mentor_1,status,projected_start,associated_tasks,mentor,offering_signup,dc_date,email,phone,hand_reviewed,hand_reviewed_at,created_at,updated_at";

// PostgREST returns numeric(12,2) columns as strings to preserve precision; coerce
// them back to numbers so MenteeRecord's `number | null` contract actually holds.
// All numeric mentee fields were removed 2026-06-24 (migration 9979); re-add any
// restored numeric column here so it's coerced back to a number on read.
const MENTEE_NUM_FIELDS: readonly string[] = [];
function normalizeMenteeRecord(r: MenteeRecord): MenteeRecord {
  const out = { ...r } as Record<string, unknown>;
  for (const k of MENTEE_NUM_FIELDS) {
    const v = out[k];
    out[k] = v == null || v === "" ? null : Number(v);
  }
  return out as unknown as MenteeRecord;
}

// Normalize a person's name for cross-source matching (case/whitespace-insensitive).
function normalizeName(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Identity keys from the Mentees SOURCE OF TRUTH roster (the Notion-mirrored
// `mentees` table): matched `client_id`s + normalized names. Used to scope the
// Journeys tab to real HJG pipeline mentees, excluding CA's other pipelines.
// Defensive + FAIL-OPEN: if the `mentees` table is missing/empty (9986 unapplied),
// returns `available: false` so callers don't filter anyone out.
export async function fetchMenteeRosterKeys(): Promise<{ available: boolean; names: Set<string>; clientIds: Set<number> }> {
  const names = new Set<string>();
  const clientIds = new Set<number>();
  const { data, error } = await supabase.from("mentees").select("client_id,name");
  if (error) return { available: false, names, clientIds };
  for (const r of (data ?? []) as { client_id: number | null; name: string | null }[]) {
    const nm = normalizeName(r.name);
    if (nm) names.add(nm);
    if (r.client_id != null) clientIds.add(r.client_id);
  }
  return { available: names.size > 0 || clientIds.size > 0, names, clientIds };
}

// All mentee records keyed by client_id. Rows with a null client_id (prospects not
// yet in CA) are dropped here — they aren't reachable from the Journeys mentee list.
export async function fetchMenteeRecordsByClient(): Promise<Map<number, MenteeRecord>> {
  const { data, error } = await supabase.from("mentees").select(MENTEE_SELECT);
  if (error) throw new Error(error.message);
  const map = new Map<number, MenteeRecord>();
  for (const raw of (data ?? []) as MenteeRecord[]) {
    const r = normalizeMenteeRecord(raw);
    if (r.client_id != null && !map.has(r.client_id)) map.set(r.client_id, r);
  }
  return map;
}

// Every mentee record (incl. prospects with a null client_id), normalized and
// sorted by name. Powers the standalone, Notion-like "Mentees" tab.
export async function fetchAllMenteeRecords(): Promise<MenteeRecord[]> {
  const { data, error } = await supabase.from("mentees").select(MENTEE_SELECT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as MenteeRecord[])
    .map(normalizeMenteeRecord)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

// Update a mentee record by its uuid PK — works for ANY row, including the
// null-client_id prospects the Journeys card can't reach. Returns the saved row.
export async function updateMenteeRecordById(id: string, edits: MenteeRecordEdit): Promise<MenteeRecord> {
  const { data, error } = await supabase.from("mentees").update(edits).eq("id", id).select(MENTEE_SELECT).single();
  if (error) throw new Error(error.message);
  return normalizeMenteeRecord(data as MenteeRecord);
}

// Create a brand-new mentee record (a manually added person, no Notion/CA origin).
export async function createMenteeRecord(userId: string, name: string, edits: MenteeRecordEdit = {}): Promise<MenteeRecord> {
  const notionKey = `manual:${name.trim().toLowerCase()}:${Date.now()}`;
  const { data, error } = await supabase
    .from("mentees")
    .insert({ client_id: null, notion_key: notionKey, name: name.trim() || "New mentee", created_by: userId || null, ...edits })
    .select(MENTEE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return normalizeMenteeRecord(data as MenteeRecord);
}

// Create or update the source-of-truth record for a CA client. Read-modify-write
// by client_id so it works whether or not a Notion-seeded row already exists.
export async function saveMenteeRecord(
  userId: string,
  clientId: number,
  name: string,
  edits: MenteeRecordEdit
): Promise<MenteeRecord> {
  const { data: rows, error: selErr } = await supabase.from("mentees").select("id").eq("client_id", clientId).limit(1);
  if (selErr) throw new Error(selErr.message);
  const existing = (rows ?? [])[0] as { id: string } | undefined;
  if (existing) {
    const { data, error } = await supabase.from("mentees").update(edits).eq("id", existing.id).select(MENTEE_SELECT).single();
    if (error) throw new Error(error.message);
    return normalizeMenteeRecord(data as MenteeRecord);
  }
  const { data, error } = await supabase
    .from("mentees")
    .insert({ client_id: clientId, notion_key: `client:${clientId}`, name, created_by: userId || null, ...edits })
    .select(MENTEE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return normalizeMenteeRecord(data as MenteeRecord);
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
  // Excluded mentees + anyone not in the Mentees source-of-truth roster (CA's other
  // pipelines) don't skew the board aggregate.
  const journeys = allJourneys.filter((j) => !j.excluded && j.inSourceOfTruth);
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

// ============================================================================
// Mentee management (SOURCE OF TRUTH) — rebuilt 2026-06-24 (migration 9975).
// One `mentees` row per person, in two layers:
//   * ca_*  — derived from CoachAccountable, refreshed every sync (sync owns).
//   * hand  — status / *_override / Notion info / notes / is_test (staff own;
//             never touched by a sync). This is the source of truth.
// The app reads the EFFECTIVE value (hand override ?? ca value). CA derivation is
// pure in lib/menteeJourney.ts. (Phase 1: data layer; the new Mentees page lands
// in Phase 2.)
// ============================================================================

export type MenteeMgmtStatus = "active" | "graduated" | "quit" | "fired" | "paused" | "declined";

// The raw `mentees` row (both layers). Effective values are derived in the view.
export interface MenteeRow {
  id: string;
  client_id: number | null;
  // CA layer (sync-owned, refreshed each sync)
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
  ca_status: string | null;
  ca_synced_at: string | null;
  // hand layer (staff-owned, source of truth)
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
  email: string | null;
  phone: string | null;
  mentor: string | null;
  notion_status: string | null;
  notes: string | null;
  is_test: boolean;
  created_at: string;
  updated_at: string;
}

// The hand-layer fields a staff member can edit (everything except ca_* + meta).
export type MenteeHandEdit = Partial<
  Pick<
    MenteeRow,
    | "name_override"
    | "status"
    | "status_stage"
    | "status_date"
    | "discovery_date_override"
    | "jumpstart_date_override"
    | "tier_4x_date_override"
    | "tier_2x_date_override"
    | "tier_1x_date_override"
    | "graduation_date_override"
    | "owner_coach_id_override"
    | "email"
    | "phone"
    | "mentor"
    | "notion_status"
    | "notes"
    | "is_test"
  >
>;

const MENTEE_MGMT_SELECT =
  "id,client_id,ca_name,ca_owner_coach_id,ca_owner_coach_name,ca_discovery_date,ca_jumpstart_date,ca_tier_4x_date,ca_tier_2x_date,ca_tier_1x_date,ca_graduation_date,ca_first_meeting,ca_last_meeting,ca_meeting_count,ca_current_tier,ca_jumpstart_end,ca_jyf_purchase_date,ca_start_date,ca_has_open,ca_status,ca_synced_at,name_override,status,status_stage,status_date,discovery_date_override,jumpstart_date_override,tier_4x_date_override,tier_2x_date_override,tier_1x_date_override,graduation_date_override,owner_coach_id_override,email,phone,mentor,notion_status,notes,is_test,created_at,updated_at";

// All mentees (both layers), ordered by effective name.
export async function fetchMentees(): Promise<MenteeRow[]> {
  const { data, error } = await supabase.from("mentees").select(MENTEE_MGMT_SELECT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MenteeRow[];
  rows.sort((a, b) => (a.name_override ?? a.ca_name ?? "").localeCompare(b.name_override ?? b.ca_name ?? ""));
  return rows;
}

// Persist hand-layer edits for one mentee (by uuid PK). Never writes ca_* columns.
export async function saveMenteeHand(id: string, edits: MenteeHandEdit): Promise<void> {
  const { error } = await supabase.from("mentees").update(edits).eq("id", id);
  if (error) throw new Error(error.message);
}

// Add a hand-only mentee (a prospect not yet in CA). client_id stays null.
export async function createMentee(userId: string, name: string, edits: MenteeHandEdit = {}): Promise<MenteeRow> {
  const { data, error } = await supabase
    .from("mentees")
    .insert({ name_override: name, created_by: userId || null, ...edits })
    .select(MENTEE_MGMT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as MenteeRow;
}

// Client ids flagged is_test (replaces mentee_exclusions). Used by Metrics to drop
// test/placeholder mentees from its ranges (wired in Phase 2).
export async function fetchTestClientIds(): Promise<Set<number>> {
  const set = new Set<number>();
  // Fail-open: before migration 9975 the column doesn't exist — return empty so the
  // rest of the dashboard (Metrics ranges, JYF cohort) keeps working until cutover.
  const { data, error } = await supabase.from("mentees").select("client_id").eq("is_test", true);
  if (error) return set;
  for (const r of (data ?? []) as { client_id: number | null }[]) if (r.client_id != null) set.add(r.client_id);
  return set;
}

// Manual "Rebuild from CA": recompute the CA layer for every mentee from the synced
// mirror (no CoachAccountable calls) and upsert ONLY the ca_* columns — the hand
// layer is untouched. Mirrors the sync's materialize step (lib/sync.ts). Returns
// the number of mentees refreshed.
export async function rebuildMenteesFromCa(): Promise<number> {
  const [cl, en, ap, co] = await Promise.all([
    supabase.from("ca_clients").select("id,name,coach_id,is_excluded"),
    supabase.from("ca_engagements").select("id,client_id,name,start_date,end_date,is_complete,is_canceled"),
    supabase.from("ca_appointments").select("client_id,coach_id,engagement_id,category,start_date"),
    supabase.from("ca_coaches").select("id,name"),
  ]);
  const firstErr = cl.error || en.error || ap.error || co.error;
  if (firstErr) throw new Error(firstErr.message);
  const clients = (cl.data ?? []) as { id: number; name: string | null; coach_id: number | null; is_excluded: boolean | null }[];
  const engagements = (en.data ?? []) as {
    id: number | null;
    client_id: number | null;
    name: string | null;
    start_date: string | null;
    end_date: string | null;
    is_complete: boolean | null;
    is_canceled: boolean | null;
  }[];
  const appts = (ap.data ?? []) as { client_id: number | null; coach_id: number | null; engagement_id: number | null; category: string | null; start_date: string | null }[];
  const coaches = (co.data ?? []) as { id: number; name: string | null }[];

  const purchaseMap = await fetchConversionPurchasesByClient(clients.map((c) => c.id));
  const purchases: { clientId: number; date: string }[] = [];
  for (const [clientId, dates] of purchaseMap) if (dates[0]) purchases.push({ clientId, date: dates[0] });

  const caRecords = deriveMenteeCaRecords({
    clients: clients.map((c) => ({ id: c.id, name: c.name, coachId: c.coach_id ?? null, isExcluded: !!c.is_excluded })),
    engagements: engagements.map((e) => ({
      id: e.id,
      clientId: e.client_id ?? null,
      name: e.name,
      startDate: e.start_date,
      endDate: e.end_date,
      isComplete: !!e.is_complete,
      isCanceled: !!e.is_canceled,
    })),
    appointments: appts.map((a) => ({
      clientId: a.client_id ?? null,
      coachId: a.coach_id ?? null,
      engagementId: a.engagement_id ?? null,
      category: a.category ?? "other",
      date: a.start_date,
    })),
    coaches: coaches.map((c) => ({ id: c.id, name: c.name })),
    purchases,
    today: todayYmd(),
    basis: "first_meeting",
  });
  const syncedAt = new Date().toISOString();
  const rows = caRecords.map((r) => toMenteeCaUpsertRow(r, syncedAt));
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("mentees").upsert(batch, { onConflict: "client_id" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

// One mentoring/group meeting for the per-mentee detail pane (Mentees tab).
export interface MenteeMeetingLite {
  date: string;
  name: string;
  tier: PipelineTier | null;
  isGroup: boolean;
  coachName: string | null;
  engagementId: number | null;
}

// All mentoring/group meetings for ONE mentee, ascending by date, tagged with the
// engagement's pipeline tier + the coach who ran it.
export async function fetchMenteeMeetings(clientId: number): Promise<MenteeMeetingLite[]> {
  const [apptRes, engRes, coachRes] = await Promise.all([
    supabase
      .from("ca_appointments")
      .select("name,category,engagement_id,coach_id,start_date")
      .eq("client_id", clientId)
      .in("category", ["mentoring", "group"])
      .eq("status", "A")
      .order("start_date", { ascending: true }),
    supabase.from("ca_engagements").select("id,name").eq("client_id", clientId),
    supabase.from("ca_coaches").select("id,name"),
  ]);
  if (apptRes.error) throw new Error(apptRes.error.message);
  if (engRes.error) throw new Error(engRes.error.message);
  const tierByEng = new Map<number, PipelineTier>();
  for (const e of (engRes.data ?? []) as { id: number | null; name: string | null }[]) {
    if (e.id == null) continue;
    const t = engagementTier(e.name);
    if ((PIPELINE_TIERS as readonly string[]).includes(t)) tierByEng.set(e.id, t as PipelineTier);
  }
  const coachName = new Map<number, string | null>();
  for (const c of (coachRes.data ?? []) as { id: number; name: string | null }[]) coachName.set(c.id, c.name);
  return ((apptRes.data ?? []) as { name: string; category: string; engagement_id: number | null; coach_id: number | null; start_date: string | null }[])
    .filter((a) => a.start_date)
    .map((a) => ({
      date: a.start_date as string,
      name: a.name,
      tier: a.engagement_id != null ? tierByEng.get(a.engagement_id) ?? null : null,
      isGroup: a.category === "group",
      coachName: a.coach_id != null ? coachName.get(a.coach_id) ?? `#${a.coach_id}` : null,
      engagementId: a.engagement_id,
    }));
}

// One engagement for the per-mentee detail pane.
export interface MenteeEngagementLite {
  id: number | null;
  name: string | null;
  tier: string;
  startDate: string | null;
  endDate: string | null;
  isComplete: boolean;
  isCanceled: boolean;
}

export async function fetchMenteeEngagements(clientId: number): Promise<MenteeEngagementLite[]> {
  const { data, error } = await supabase
    .from("ca_engagements")
    .select("id,name,start_date,end_date,is_complete,is_canceled")
    .eq("client_id", clientId)
    .order("start_date", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EngagementRow[]).map((e) => ({
    id: e.id,
    name: e.name,
    tier: engagementTier(e.name),
    startDate: e.start_date,
    endDate: e.end_date,
    isComplete: !!e.is_complete,
    isCanceled: !!e.is_canceled,
  }));
}

// "Meetings to Freedom!" report (Metrics card), rebuilt off the new mentees table:
// graduated mentees (effective status), their effective grad date + JumpStart-end +
// first ongoing tier, and their 1-on-1 meetings. Test mentees are dropped.
export async function fetchFreedomReport() {
  // Fail-open before migration 9975: an empty report instead of erroring the Metrics tab.
  let mentees: MenteeRow[];
  try {
    mentees = await fetchMentees();
  } catch {
    return computeMeetingsToFreedom([]);
  }
  const today = todayYmd();
  const grads = mentees
    .map((m) => toEffectiveMentee(m, today))
    .filter((m) => !m.isTest && m.clientId != null && m.resolvedStatus === "graduated");
  const gradIds = new Set(grads.map((m) => m.clientId as number));
  const meetingsByClient = new Map<number, { date: string; isGroup: boolean }[]>();
  if (gradIds.size) {
    const all = await fetchAllMentoring();
    for (const a of all) {
      if (a.client_id == null || !gradIds.has(a.client_id) || !a.start_date) continue;
      const arr = meetingsByClient.get(a.client_id) ?? [];
      arr.push({ date: a.start_date, isGroup: a.category === "group" });
      meetingsByClient.set(a.client_id, arr);
    }
  }
  const inputs = grads.map((m) => ({
    clientId: m.clientId as number,
    name: m.name,
    graduated: true,
    graduationDate: m.graduationDate,
    jumpstartEnd: m.jumpstartEnd,
    firstOngoingStart: [m.tier4xDate, m.tier2xDate, m.tier1xDate].filter((d): d is string => !!d).sort()[0] ?? null,
    meetings: meetingsByClient.get(m.clientId as number) ?? [],
  }));
  return computeMeetingsToFreedom(inputs);
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
  // clientId -> the mentee's OWNER (CA primary coach); the engine credits this coach
  // for the invoice. Null when not synced yet => engine falls back to engagement coverage.
  primaryCoachOf: (clientId: number) => number | null;
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
  const [invoices, engagements, coachesRes, clientsRes, settingsRes, primaryCoach] = await Promise.all([
    fetchAllPayInvoices(),
    fetchAllPayEngagements(),
    supabase.from("ca_coaches").select("id,name"),
    supabase.from("ca_clients").select("id,name"),
    supabase.from("coach_settings").select("coach_id,pay_start_month"),
    fetchPrimaryCoachByClient(),
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
    primaryCoachOf: (clientId) => primaryCoach.get(clientId) ?? null,
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

// --- Program hours (Margins tab) ---
// Delivered meeting hours per month for a program (its pipeline tiers), and the
// manually-entered staff hours. Pure comparison lives in lib/margins.ts.

// Delivered SESSIONS per month for the given tiers — the rows behind the Margins
// delivered-hours bars (and the click-through meeting list). A session = a distinct
// (coach, exact start time) slot, so a group meeting is ONE session (its attendees
// are summed onto it), not one per attendee. Meetings with no start time get their
// own id. Each session's hours = its real duration (end − start) when recorded, else
// the PROGRAM_MEETING_HOURS stand-in (e.g. before a re-sync populates end_raw).
// Derive the per-month {sessions, hours} totals with `programMonthTotals` below.
export async function fetchProgramSessionsByMonth(tiers: PipelineTier[]): Promise<Map<string, ProgramSession[]>> {
  const tierSet = new Set<string>(tiers);
  const [engagements, coachesRes] = await Promise.all([fetchAllEngagements(), supabase.from("ca_coaches").select("id,name")]);
  const engTier = engagementTierMap(engagements);
  const coachMap = new Map<number, string | null>();
  for (const c of (coachesRes.data ?? []) as { id: number; name: string | null }[]) coachMap.set(c.id, c.name);

  // slotKey -> the session, with its month carried for the final grouping.
  const bySlot = new Map<string, ProgramSession & { _month: string }>();
  const pageSize = 1000;
  for (let f = 0; ; f += pageSize) {
    const { data, error } = await supabase
      .from("ca_appointments")
      .select("id,coach_id,engagement_id,start_date,start_raw,end_raw,name")
      .in("category", ["mentoring", "group"])
      .eq("status", "A")
      .range(f, f + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { id: number; coach_id: number | null; engagement_id: number | null; start_date: string | null; start_raw: string | null; end_raw: string | null; name: string | null }[];
    for (const a of batch) {
      if (a.engagement_id == null) continue;
      const tier = engTier.get(a.engagement_id);
      if (!tier || !tierSet.has(tier)) continue;
      const month = (a.start_date ?? "").slice(0, 7);
      if (!month) continue;
      const slot = a.start_raw ? `${a.coach_id ?? "?"}|${a.start_raw}` : `id|${a.id}`;
      const existing = bySlot.get(slot);
      if (existing) {
        existing.attendees++; // another attendee of the same group slot
        continue;
      }
      const dur = meetingHours(a.start_raw, a.end_raw);
      bySlot.set(slot, {
        _month: month,
        date: a.start_date ?? "",
        time: a.start_raw && a.start_raw.length >= 16 ? a.start_raw.slice(11, 16) : null,
        coachName: (a.coach_id != null ? coachMap.get(a.coach_id) : null) ?? (a.coach_id != null ? `#${a.coach_id}` : "Unknown"),
        name: a.name ?? "",
        attendees: 1,
        hours: dur ?? PROGRAM_MEETING_HOURS,
        realDuration: dur != null,
      });
    }
    if (batch.length < pageSize) break;
  }

  const out = new Map<string, ProgramSession[]>();
  for (const s of bySlot.values()) {
    const { _month, ...session } = s;
    let arr = out.get(_month);
    if (!arr) {
      arr = [];
      out.set(_month, arr);
    }
    arr.push(session);
  }
  for (const arr of out.values()) arr.sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
  return out;
}

// Per-month {sessions, hours} totals from the session detail (for the chart + merge).
export function programMonthTotals(sessionsByMonth: Map<string, ProgramSession[]>): Map<string, { sessions: number; hours: number }> {
  const out = new Map<string, { sessions: number; hours: number }>();
  for (const [month, sessions] of sessionsByMonth) {
    let hours = 0;
    for (const s of sessions) hours += s.hours;
    out.set(month, { sessions: sessions.length, hours: Math.round(hours * 100) / 100 });
  }
  return out;
}

export interface ProgramHoursRow {
  program: string;
  month: string; // YYYY-MM
  staffHours: number | null;
  notes: string | null;
}

// All entered staff-hours rows. Defensive: if program_hours (9981) isn't applied
// yet, returns [] so the Margins tab still renders (delivered hours from CA show;
// entering staff hours errors until the migration lands).
export async function fetchAllProgramHours(): Promise<ProgramHoursRow[]> {
  const { data, error } = await supabase.from("program_hours").select("program,month,staff_hours,notes");
  if (error) return [];
  return ((data ?? []) as { program: string; month: string; staff_hours: number | string | null; notes: string | null }[]).map((r) => ({
    program: r.program,
    month: r.month,
    staffHours: r.staff_hours == null || r.staff_hours === "" ? null : Number(r.staff_hours),
    notes: r.notes ?? null,
  }));
}

// Upsert one (program, month) staff-hours entry.
export async function setProgramHours(
  createdBy: string,
  program: string,
  month: string,
  staffHours: number | null,
  notes: string | null = null
): Promise<void> {
  const { error } = await supabase
    .from("program_hours")
    .upsert({ program, month, staff_hours: staffHours, notes, created_by: createdBy || null }, { onConflict: "program,month" });
  if (error) throw new Error(error.message);
}

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
  "mentees",
  "payout_builds",
  "program_hours",
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
