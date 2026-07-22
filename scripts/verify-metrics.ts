// Standalone verification. Builds synthetic CA-shaped data and asserts the
// metrics/funnel logic reproduces SPEC.md s4, handles edge cases (exclusions,
// uncategorized types, status filtering, month-boundary/timezone), computes the
// funnel correctly, and that the budget circuit breaker blocks at the cap.
//
// Run: npx tsx scripts/verify-metrics.ts

import { computeMonthlyMetrics } from "../lib/metrics.js";
import { computeFunnelReport } from "../lib/funnel.js";
import { BudgetTracker, BudgetExhaustedError } from "../lib/budget.js";
import { resolveDiscoveryOutcome } from "../lib/conversion.js";
import { engagementTier, categorizeAppointmentName } from "../lib/config.js";
import { shiftMonths, derivePeriodB, delta } from "../lib/compare.js";
import { groupSlotKeys, oneOnOneMenteesByCoach, type CapacityAppt } from "../lib/capacity.js";
import { computeStageDates, highestTier, type EngagementStageInput, type MeetingStageInput } from "../lib/journey.js";
import { computeMeetingsToFreedom, type FreedomMenteeInput } from "../lib/freedom.js";
import { computeJyfVsMentoring, type CohortEngagementInput } from "../lib/cohort.js";
import {
  monthsAgoYmd,
  inStartWindow,
  summarizeCohort,
  startWindowLabel,
  type CohortJourneyInput,
} from "../lib/cohortCompare.js";
import { deriveMenteeCaRecords, toMenteeCaUpsertRow } from "../lib/menteeJourney.js";
import { toEffectiveMentee, aggregateLegDurations, reachedStage, type MenteeRowLike } from "../lib/menteeView.js";
import { computeFunnel } from "../lib/menteeFunnel.js";
import {
  parseCsv,
  parseNotionCsv,
  stripNotionLink,
  normalizeName,
  reconcileCoach,
  parseNotionDate,
  planNotionUpsert,
  planClientIdClaims,
  type NotionImportRow,
} from "../lib/notionCsv.js";
import {
  gradientColors,
  resolveStageColors,
  parseStageColorConfig,
  stageColorsFromRaw,
  hexToRgb,
  STAGE_COUNT,
  DEFAULT_STAGE_COLORS,
} from "../lib/stageColors.js";
import {
  computePayReport,
  computePayTimeline,
  distinctServiceMonths,
  payoutMonths,
  elapsedFraction,
  splitForTenureMonth,
  tenureMonthsBetween,
  parseRampSpec,
  formatRampSpec,
  type PayInvoiceInput,
  type PayEngagementInput,
} from "../lib/pay.js";
import {
  summarizeBuild,
  effectiveLinePayout,
  effectiveLineTotal,
  payoutAfterExclusions,
  payLineSourceKey,
  payLineItemKey,
  lineItemsSplittable,
  sourceIncludedBilled,
  excludedInvoiceSet,
  includedLineItemSet,
  sourceIsClassified,
  sourceAutoBasis,
  lineItemCounts,
  isDefaultLineState,
  DEFAULT_LINE_STATE,
  payoutDetailCsvRows,
  PAYOUT_DETAIL_CSV_COLUMNS,
  type BuildLineInput,
  type BuildLineState,
} from "../lib/payBuild.js";
import { mergeProgramMonths, meetingHours } from "../lib/margins.js";
import { buildPayStubModel, payStubHtml } from "../lib/payStub.js";
import { normalizeEntries, hoursTotal, hourlyTotal, parseEntries, buildHourlyStubModel, hourlyStubHtml } from "../lib/hourlyPay.js";
import {
  parsePayGroupsConfig,
  serializePayGroupsConfig,
  payEligibleForGroup,
  lineItemEligibleForGroup,
  groupHasTemplates,
  normalizeTemplateName,
  DEFAULT_PAY_GROUPS_CONFIG,
  MENTORS_GROUP_ID,
} from "../lib/payGroups.js";
import {
  parseTrendWindow,
  serializeTrendWindow,
  trendWindowLabel,
  rollingConversionTrend,
  DEFAULT_TREND_WINDOW,
  type TrendCall,
} from "../lib/conversionTrend.js";
import { prevYm, defaultServiceMonth, monthPayProgress } from "../lib/paySchedule.js";
import { APP_TAB_KEYS, resolveAllowedTabs, normalizeRole, DEFAULT_ROLE_TABS } from "../lib/permissions.js";
import { parseTransitionOptions, serializeTransitionOptions, DEFAULT_TRANSITION_OPTIONS } from "../lib/transitionOptions.js";
import type { CAAppointment, CAClient, CAOfferingSubmission } from "../lib/types.js";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ok  ${msg}`);
  } else {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  assert(actual === expected, `${msg} (got ${actual}, want ${expected})`);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// --- synthetic data builders ---
let apptId = 1;
const clients = new Map<number, CAClient>();
function ensureClient(id: number, name: string) {
  if (!clients.has(id)) clients.set(id, { ID: id, name });
}
function mentoring(month1: number, clientId: number, coachId: number, day = 15): CAAppointment {
  ensureClient(clientId, `Mentee ${clientId}`);
  return {
    ID: apptId++,
    CoachID: coachId,
    ClientID: clientId,
    name: "* SINGLE MEN ZOOM 60 Minute Weekly Mentoring Call",
    startDate: `2026-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")} 10:00:00`,
    status: "A",
  };
}
function discovery(month1: number, clientId: number, kind: "phone" | "zoom"): CAAppointment {
  ensureClient(clientId, `Prospect ${clientId}`);
  return {
    ID: apptId++,
    CoachID: 1,
    ClientID: clientId,
    name:
      kind === "phone"
        ? "Discovery Call Appointment (Phone Call)"
        : "Discovery Call Appointment (Zoom)",
    startDate: `2026-${String(month1).padStart(2, "0")}-10 09:00:00`,
    status: "A",
  };
}

// SPEC.md s4 targets
const TARGETS = [
  { month1: 1, mentees: 24, meetings: 77, dPhone: 1, dZoom: 2 },
  { month1: 2, mentees: 27, meetings: 74, dPhone: 5, dZoom: 2 },
  { month1: 3, mentees: 29, meetings: 79, dPhone: 1, dZoom: 3 },
  { month1: 4, mentees: 32, meetings: 99, dPhone: 1, dZoom: 3 },
];

const appts: CAAppointment[] = [];
for (const t of TARGETS) {
  const base = t.month1 * 1000;
  // one mentoring appt per unique mentee
  for (let i = 0; i < t.mentees; i++) appts.push(mentoring(t.month1, base + i, (i % 4) + 1));
  // remaining meetings pile onto the first mentee (keeps unique count == mentees)
  for (let i = 0; i < t.meetings - t.mentees; i++) appts.push(mentoring(t.month1, base, 1));
  // discovery calls on distinct prospect clients
  for (let i = 0; i < t.dPhone; i++) appts.push(discovery(t.month1, base + 500 + i, "phone"));
  for (let i = 0; i < t.dZoom; i++) appts.push(discovery(t.month1, base + 600 + i, "zoom"));
}

console.log("[1] SPEC s4 known-good values");
const metrics = computeMonthlyMetrics(appts, clients, { year: 2026, endMonth: 4 });
for (const t of TARGETS) {
  const m = t.month1 - 1;
  eq(metrics.activeMentees[m], t.mentees, `${metrics.shortMonths[m]} activeMentees`);
  eq(metrics.menteeMeetings[m], t.meetings, `${metrics.shortMonths[m]} menteeMeetings`);
  eq(metrics.discoveryPhone[m], t.dPhone, `${metrics.shortMonths[m]} discoveryPhone`);
  eq(metrics.discoveryZoom[m], t.dZoom, `${metrics.shortMonths[m]} discoveryZoom`);
}
eq(metrics.discoveryPhone.length, 12, "arrays are length 12");
eq(metrics.menteeMeetings[4], 0, "May (beyond endMonth) is zero-filled");

console.log("[2] edge cases (exclusions, uncategorized, status, month boundary)");
const edgeClients = new Map<number, CAClient>();
edgeClients.set(1, { ID: 1, name: "Real Mentee" });
edgeClients.set(2, { ID: 2, name: "Gain Momentum Group 1" }); // excluded client
const edge: CAAppointment[] = [
  { ID: 1, CoachID: 1, ClientID: 1, name: "Weekly Mentoring Call", startDate: "2026-01-15 10:00:00", status: "A" },
  { ID: 2, CoachID: 1, ClientID: 1, name: "Mentor Training Extra Teaching, Q & A, and Checkup", startDate: "2026-01-15 11:00:00", status: "A" }, // excluded type
  { ID: 3, CoachID: 1, ClientID: 1, name: "Totally Unknown Session", startDate: "2026-01-15 12:00:00", status: "A" }, // other
  { ID: 4, CoachID: 1, ClientID: 2, name: "Weekly Mentoring Call", startDate: "2026-01-16 10:00:00", status: "A" }, // excluded client
  { ID: 5, CoachID: 1, ClientID: 1, name: "Weekly Mentoring Call", startDate: "2026-01-15 10:00:00", status: "C" }, // canceled
  { ID: 6, CoachID: 1, ClientID: 1, name: "Weekly Mentoring Call", startDate: "2026-01-31 23:30:00", status: "A" }, // near-midnight, stays in Jan
];
const em = computeMonthlyMetrics(edge, edgeClients, { year: 2026, endMonth: 12 });
eq(em.menteeMeetings[0], 2, "Jan counts only the 2 valid mentoring appts (IDs 1 & 6)");
eq(em.activeMentees[0], 1, "excluded client not counted as a mentee");
assert(em.meta.uncategorizedAppointmentNames.includes("Totally Unknown Session"), "uncategorized type recorded");
assert(em.meta.excludedClients.includes("Gain Momentum Group 1"), "excluded client recorded");
eq(em.menteeMeetings[1], 0, "near-midnight Jan 31 appt did NOT leak into February");

console.log("[3] funnel + sales");
const fClients = new Map<number, CAClient>();
[10, 11, 12, 20].forEach((id) => fClients.set(id, { ID: id, name: `Client ${id}` }));
const fAppts: CAAppointment[] = [
  discovery(2, 10, "phone"), // lead 10
  discovery(2, 11, "zoom"), // lead 11
  discovery(2, 12, "phone"), // lead 12 (never converts)
  mentoring(3, 10, 1), // 10 converts
  mentoring(3, 11, 2), // 11 converts
  mentoring(3, 20, 3), // 20 is a mentee but was not a lead this period
];
fAppts.forEach((a) => fClients.set(a.ClientID, fClients.get(a.ClientID)!));
const submissions: CAOfferingSubmission[] = [
  { ID: 1, OfferingID: 100, ClientID: 10, offeringName: "12-Week Mentoring", amountPaid: 1200, dateAdded: "2026-03-02 09:00:00" },
  { ID: 2, OfferingID: 100, ClientID: 11, offeringName: "12-Week Mentoring", amountPaid: 1200, dateAdded: "2026-03-05 09:00:00" },
  { ID: 3, OfferingID: 200, ClientID: 20, offeringName: "Intro Package", amountPaid: 300, dateAdded: "2026-04-01 09:00:00" },
];
const report = computeFunnelReport(fAppts, fClients, submissions, { year: 2026, endMonth: 12 });
const stage = (k: string) => report.funnel.find((s) => s.key === k)!;
eq(stage("leads").count, 3, "funnel leads = 3 discovery clients");
eq(stage("converted").count, 2, "funnel converted = 2 leads who became mentees");
eq(stage("active").count, 3, "funnel active = 3 unique mentees");
eq(stage("graduated").count, null, "graduated is null until a rule is defined");
eq(report.conversionRates.leadsToConverted, 0.67, "conversion rate leads->converted");
eq(report.sales.totalUnits, 3, "sales total units");
eq(report.sales.totalRevenue, 2700, "sales total revenue");
eq(report.sales.byOffering[0].offeringName, "12-Week Mentoring", "top offering by revenue");
eq(report.sales.revenueByMonth[2], 2400, "March revenue");

console.log("[4] budget circuit breaker (BudgetTracker)");
{
  const tracker = new BudgetTracker(2, 0); // cap 2, nothing used yet today
  tracker.spend();
  tracker.spend();
  eq(tracker.callsMade, 2, "two calls counted");
  let blocked = false;
  try {
    tracker.spend();
  } catch (e) {
    blocked = e instanceof BudgetExhaustedError;
  }
  assert(blocked, "third call blocked at cap (BudgetExhaustedError)");

  // A new run must account for calls already made today by earlier runs.
  const carried = new BudgetTracker(5, 4); // cap 5, 4 already used today
  carried.spend();
  let blockedCarried = false;
  try {
    carried.spend();
  } catch (e) {
    blockedCarried = e instanceof BudgetExhaustedError;
  }
  assert(blockedCarried, "tracker blocks once today's prior usage + this run hit the cap");
}

console.log("[5] discovery conversion resolver");
{
  const call = "2026-03-01";
  const r = (over: Partial<Parameters<typeof resolveDiscoveryOutcome>[0]>) =>
    resolveDiscoveryOutcome({ callDate: call, manual: null, conversionPurchaseDates: [], today: "2026-03-15", windowDays: 30, ...over });

  eq(r({ conversionPurchaseDates: ["2026-03-10"] }).outcome, "converted", "purchase on/after the call -> converted");
  eq(r({ conversionPurchaseDates: ["2026-03-01"], today: "2026-03-02" }).outcome, "converted", "same-day purchase counts (inclusive)");
  eq(r({ conversionPurchaseDates: ["2026-02-20"] }).outcome, "pending", "purchase BEFORE the call is ignored");
  eq(r({ today: "2026-03-31" }).outcome, "pending", "day 30, no purchase -> pending (boundary)");
  eq(r({ today: "2026-04-01" }).outcome, "not_converted", "day 31, no purchase -> not_converted (boundary)");
  eq(r({ callDate: null }).outcome, "pending", "missing call date -> pending");
  eq(r({ conversionPurchaseDates: ["2026-03-10"] }).source, "auto", "purchase-derived outcome flagged auto");

  const overridden = r({ manual: "no_show", conversionPurchaseDates: ["2026-03-10"] });
  eq(overridden.outcome, "no_show", "manual override wins over a purchase");
  eq(overridden.source, "manual", "override flagged as manual");
}

console.log("[6] engagement → pipeline tier");
{
  const t = (name: string) => engagementTier(name);
  eq(t("MN Subscription | (0x Month) JumpStart Your Freedom Supervised Progress"), "jumpstart", "modern JumpStart (0x)");
  eq(t("MN Subscription | (4x Month) Zoom Meetings"), "4x", "modern 4x");
  eq(t("MN Subscription | (2x Month) Zoom Meetings"), "2x", "modern 2x");
  eq(t("MN Subscription | (1x Month) Zoom Meetings"), "1x", "modern 1x");
  eq(t("MN Subscription | After Graduation Care"), "graduated", "after-graduation care");
  eq(t("MT Engagement | Mentor Training Program"), "mentor_training", "mentor training excluded from pipeline");
  // Legacy names carry a "60 minute weekly Zoom call" description regardless of
  // cadence — the explicit frequency must win over the word "weekly".
  eq(t("ONE appointment per Month Mentoring Subscription -- 60 minute weekly Zoom call"), "1x", "legacy ONE/month is 1x, not 4x");
  eq(t("TWO appointments per Month Mentoring Subscription -- 60 minute weekly Zoom call"), "2x", "legacy TWO/month is 2x");
  eq(t("WEEKLY appointments Monthly Mentoring Subscription -- 60 minute weekly Zoom call"), "4x", "legacy WEEKLY appointments is 4x");
  eq(t("60 Minute WEEKLY Mentoring Sessions - Pay in Advance Every 4 Appointments"), "4x", "legacy every-4-appointments is 4x");
  eq(t("60 Minute BIWEEKLY Coaching Sessions - Pay in Advance Every 2 Appointments"), "2x", "legacy biweekly/every-2 is 2x");
  eq(t("Gain Momentum Group"), "group", "gain momentum group");
  eq(t(""), "other", "empty name");
}

console.log("[7] appointment categorization (group sessions vs 1-on-1)");
{
  const c = (name: string) => categorizeAppointmentName(name);
  // Group formats get their own category so capacity can drop them.
  eq(c("In Depth Mentoring Session"), "group", "In Depth is a group session");
  eq(c("Tracking Together"), "group", "Tracking Together is a group session");
  // True 1-on-1 mentoring stays "mentoring".
  eq(c("Weekly Mentoring Call"), "mentoring", "1-on-1 mentoring call stays mentoring");
  eq(c("Single Men Mentoring"), "mentoring", "single men stays mentoring");
  // Discovery + exclusions are unaffected by the new group precedence.
  eq(c("Discovery Call Appointment (Phone Call)"), "discoveryPhone", "discovery phone unaffected");
  eq(c("Mentor Training Extra Teaching"), "excluded", "excluded type unaffected");
}

console.log("[8] staff payment engine — Clayton split (invoice-date proration, two-month roll, per-mentor ramp)");
{
  // Default ramp: month 1 = 35%, month 2 = 50%, month 3+ = 60% (by MENTOR tenure).
  eq(splitForTenureMonth(1), 0.35, "tenure month 1 -> 35%");
  eq(splitForTenureMonth(2), 0.5, "tenure month 2 -> 50%");
  eq(splitForTenureMonth(3), 0.6, "tenure month 3 -> 60%");
  eq(splitForTenureMonth(12), 0.6, "established mentor -> 60%");
  eq(tenureMonthsBetween("2026-01", "2026-03"), 3, "Jan start -> March is tenure month 3");
  // Per-mentor ramp override (a fast-tracked mentor at 50/60/60).
  eq(splitForTenureMonth(1, [0.5, 0.6, 0.6]), 0.5, "custom ramp month 1 -> 50%");
  eq(splitForTenureMonth(2, [0.5, 0.6, 0.6]), 0.6, "custom ramp month 2 -> 60%");
  eq(splitForTenureMonth(9, [0.5, 0.6, 0.6]), 0.6, "custom ramp holds at final -> 60%");
  eq(splitForTenureMonth(0, [0.5, 0.6, 0.6]), 0.5, "pre-tenure uses the first ramp value");
  // Ramp spec parse/format: "50/60/60" and "0.5,0.6,0.6" both mean 50/60/60.
  eq(JSON.stringify(parseRampSpec("50/60/60")), JSON.stringify([0.5, 0.6, 0.6]), "parse '50/60/60'");
  eq(JSON.stringify(parseRampSpec("0.5,0.6,0.6")), JSON.stringify([0.5, 0.6, 0.6]), "parse '0.5,0.6,0.6'");
  eq(parseRampSpec(""), null, "blank ramp -> null (falls back to default)");
  eq(parseRampSpec("  "), null, "whitespace ramp -> null");
  eq(formatRampSpec([0.5, 0.6, 0.6]), "50/60/60", "format [0.5,0.6,0.6] -> '50/60/60'");
  // Fixed 30-day proration denominator (Clayton).
  eq(elapsedFraction(12), 0.4, "day 12 -> 12/30 elapsed (fixed 30-day month)");
  eq(elapsedFraction(19), 19 / 30, "day 19 -> 19/30 elapsed");
  eq(elapsedFraction(30), 1, "day 30 -> fully elapsed");
  eq(elapsedFraction(31), 1, "a day past the 30th clamps to fully elapsed");

  const coachName = (id: number) => (id === 29074 ? "Harry Shenk" : `#${id}`);
  const clientName = (id: number) => `Mentee ${id}`;

  // ---- The canonical Alex Arnold example (Clayton's own walkthrough) ----
  // Harry started Jan 2026 (so by March he's at the established 60%). Alex pays
  // $425 on the 12th (Mar, Apr) then the 19th (May, pushed a week). Each invoice's
  // 60% is split across two calendar months by where its day falls (fixed /30).
  const harry: PayEngagementInput[] = [
    { clientId: 1, coachId: 29074, startDate: "2026-01-01", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month)" },
  ];
  const alex: PayInvoiceInput[] = [
    { clientId: 1, serviceDate: "2026-03-12", billed: 425, collected: 425 },
    { clientId: 1, serviceDate: "2026-04-12", billed: 425, collected: 425 },
    { clientId: 1, serviceDate: "2026-05-19", billed: 425, collected: 425 },
  ];

  const mar = computePayReport({ ym: "2026-03", invoices: alex, engagements: harry, coachName, clientName });
  eq(mar.mentors[0].splitPct, 0.6, "Harry established -> 60%");
  eq(mar.mentors[0].lines[0].recognizedThis, 255, "March: recognized this month = 425*(1-12/30) = $255");
  eq(mar.mentors[0].lines[0].rolloverPrev, 0, "no rollover into the first month");
  eq(mar.mentors[0].payout, 153, "March payout = 425*(1-12/30)*0.6 = $153");

  const apr = computePayReport({ ym: "2026-04", invoices: alex, engagements: harry, coachName, clientName });
  eq(apr.mentors[0].lines[0].rolloverPrev, 170, "March's elapsed slice rolls into April = 425*12/30 = $170");
  eq(apr.mentors[0].payout, 255, "April payout = this(425*0.6) + rolled(425*0.4) at 60% = $255");

  const may = computePayReport({ ym: "2026-05", invoices: alex, engagements: harry, coachName, clientName });
  eq(may.mentors[0].payout, 195.5, "May payout = (425*(1-19/30) + 425*(12/30)) * 0.6 = $195.50");

  // June has NO invoice, but May's elapsed slice still rolls forward — the mentor
  // gets the tail.
  const jun = computePayReport({ ym: "2026-06", invoices: alex, engagements: harry, coachName, clientName });
  eq(jun.mentors[0].lines[0].billed, 0, "no invoice billed in June (rollover-only line)");
  eq(jun.mentors[0].payout, 161.5, "June payout = 425*(19/30)*0.6 = $161.50 (May's tail)");

  // Conservation: each invoice's two slices add back to its full 60%; the whole
  // run pays exactly 60% of all billed.
  const tlAlex = computePayTimeline({ invoices: alex, engagements: harry, coachName, clientName });
  eq(tlAlex.totals.payout, 765, "total = 0.6 * (3 * 425) = $765 across the four payout months");
  eq(tlAlex.months.map((m) => m.ym).join(","), "2026-06,2026-05,2026-04,2026-03", "payout months include the June rollover tail");

  // ---- Pay on BILLED: partial collection doesn't change the payout ----
  const partial = computePayReport({
    ym: "2026-04",
    invoices: [{ clientId: 1, serviceDate: "2026-04-01", billed: 425, collected: 200 }],
    engagements: harry,
    coachName,
    clientName,
  });
  // Day 1 -> elapsed 1/30 -> recognized this month = 425*(29/30); rollover next month.
  eq(partial.mentors[0].collected, 200, "collected ($200) carried for reference");
  eq(partial.mentors[0].lines[0].recognizedThis, round2(425 * (29 / 30)), "billed basis: recognized off $425 not $200");

  // ---- Per-MENTOR ramp: a mentor's 1st month pays 35% across ALL their mentees ----
  const newMentor = computePayReport({
    ym: "2026-03",
    invoices: [
      { clientId: 10, serviceDate: "2026-03-01", billed: 425, collected: 425 },
      { clientId: 11, serviceDate: "2026-03-01", billed: 425, collected: 425 },
    ],
    engagements: [
      { clientId: 10, coachId: 60000, startDate: "2026-03-01", endDate: null, isCanceled: false, name: "(4x Month)" },
      { clientId: 11, coachId: 60000, startDate: "2026-03-01", endDate: null, isCanceled: false, name: "(2x Month)" },
    ],
    coachName: (id) => `#${id}`,
    clientName,
  });
  eq(newMentor.mentors[0].menteeCount, 2, "mentor has two mentees this month");
  eq(newMentor.mentors[0].splitPct, 0.35, "mentor's 1st month -> 35% across ALL mentees");
  // Each invoice day 1: recognized this month = 425*(29/30) each -> *0.35.
  eq(newMentor.mentors[0].payout, round2(2 * 425 * (29 / 30) * 0.35), "35% across both mentees, day-1 proration");

  // ---- No mentoring coverage: revenue is EXCLUDED from pay (surfaced, not dropped).
  //      An invoice with no engagement covering any day of its month has tier
  //      "other" -> not a 4x/2x/1x mentoring tier -> excluded per the user's rule. ----
  const noEng = computePayReport({
    ym: "2026-04",
    invoices: [{ clientId: 1, serviceDate: "2026-04-12", billed: 425, collected: 425 }],
    engagements: [{ clientId: 1, coachId: 29074, startDate: "2026-09-01", endDate: null, isCanceled: false, name: "(4x)" }],
    coachName,
    clientName,
  });
  eq(noEng.mentors.length, 0, "no mentor paid when no engagement overlaps the invoice month");
  eq(noEng.unassigned.length, 0, "no-coverage revenue is not a paid line");
  eq(noEng.excludedBilled, 425, "no-coverage (non-mentoring) revenue surfaced as excludedBilled, not dropped");

  // ---- JYF / JumpStart is excluded; only 4x/2x/1x mentoring is mentor pay ----
  // Decided with the user 2026-07-09. A JumpStart-covered invoice pays nothing and
  // is surfaced in excludedBilled; a 4x-covered invoice the same month pays normally.
  const jyfExcl = computePayReport({
    ym: "2026-05",
    invoices: [
      { clientId: 1, serviceDate: "2026-05-01", billed: 175, collected: 175 }, // JumpStart -> excluded
      { clientId: 2, serviceDate: "2026-05-02", billed: 425, collected: 425 }, // 4x -> paid
    ],
    engagements: [
      { clientId: 1, coachId: 500, startDate: "2026-04-01", endDate: "2026-05-29", isCanceled: false, name: "MN Subscription | (0x Month) JumpStart Your Freedom Supervised Progress" },
      { clientId: 2, coachId: 500, startDate: "2026-03-01", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month) Zoom Meetings" },
    ],
    coachName: (id) => `#${id}`,
    clientName,
    startMonthOverride: new Map([[500, "2026-01"]]),
  });
  eq(jyfExcl.excludedBilled, 175, "JumpStart/JYF invoice ($175) excluded from pay and surfaced");
  eq(jyfExcl.mentors[0]?.menteeCount, 1, "only the 4x mentee is paid (JYF mentee dropped)");
  eq(jyfExcl.mentors[0]?.lines.every((l) => l.tier === "4x"), true, "the only paid line is the 4x mentee");

  // ---- Overlap guard (post-review 2026-07-09): a still-open 4x engagement PLUS a
  //      later-starting NON-mentoring engagement (After Graduation Care) must not
  //      hijack the tier and drop the legit 4x invoice. The gate keys off the
  //      mentoring engagement (mentoringCoverFor), so the 4x is still paid. ----
  const overlap = computePayReport({
    ym: "2026-06",
    invoices: [{ clientId: 1, serviceDate: "2026-06-15", billed: 425, collected: 425 }],
    engagements: [
      { clientId: 1, coachId: 600, startDate: "2026-01-01", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month) Zoom Meetings" },
      { clientId: 1, coachId: 600, startDate: "2026-06-01", endDate: null, isCanceled: false, name: "After Graduation Care Tune-Up" }, // starts LATER, tier "graduated"
    ],
    coachName: (id) => `#${id}`,
    clientName,
    startMonthOverride: new Map([[600, "2026-01"]]),
  });
  eq(overlap.mentors[0]?.lines[0]?.tier, "4x", "later-starting graduation engagement does not hijack the 4x tier");
  eq(overlap.mentors[0]?.payout, round2(425 * (1 - 15 / 30) * 0.6), "the legit 4x invoice is still paid, not excluded");
  eq(overlap.excludedBilled, 0, "nothing excluded — a mentoring engagement is active");

  // Empty ramp override must not NaN-poison the payout (guarded fallback to PAY_RAMP).
  const emptyRamp = computePayReport({
    ym: "2026-06",
    invoices: [{ clientId: 1, serviceDate: "2026-06-15", billed: 425, collected: 425 }],
    engagements: [{ clientId: 1, coachId: 601, startDate: null, endDate: null, isCanceled: false, name: "MN Subscription | (4x Month)" }],
    coachName: (id) => `#${id}`,
    clientName,
    rampOverride: new Map([[601, []]]),
  });
  eq(Number.isFinite(emptyRamp.totals.payout), true, "empty ramp override falls back to PAY_RAMP (no NaN)");

  // ---- Mentor-start override pins tenure (a late-synced veteran isn't "new") ----
  const lateSync: PayInvoiceInput[] = [{ clientId: 1, serviceDate: "2026-04-01", billed: 425, collected: 425 }];
  const lateEng: PayEngagementInput[] = [
    { clientId: 1, coachId: 70000, startDate: "2026-04-01", endDate: null, isCanceled: false, name: "(4x)" },
  ];
  const noOv = computePayReport({ ym: "2026-04", invoices: lateSync, engagements: lateEng, coachName: (id) => `#${id}`, clientName });
  eq(noOv.mentors[0].splitPct, 0.35, "without override an April-start mentor looks new -> 35%");
  const ov = computePayReport({
    ym: "2026-04",
    invoices: lateSync,
    engagements: lateEng,
    coachName: (id) => `#${id}`,
    clientName,
    startMonthOverride: new Map([[70000, "2026-01"]]),
  });
  eq(ov.mentors[0].splitPct, 0.6, "override start (Jan) -> April is tenure month 4 -> 60%");

  // ---- Late-month tier change: the new tier's end-of-month invoice credits the
  //      NEW coach, not the outgoing majority-day coach (the Ty Miller bug). The
  //      JumpStart coach held most of May, but the 4x subscription dated 5/30 (the
  //      new engagement) must pay the 4x coach. ----
  const handoffEng: PayEngagementInput[] = [
    { clientId: 1, coachId: 111, startDate: "2026-05-01", endDate: "2026-05-29", isCanceled: false, name: "MN Subscription | (0x Month) JumpStart" },
    { clientId: 1, coachId: 222, startDate: "2026-05-29", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month)" },
  ];
  const handoffInv: PayInvoiceInput[] = [{ clientId: 1, serviceDate: "2026-05-30", billed: 425, collected: 425 }];
  const hMay = computePayReport({ ym: "2026-05", invoices: handoffInv, engagements: handoffEng, coachName: (id) => `#${id}`, clientName });
  eq(hMay.mentors.find((m) => m.coachId === 222)?.lines[0]?.billed ?? 0, 425, "day-30 4x invoice is billed to the NEW 4x coach (222), not the outgoing JumpStart coach");
  const hJun = computePayReport({ ym: "2026-06", invoices: handoffInv, engagements: handoffEng, coachName: (id) => `#${id}`, clientName });
  eq(round2(hJun.mentors.find((m) => m.coachId === 222)?.earned ?? 0), 425, "full day-30 rollover lands under the new 4x coach in June");
  eq(hJun.mentors.find((m) => m.coachId === 111)?.earned ?? 0, 0, "the outgoing JumpStart coach gets none of the 4x invoice");

  // ---- Owner override (session 009: owner = CA primary coach, everywhere incl.
  //      pay). When primaryCoachOf returns a coach, that owner is credited instead
  //      of the engagement-coverage coach; the TIER still comes from coverage. ----
  const owned = computePayReport({
    ym: "2026-05",
    invoices: handoffInv,
    engagements: handoffEng,
    coachName: (id) => `#${id}`,
    clientName,
    primaryCoachOf: () => 999,
  });
  eq(owned.mentors.find((m) => m.coachId === 999)?.lines[0]?.billed ?? 0, 425, "owner (primary coach 999) is credited the invoice, not the engagement coach");
  eq(owned.mentors.find((m) => m.coachId === 222)?.billed ?? 0, 0, "the engagement-coverage coach gets nothing once an owner is set");
  eq(
    owned.mentors.find((m) => m.coachId === 999)?.lines[0]?.tier ?? "",
    hMay.mentors.find((m) => m.coachId === 222)?.lines[0]?.tier ?? "x",
    "tier still comes from engagement coverage, not the owner"
  );
  const ownedNull = computePayReport({
    ym: "2026-05",
    invoices: handoffInv,
    engagements: handoffEng,
    coachName: (id) => `#${id}`,
    clientName,
    primaryCoachOf: () => null,
  });
  eq(ownedNull.mentors.find((m) => m.coachId === 222)?.lines[0]?.billed ?? 0, 425, "null owner falls back to the engagement-coverage coach (222)");

  // ---- Per-mentor ramp override credits the mentor's custom rate ----
  // A fast-tracked mentor (ramp 50/60/60) starting March: April is tenure month 2,
  // which pays 60% under 50/60/60 (vs 50% under the default 35/50/60).
  const rampInv: PayInvoiceInput[] = [{ clientId: 1, serviceDate: "2026-04-01", billed: 425, collected: 425 }];
  const rampEng: PayEngagementInput[] = [
    { clientId: 1, coachId: 800, startDate: "2026-03-01", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month)" },
  ];
  const rampBase = { ym: "2026-04", invoices: rampInv, engagements: rampEng, coachName: (id: number) => `#${id}`, clientName, startMonthOverride: new Map([[800, "2026-03"]]) };
  eq(computePayReport(rampBase).mentors[0].splitPct, 0.5, "default ramp: April (tenure month 2) -> 50%");
  eq(
    computePayReport({ ...rampBase, rampOverride: new Map([[800, [0.5, 0.6, 0.6]]]) }).mentors[0].splitPct,
    0.6,
    "fast-track ramp 50/60/60: April (tenure month 2) -> 60%"
  );

  // ---- Caleb Otto, June 2026 (real-data replica, decided with the user 2026-07-09).
  //      Three 4x mentees each billed $425 on the 15th of May & June -> each nets
  //      one full $425 in June under the two-month split; Caleb's fast-track ramp
  //      (50/60/60 from March) resolves to 60% -> $255 each -> $765. (JYF exclusion
  //      is covered by the jyfExcl / §9 cases; kept out of this replica so the
  //      day-15 split stays on clean cents for the reconciliation invariant.) ----
  const CALEB = 40711;
  const calebEng: PayEngagementInput[] = [1, 2, 3].map((c) => ({
    clientId: c,
    coachId: CALEB,
    startDate: "2026-03-31",
    endDate: null,
    isCanceled: false,
    name: "MN Subscription | (4x Month) Zoom Meetings",
  }));
  const calebInv: PayInvoiceInput[] = [1, 2, 3].flatMap((c) => [
    { clientId: c, serviceDate: "2026-05-15", billed: 425, collected: 425 },
    { clientId: c, serviceDate: "2026-06-15", billed: 425, collected: 425 },
  ]);
  const calebArgs = {
    invoices: calebInv,
    engagements: calebEng,
    coachName: (id: number) => (id === CALEB ? "Caleb Otto" : `#${id}`),
    clientName,
    startMonthOverride: new Map([[CALEB, "2026-03"]]),
    rampOverride: new Map([[CALEB, [0.5, 0.6, 0.6]]]),
    primaryCoachOf: () => CALEB, // owner = Caleb for all three mentees
  };
  const calebJun = computePayReport({ ym: "2026-06", ...calebArgs });
  eq(calebJun.mentors[0].coachId, CALEB, "Caleb is the credited mentor");
  eq(calebJun.mentors[0].splitPct, 0.6, "Caleb's ramp resolves to 60% in June (tenure month 4 of 50/60/60)");
  eq(calebJun.mentors[0].menteeCount, 3, "three paying 4x mentees in June");
  eq(calebJun.mentors[0].payout, 765, "Caleb June payout = 3 x $255 = $765");

  // Reconciliation invariant: running total (through June) + remaining tail = the
  // full 4x value billed through June. All 6 4x invoices are billed by June; the
  // ramp is 60% across May+ so the total 4x value = 6 * 425 * 0.6 = $1530.
  const calebTl = computePayTimeline({ ...calebArgs, months: ["2026-05", "2026-06", "2026-07"] });
  const junYm = "2026-06";
  const rows = calebTl.ledger.filter((r) => r.assigned && r.coachId === CALEB);
  const running = round2(rows.filter((r) => r.ym <= junYm).reduce((s, r) => s + r.payout, 0));
  const remaining = round2(rows.filter((r) => r.ym === "2026-07").reduce((s, r) => s + r.rolloverPrev * r.splitPct, 0));
  eq(running, 1147.5, "running total through June = May $382.50 + June $765.00");
  eq(remaining, 382.5, "remaining tail = the June invoices' July rollover at 60%");
  eq(round2(running + remaining), 1530, "running + remaining = full 4x value billed through June (6 x $425 x 60%)");

  // ---- Ty Miller replica: the real "$430.83 earned / $258.50 payout" number.
  //      June's own $425 invoice is dated the 30th (fully elapsed) so recognizes $0
  //      in June; June's payout is ENTIRELY May's rolled-in slices. May had TWO 4x
  //      invoices ($425 on the 29th + $20 on the 30th), so the rolled-in total
  //      ($410.83 + $20.00 = $430.83) EXCEEDS the $425 tier price. The new `sources`
  //      expose exactly which invoices (and payment dates) built the number. ----
  const tyEng: PayEngagementInput[] = [
    { clientId: 1, coachId: CALEB, startDate: "2026-03-31", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month) Zoom Meetings" },
  ];
  const tyInv: PayInvoiceInput[] = [
    { clientId: 1, serviceDate: "2026-05-29", billed: 425, collected: 425, invoiceId: 101, invoiceNumber: "A101", payments: [{ datePaid: "2026-05-29", amount: 425, method: "Credit Card", checkNumber: null }], lineItems: [{ item: "4x Month", amount: 425 }] },
    { clientId: 1, serviceDate: "2026-05-30", billed: 20, collected: 20, invoiceId: 102, invoiceNumber: "A102", payments: [{ datePaid: "2026-06-01", amount: 20, method: "Check", checkNumber: "555" }], lineItems: [] },
    { clientId: 1, serviceDate: "2026-06-30", billed: 425, collected: 0, invoiceId: 103, invoiceNumber: "A103", payments: [], lineItems: [{ item: "4x Month", amount: 425 }] },
  ];
  const tyArgs = {
    invoices: tyInv,
    engagements: tyEng,
    coachName: (id: number) => (id === CALEB ? "Caleb Otto" : `#${id}`),
    clientName: (id: number) => (id === 1 ? "Ty Miller" : `Mentee ${id}`),
    startMonthOverride: new Map([[CALEB, "2026-03"]]),
    rampOverride: new Map([[CALEB, [0.5, 0.6, 0.6]]]),
    primaryCoachOf: () => CALEB,
  };
  const tyJun = computePayReport({ ym: "2026-06", ...tyArgs });
  const tyLine = tyJun.mentors[0].lines[0];
  eq(tyLine.recognizedThis, 0, "Ty's June invoice (day 30) recognizes $0 in June — all of it rolls to July");
  eq(tyLine.rolloverPrev, 430.83, "May's two 4x invoices roll $430.83 into June (410.83 + 20.00)");
  eq(tyLine.earned, 430.83, "Ty's June earned = $430.83 (the exact reported number, > the $425 tier)");
  eq(tyJun.mentors[0].payout, 258.5, "Ty's June payout = $430.83 x 60% = $258.50 (the exact reported number)");
  // The sources ARE the audit: 2 rolled-in (May) + 1 this-month (June), oldest first.
  eq(tyLine.sources.length, 3, "three contributing invoices behind the June line");
  eq(tyLine.sources.filter((s) => s.slice === "rollover").length, 2, "two May invoices rolled in");
  eq(tyLine.sources.filter((s) => s.slice === "this-month").length, 1, "one June invoice this month");
  eq(round2(tyLine.sources.filter((s) => s.slice === "rollover").reduce((t, s) => t + s.recognized, 0)), 430.83, "rolled-in slices sum to $430.83");
  eq(tyLine.sources.find((s) => s.slice === "this-month")?.recognized ?? -1, 0, "the June (day-30) source recognizes $0 this month");
  eq(tyLine.sources[0].serviceDate, "2026-05-29", "sources ordered oldest service date first");
  // Payment dates thread through untouched (the answer to 'when did he pay?').
  eq(tyLine.sources[0].payments[0]?.datePaid ?? "", "2026-05-29", "invoice A101's payment date carried onto the source");
  eq(tyLine.sources[1].payments[0]?.method ?? "", "Check", "invoice A102's payment method carried onto the source");
  // Nothing double-counts: summing every source's recognized == the line's earned.
  eq(round2(tyLine.sources.reduce((t, s) => t + s.recognized, 0)), tyLine.earned, "Σ source.recognized == line earned (audit foots)");
}

console.log("[9] staff payment timeline + flat ledger (Clayton roll, unassigned, scoping)");
{
  const coachName = (id: number) => (id === 29074 ? "Harry Shenk" : `#${id}`);
  const clientName = (id: number) => `Mentee ${id}`;

  // Mentee 1: one invoice (Apr 10), Harry established. Mentee 2: invoice (May 5)
  // with NO overlapping engagement -> non-mentoring tier -> EXCLUDED from pay.
  const invoices: PayInvoiceInput[] = [
    { clientId: 1, serviceDate: "2026-04-10", billed: 425, collected: 425 },
    { clientId: 2, serviceDate: "2026-05-05", billed: 100, collected: 100 },
  ];
  const engagements: PayEngagementInput[] = [
    { clientId: 1, coachId: 29074, startDate: "2026-01-01", endDate: null, isCanceled: false, name: "(4x Month)" },
  ];

  eq(distinctServiceMonths(invoices).join(","), "2026-05,2026-04", "distinct service months newest-first");
  eq(payoutMonths(invoices).join(","), "2026-06,2026-05,2026-04", "payout months = service months + rollover tails");

  const tl = computePayTimeline({ invoices, engagements, coachName, clientName });
  // Harry: Apr slice (425*(1-10/30)*0.6=170) + May rollover (425*(10/30)*0.6=85) = 255.
  const harryRows = tl.ledger.filter((r) => r.coachName === "Harry Shenk");
  eq(round2(harryRows.reduce((s, r) => s + r.payout, 0)), 255, "Harry's split payouts sum to 60% of $425 = $255");
  eq(tl.totals.payout, 255, "only the assigned mentee is paid");

  // Mentee 2 has no covering (mentoring) engagement -> excluded from pay, surfaced
  // via excludedBilled rather than dropped. The unassigned bucket stays empty (a
  // mentoring tier always implies a covering engagement with a coach).
  eq(tl.totals.excludedBilled, 100, "mentee 2 ($100, no engagement) is excluded from pay, not paid");
  eq(tl.ledger.some((r) => !r.assigned), false, "no unassigned paid lines once non-mentoring revenue is excluded");

  // An explicit months list scopes the timeline (e.g. a single-month explore).
  const one = computePayTimeline({ invoices, engagements, coachName, clientName, months: ["2026-04"] });
  eq(one.months.length, 1, "explicit months list scopes the timeline");
}

console.log("[9b] payment groups — engagement-template gating (Company options §451)");
{
  const clientName = (id: number) => `Mentee ${id}`;

  // parse/serialize + defaults
  eq(groupHasTemplates(DEFAULT_PAY_GROUPS_CONFIG, MENTORS_GROUP_ID), false, "default Mentors group has no templates (falls back to legacy)");
  eq(payEligibleForGroup(DEFAULT_PAY_GROUPS_CONFIG, MENTORS_GROUP_ID), null, "empty group -> null predicate (legacy fallback)");
  eq(parsePayGroupsConfig("not json").groups[0].id, MENTORS_GROUP_ID, "garbage config -> default (Mentors)");
  eq(parsePayGroupsConfig("").groups.length, 1, "blank config -> default one-group");
  const rt = parsePayGroupsConfig(
    serializePayGroupsConfig({ groups: [{ id: "mentors", name: "Mentors", templateNames: ["MN Subscription | (4x Month) Zoom Meetings"], coachIds: [40711] }] })
  );
  eq(rt.groups[0].templateNames[0], "MN Subscription | (4x Month) Zoom Meetings", "round-trips template names");
  eq(rt.groups[0].coachIds[0], 40711, "round-trips coach ids");

  // Predicate matches by NORMALIZED name (tolerates whitespace/case drift).
  const cfg4x = parsePayGroupsConfig(
    serializePayGroupsConfig({ groups: [{ id: "mentors", name: "Mentors", templateNames: ["MN Subscription | (4x Month) Zoom Meetings"], coachIds: [] }] })
  );
  const pred = payEligibleForGroup(cfg4x, MENTORS_GROUP_ID)!;
  eq(pred("MN Subscription | (4x Month) Zoom Meetings"), true, "exact template name is eligible");
  eq(pred("MN Subscription  |  (4x Month) Zoom Meetings"), true, "whitespace-drifted name still matches (normalized)");
  eq(pred("MN Subscription | (0x Month) JumpStart Your Freedom Supervised Progress"), false, "an unchecked JYF template is NOT eligible");
  eq(normalizeTemplateName("  Foo   Bar "), "foo bar", "normalizeTemplateName collapses whitespace + lowercases");

  // Engine gating: the grid OVERRIDES the legacy 4x/2x/1x detection.
  const eng4x: PayEngagementInput[] = [
    { clientId: 1, coachId: 500, startDate: "2026-01-01", endDate: null, isCanceled: false, name: "MN Subscription | (4x Month) Zoom Meetings" },
  ];
  const inv: PayInvoiceInput[] = [{ clientId: 1, serviceDate: "2026-05-15", billed: 425, collected: 425 }];
  const base = { ym: "2026-05", invoices: inv, engagements: eng4x, coachName: (id: number) => `#${id}`, clientName, startMonthOverride: new Map([[500, "2026-01"]]) };

  // (a) No predicate -> legacy: the (4x) engagement is paid.
  const legacy = computePayReport(base);
  eq(legacy.mentors[0]?.billed ?? 0, 425, "legacy (no grid): a (4x Month) engagement is paid");

  // (b) Grid checks ONLY a different template -> the same 4x invoice is now EXCLUDED.
  const otherCfg = parsePayGroupsConfig(
    serializePayGroupsConfig({ groups: [{ id: "mentors", name: "Mentors", templateNames: ["MN Subscription | Fortify Group"], coachIds: [] }] })
  );
  const gatedOut = computePayReport({ ...base, payEligible: payEligibleForGroup(otherCfg, MENTORS_GROUP_ID)! });
  eq(gatedOut.mentors.length, 0, "grid decides: a 4x engagement whose template is UNCHECKED is not paid");
  eq(gatedOut.excludedBilled, 425, "the unchecked 4x revenue is surfaced as excludedBilled, not silently dropped");

  // (c) Grid checks the 4x template -> paid again (grid authoritative, positive case).
  const gatedIn = computePayReport({ ...base, payEligible: payEligibleForGroup(cfg4x, MENTORS_GROUP_ID)! });
  eq(gatedIn.mentors[0]?.billed ?? 0, 425, "grid decides: a checked (4x) template is paid");
  eq(gatedIn.mentors[0]?.lines[0]?.tier, "4x", "tier label still derived from the engagement name");
}

console.log("[10] compare-mode period math (shiftMonths, presets, delta)");
{
  // Span-aligned month shifting, with day clamped to the target month length.
  eq(shiftMonths("2026-06-22", 1), "2026-05-22", "MoM: shift back one month");
  eq(shiftMonths("2026-01-15", 1), "2025-12-15", "shift across the year boundary");
  eq(shiftMonths("2026-03-31", 1), "2026-02-28", "clamp day to a short month (Feb 2026)");
  eq(shiftMonths("2024-03-31", 1), "2024-02-29", "clamp to Feb 29 in a leap year");
  eq(shiftMonths("2026-06-22", 3), "2026-03-22", "QoQ: shift back one quarter");
  eq(shiftMonths("2026-06-22", 12), "2025-06-22", "YoY: shift back one year");

  // Period B derives from Period A for presets; null for custom.
  const b = derivePeriodB("yoy", { from: "2026-01-01", to: "2026-06-22" });
  eq(b?.from, "2025-01-01", "YoY Period B from = same day last year");
  eq(b?.to, "2025-06-22", "YoY Period B to = same day last year (year-to-date aligned)");
  eq(derivePeriodB("custom", { from: "2026-01-01", to: "2026-06-22" }), null, "custom derives no Period B");

  // Δ against a baseline (Period B).
  const up = delta(120, 100);
  eq(up.abs, 20, "delta abs = a - b");
  eq(up.pct, 20, "delta pct = +20% vs baseline");
  const dn = delta(80, 100);
  eq(dn.abs, -20, "delta abs negative when down");
  eq(dn.pct, -20, "delta pct = -20%");
  eq(delta(5, 0).pct, null, "delta pct is null when the baseline is 0");
}

console.log("[11] mentor capacity — 1-on-1 vs group slots (weekly-slot fix)");
{
  const appts: CapacityAppt[] = [
    { coachId: 1, clientId: 10, isGroup: false, slot: "2026-02-15 10:00:00" }, // multi-client slot
    { coachId: 1, clientId: 11, isGroup: false, slot: "2026-02-15 10:00:00" }, // multi-client slot
    { coachId: 1, clientId: 12, isGroup: false, slot: "2026-02-16 09:00:00" }, // genuine 1-on-1
    { coachId: 2, clientId: 20, isGroup: true, slot: "2026-02-15 18:00:00" }, // named group format
    { coachId: 2, clientId: 21, isGroup: false, slot: "2026-02-17 09:00:00" }, // genuine 1-on-1
    { coachId: 3, clientId: 30, isGroup: false, slot: "2026-02-18 09:00:00" }, // same client...
    { coachId: 3, clientId: 30, isGroup: false, slot: "2026-02-18 09:00:00" }, // ...twice in a slot
  ];
  const groups = groupSlotKeys(appts);
  eq(groups.has("1|2026-02-15 10:00:00"), true, "coach1 10:00 slot is a group (2 distinct clients)");
  eq(groups.has("3|2026-02-18 09:00:00"), false, "same client booked twice is NOT a group");
  eq(groups.size, 1, "exactly one group slot detected");

  const byCoach = oneOnOneMenteesByCoach(appts);
  eq(byCoach.get(1)?.size ?? 0, 1, "coach1 1-on-1 mentees = 1 (multi-client slot excluded)");
  eq(byCoach.get(1)?.has(12) ?? false, true, "coach1's counted mentee is the genuine 1-on-1");
  eq(byCoach.get(2)?.size ?? 0, 1, "coach2 1-on-1 mentees = 1 (named group excluded)");
  eq(byCoach.get(3)?.size ?? 0, 1, "coach3 1-on-1 mentees = 1 (duplicate booking counts once)");

  const groupOnly: CapacityAppt[] = [
    { coachId: 9, clientId: 90, isGroup: false, slot: "2026-03-01 12:00:00" },
    { coachId: 9, clientId: 91, isGroup: false, slot: "2026-03-01 12:00:00" },
  ];
  eq(oneOnOneMenteesByCoach(groupOnly).get(9)?.size ?? 0, 0, "all-group coach has 0 capacity mentees");

  const nullSlots: CapacityAppt[] = [
    { coachId: 5, clientId: 50, isGroup: false, slot: null },
    { coachId: 5, clientId: 51, isGroup: false, slot: null },
  ];
  eq(oneOnOneMenteesByCoach(nullSlots).get(5)?.size ?? 0, 2, "null-slot appts counted individually (no merge)");
}

console.log("[12] journey stage-date basis (engagement start vs first 1-on-1 meeting)");
{
  // Seth-Lehman-shaped: 4x engagement starts 7/2; first appt under it is a 7/2
  // GROUP session, first 1-on-1 mentoring is 7/3; JumpStart has no meeting.
  const engs: EngagementStageInput[] = [
    { tier: "jumpstart", startDate: "2026-05-15" },
    { tier: "4x", startDate: "2026-07-02" },
  ];
  const meets: MeetingStageInput[] = [
    { tier: "4x", date: "2026-07-02", isGroup: true }, // group — excluded
    { tier: "4x", date: "2026-07-03", isGroup: false }, // first 1-on-1
    { tier: "4x", date: "2026-07-10", isGroup: false },
  ];

  const es = computeStageDates("engagement_start", engs, meets);
  eq(es["4x"], "2026-07-02", "engagement_start: 4x = engagement start date");
  eq(es.jumpstart, "2026-05-15", "engagement_start: jumpstart = engagement start date");

  const fm = computeStageDates("first_meeting", engs, meets);
  eq(fm["4x"], "2026-07-03", "first_meeting: 4x = first 1-on-1 meeting (7/2 group ignored)");
  eq(fm.jumpstart, "2026-05-15", "first_meeting: jumpstart falls back to engagement start (no meeting)");

  // A tier whose only meeting is a group session falls back to the engagement start.
  const fm2 = computeStageDates(
    "first_meeting",
    [{ tier: "2x", startDate: "2026-08-01" }],
    [{ tier: "2x", date: "2026-08-01", isGroup: true }]
  );
  eq(fm2["2x"], "2026-08-01", "first_meeting: group-only tier falls back to engagement start");

  eq(highestTier(es), "4x", "highest tier reached = 4x");
  eq(highestTier(computeStageDates("first_meeting", engs, meets)), "4x", "highest tier stable across bases");
}

console.log("[13] build-payout reviewer math (include/exclude, override, totals)");
{
  const lines: BuildLineInput[] = [
    { clientId: 1, payout: 100 },
    { clientId: 2, payout: 50 },
    { clientId: 3, payout: 200 },
  ];
  const states = new Map<number, BuildLineState>([
    [2, { included: false, override: null, note: "no-show month — drop" }], // excluded
    [3, { included: true, override: 150, note: "prorate fix" }], // overridden down
  ]);
  // client 1 has no state -> default (included, engine number).

  // effectiveLinePayout: default uses engine; excluded -> 0; override wins; 0-override stays 0.
  eq(effectiveLinePayout(100), 100, "no state -> engine payout");
  eq(effectiveLinePayout(100, DEFAULT_LINE_STATE), 100, "default state -> engine payout");
  eq(effectiveLinePayout(50, states.get(2)), 0, "excluded line contributes 0");
  eq(effectiveLinePayout(200, states.get(3)), 150, "override wins over engine number");
  eq(effectiveLinePayout(200, { included: true, override: 0, note: null }), 0, "override of 0 zeroes an included line");

  const s = summarizeBuild(lines, states);
  eq(s.computedTotal, 350, "computed total = Σ engine payout over ALL lines");
  eq(s.builtTotal, 250, "built total = 100 (engine) + 0 (excluded) + 150 (override)");
  eq(s.delta, -100, "delta = built - computed");
  eq(s.lineCount, 3, "line count");
  eq(s.includedCount, 2, "included = client 1 + client 3");
  eq(s.excludedCount, 1, "excluded = client 2");
  eq(s.overriddenCount, 1, "overridden = client 3 only (override on an included line)");

  // An all-default build equals the engine total exactly (review is a no-op).
  const clean = summarizeBuild(lines, new Map());
  eq(clean.builtTotal, clean.computedTotal, "all-default build == engine total");
  eq(clean.delta, 0, "no-op review has zero drift");

  // isDefaultLineState: only the untouched line is default (compact persistence).
  eq(isDefaultLineState(DEFAULT_LINE_STATE), true, "default state is default");
  eq(isDefaultLineState({ included: false, override: null, note: null }), false, "excluded is not default");
  eq(isDefaultLineState({ included: true, override: 0, note: null }), false, "override (even 0) is not default");
  eq(isDefaultLineState({ included: true, override: null, note: "checked" }), false, "noted line is not default");

  // ---- payoutDetailCsvRows: the "data used to build the payout" export. One row
  //      per contributing invoice; mentee-level payout columns only on the FIRST
  //      row of each mentee so a column sum never double-counts. ----
  const mkSource = (over: Partial<import("../lib/pay.js").PayLineSource>): import("../lib/pay.js").PayLineSource => {
    const base = {
      invoiceId: 1,
      invoiceNumber: "N1",
      serviceDate: "2026-05-29",
      serviceMonth: "2026-05",
      invoiceDay: 29,
      slice: "rollover" as const,
      billed: 425,
      collected: 425,
      elapsedFraction: 29 / 30,
      recognized: 410.8333,
      tier: "4x",
      payments: [{ datePaid: "2026-05-29", amount: 425, method: "Credit Card", checkNumber: null }],
      lineItems: [{ item: "4x Month", amount: 425 }],
      ...over,
    };
    return { ...base, eligibleBilled: over.eligibleBilled ?? base.billed };
  };
  const detailLines = [
    {
      clientId: 1,
      clientName: "Ty Miller",
      tier: "4x",
      splitPct: 0.6,
      payout: 258.5,
      sources: [mkSource({}), mkSource({ invoiceNumber: "N2", serviceDate: "2026-06-30", serviceMonth: "2026-06", invoiceDay: 30, slice: "this-month", recognized: 0, payments: [] })],
    },
    { clientId: 2, clientName: "Joash", tier: "4x", splitPct: 0.6, payout: 255, sources: [mkSource({ invoiceNumber: "N3" })] },
  ];
  const detailStates = new Map<number, BuildLineState>([[2, { included: false, override: null, note: "drop" }]]);
  const detailRows = payoutDetailCsvRows(detailLines, detailStates);
  const cols = PAYOUT_DETAIL_CSV_COLUMNS;
  const col = (row: (string | number)[], label: string) => row[cols.indexOf(label as (typeof cols)[number])];
  eq(detailRows.length, 3, "one CSV row per contributing invoice (2 + 1)");
  eq(col(detailRows[0], "Payment dates"), "2026-05-29", "payment date exported (ISO, machine-sortable)");
  eq(col(detailRows[0], "Engine payout"), 258.5, "mentee payout on the FIRST invoice row");
  eq(col(detailRows[1], "Engine payout"), "", "blank on the SECOND invoice row (no double-count)");
  eq(col(detailRows[0], "Effective payout"), 258.5, "included line: effective == engine");
  eq(col(detailRows[2], "Included"), "no", "excluded line marked not included");
  eq(col(detailRows[2], "Effective payout"), 0, "excluded line contributes $0 effective");
  eq(col(detailRows[1], "Recognized into month"), 0, "the June (day-30) slice recognizes $0");
}

console.log("[13b] per-invoice + per-line-item exclusions in a payout line");
{
  const mk = (over: Partial<import("../lib/pay.js").PayLineSource>): import("../lib/pay.js").PayLineSource => {
    const base = {
      invoiceId: 0,
      invoiceNumber: null,
      serviceDate: "2026-05-01",
      serviceMonth: "2026-05",
      invoiceDay: 1,
      slice: "rollover" as const,
      billed: 0,
      collected: 0,
      elapsedFraction: 0,
      recognized: 0,
      tier: "4x",
      payments: [],
      lineItems: [],
      ...over,
    };
    return { ...base, eligibleBilled: over.eligibleBilled ?? base.billed };
  };
  const cc = PAYOUT_DETAIL_CSV_COLUMNS;
  const cget = (row: (string | number)[], label: string) => row[cc.indexOf(label as (typeof cc)[number])];

  // --- Whole-invoice drop: Ty Miller's June payout (user CSV). A JumpStart/JYF
  // "Supervised Progress" rollover ($5.83) rides alongside two MN 4x slices ($425
  // rolled-in + $0 this-month). Earned 430.83 × 60% = $258.50; drop JYF -> $255.00.
  const jyf = mk({ invoiceId: 4061, invoiceNumber: "4061", billed: 175, collected: 175, elapsedFraction: 1 / 30, recognized: 175 * (1 / 30), lineItems: [{ item: "JYF Supervised Progress", amount: 175 }] });
  const mn1 = mk({ invoiceId: 4126, invoiceNumber: "4126", serviceDate: "2026-05-30", invoiceDay: 30, billed: 425, collected: 425, elapsedFraction: 1, recognized: 425, lineItems: [{ item: "MN Subscription | (4x Month)", amount: 425 }] });
  const mn2 = mk({ invoiceId: 4187, invoiceNumber: "4187", serviceDate: "2026-06-30", serviceMonth: "2026-06", invoiceDay: 30, slice: "this-month", billed: 425, collected: 425, elapsedFraction: 1, recognized: 0, lineItems: [{ item: "MN Subscription | (4x Month)", amount: 425 }] });
  const ty = { clientId: 294592, payout: 258.5, splitPct: 0.6, sources: [jyf, mn1, mn2] };

  eq(payLineSourceKey(jyf), "id:4061", "source key prefers the CA invoice id");
  eq(payLineSourceKey(mk({ invoiceId: null, invoiceNumber: "X9" })), "no:X9", "source key falls back to invoice number");

  const dropJyfInv: BuildLineState = { included: true, override: null, note: null, excludedInvoices: ["id:4061"] };
  const dropJyfLI: BuildLineState = { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(jyf, 0)] };
  eq(payoutAfterExclusions(ty, DEFAULT_LINE_STATE), 258.5, "no exclusions == engine payout, to the penny");
  eq(payoutAfterExclusions(ty, dropJyfInv), 255, "dropping the whole JYF invoice -> earned 425 x 60% = $255.00");
  eq(payoutAfterExclusions(ty, dropJyfLI), 255, "dropping the JYF via its single line item -> same $255.00");
  eq(payoutAfterExclusions(ty, { included: true, override: null, note: null, excludedInvoices: ["id:9999"] }), 258.5, "a non-matching drop is a no-op");
  eq(payoutAfterExclusions(ty, { included: true, override: null, note: null, excludedInvoices: ["id:4061", "id:4126", "id:4187"] }), 0, "dropping every invoice -> $0");

  // Precedence in effectiveLineTotal: line-exclude > manual override > invoice/line-item drops.
  eq(effectiveLineTotal(ty, dropJyfInv), 255, "invoice drop flows through effectiveLineTotal");
  eq(effectiveLineTotal(ty, { ...dropJyfInv, override: 250 }), 250, "a manual override wins over invoice/line-item drops");
  eq(effectiveLineTotal(ty, { ...dropJyfInv, included: false }), 0, "a line-level exclusion zeroes it regardless");
  eq(effectiveLineTotal(ty, DEFAULT_LINE_STATE), 258.5, "default state -> engine payout");

  // isDefaultLineState: a line carrying only invoice OR line-item drops isn't default.
  eq(isDefaultLineState(dropJyfInv), false, "an invoice-dropped line is not default (persists)");
  eq(isDefaultLineState(dropJyfLI), false, "a line-item-dropped line is not default (persists)");
  eq(isDefaultLineState({ included: true, override: null, note: null, excludedInvoices: [], excludedLineItems: [] }), true, "empty drop lists are default");
  eq(excludedInvoiceSet(dropJyfInv).has("id:4061"), true, "excludedInvoiceSet reads the state");

  // summarizeBuild: builtTotal honors drops; computedTotal stays raw engine.
  const others = [
    { clientId: 287546, payout: 255, splitPct: 0.6, sources: [mk({ invoiceId: 1, recognized: 425 })] },
    { clientId: 280993, payout: 255, splitPct: 0.6, sources: [mk({ invoiceId: 2, recognized: 425 })] },
  ];
  const sm = summarizeBuild([ty, ...others], new Map([[294592, dropJyfInv]]));
  eq(sm.computedTotal, 768.5, "computed total = raw engine (258.5 + 255 + 255)");
  eq(sm.builtTotal, 765, "built total drops the JYF invoice (255 + 255 + 255)");
  eq(sm.invoiceAdjustedCount, 1, "one line adjusted by a drop");
  eq(sm.overriddenCount, 0, "a drop is not counted as an override");

  const csvRows = payoutDetailCsvRows(
    [{ clientId: 294592, clientName: "Ty Miller", tier: "4x", splitPct: 0.6, payout: 258.5, sources: [jyf, mn1, mn2] }],
    new Map([[294592, dropJyfInv]])
  );
  eq(cget(csvRows.find((r) => cget(r, "Invoice #") === "4061")!, "Invoice incl."), "no", "the JYF invoice row is flagged excluded");
  eq(cget(csvRows.find((r) => cget(r, "Invoice #") === "4126")!, "Invoice incl."), "yes", "the MN Subscription invoice stays included");
  eq(cget(csvRows[0], "Engine payout"), 258.5, "engine payout stays the raw number");
  eq(cget(csvRows[0], "Effective payout"), 255, "effective payout reflects the dropped invoice");

  // --- Line-item drop: Josh Lehman's #4109 (user CSV) — a multi-line invoice.
  //   $425 (MN) + $425 (MN) − $175 (credit) − $50 (credit) = $625, this-month day 11.
  //   Recognized = 625 × (1 − 11/30) = $395.83; alone -> 395.83 × 60% = $237.50.
  const inv4109 = mk({
    invoiceId: 4109,
    invoiceNumber: "4109",
    serviceDate: "2026-05-11",
    invoiceDay: 11,
    slice: "this-month",
    billed: 625,
    collected: 625,
    elapsedFraction: 11 / 30,
    recognized: 625 * (1 - 11 / 30),
    lineItems: [
      { item: "MN Subscription (4x Month)", amount: 425 },
      { item: "MN Subscription (4x Month)", amount: 425 },
      { item: "Credit for previous payment", amount: -175 },
      { item: '"Apology" Credit', amount: -50 },
    ],
  });
  const josh = { clientId: 289870, payout: 237.5, splitPct: 0.6, sources: [inv4109] };

  eq(lineItemsSplittable(inv4109), true, "line items reconcile to the $625 total -> splittable");
  eq(payLineItemKey(inv4109, 2).startsWith("id:4109#2:"), true, "line-item key = sourceKey#index:item-slug");
  eq(sourceIncludedBilled(inv4109, { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(inv4109, 2), payLineItemKey(inv4109, 3)] }), 850, "dropping both credits -> basis = 425 + 425 = 850");

  eq(payoutAfterExclusions(josh, DEFAULT_LINE_STATE), 237.5, "no drops -> engine payout $237.50");
  eq(payoutAfterExclusions(josh, { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(inv4109, 2), payLineItemKey(inv4109, 3)] }), 323, "drop the two credits -> 850 × 19/30 × 60% = $323.00");
  eq(payoutAfterExclusions(josh, { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(inv4109, 0)] }), 76, "drop one $425 line -> 200 × 19/30 × 60% = $76.00");
  eq(payoutAfterExclusions(josh, { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(inv4109, 0), payLineItemKey(inv4109, 1), payLineItemKey(inv4109, 2), payLineItemKey(inv4109, 3)] }), 0, "drop every line item -> $0");

  const joshState: BuildLineState = { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(inv4109, 2), payLineItemKey(inv4109, 3)] };
  const smJ = summarizeBuild([josh], new Map([[289870, joshState]]));
  eq(smJ.computedTotal, 237.5, "computed total = raw engine payout");
  eq(smJ.builtTotal, 323, "built total reflects the dropped credit lines");
  eq(smJ.invoiceAdjustedCount, 1, "line-item drop counts as an adjusted line");

  const csvJ = payoutDetailCsvRows(
    [{ clientId: 289870, clientName: "Josh Lehman", tier: "4x", splitPct: 0.6, payout: 237.5, sources: [inv4109] }],
    new Map([[289870, joshState]])
  );
  const row4109 = csvJ.find((r) => cget(r, "Invoice #") === "4109")!;
  eq(cget(row4109, "Invoice incl."), "partial", "a partially-dropped invoice reads 'partial'");
  eq(cget(row4109, "Effective payout"), 323, "line-item drop reflected in effective payout");
  eq(String(cget(row4109, "Line items")).includes("[removed by review]"), true, "reviewer-dropped line items are tagged in the CSV");
  eq(cget(row4109, "Recognized into month"), 538.33, "recognized scales to the surviving $850 basis");
}

console.log("[13c] INVOICE-TRUTH mode: line-item basis engine + review flow");
{
  // Real-world regression set from Harry Shenk's April 2026 audit (2026-07-17):
  // CA engagement flags lied — "canceled" engagements still billing monthly were
  // DROPPED (Brett/Wynn/Lavon), and live engagements swept in JYF/training
  // invoices (Nelson's $550 MT tuition, Joel/David/Josh JYF fees).
  const TPL_4X = "MN Subscription | (4x Month) Zoom Meetings";
  const TPL_2X = "MN Subscription | (2x Month) Zoom Meetings";
  const TPL_1X = "MN Subscription | (1x Month) Zoom Meetings";
  const cfg = parsePayGroupsConfig(
    JSON.stringify({ groups: [{ id: "mentors", name: "Mentors", templateNames: [TPL_4X, TPL_2X, TPL_1X], coachIds: [] }] })
  );
  const liPred = lineItemEligibleForGroup(cfg, MENTORS_GROUP_ID)!;

  // --- the matcher itself ---
  eq(liPred("MN Subscription | (4x Month) Zoom Meetings (Harry Shenk) ($425)"), true, "line item matches template by prefix");
  eq(liPred("MN Subscription | (2x Month) Zoom Meetings (Harry Shank) ($265)"), true, "coach-name typo in the suffix doesn't matter");
  eq(liPred("mn subscription | (4x month)  zoom meetings (X)"), true, "case/whitespace lenient");
  eq(liPred("JYF Supervised Progress (w/ Dave Troyer) ($175)"), false, "JYF fee doesn't match");
  eq(liPred("MT Engagement | One-Year Mentor Training Program (1 of 3 payments) ($550)"), false, "MT tuition doesn't match");
  eq(liPred("Credit for the JYF Fee ($-175)"), false, "credits never match a template");
  eq(lineItemEligibleForGroup(DEFAULT_PAY_GROUPS_CONFIG, MENTORS_GROUP_ID), null, "unconfigured group -> null (legacy fallback)");

  // --- the engine in invoice-truth mode ---
  const li = (item: string, amount: number) => ({ item, amount });
  const MN4 = (coach = "Harry Shenk") => `MN Subscription | (4x Month) Zoom Meetings (${coach}) ($425)`;
  const inv = (
    clientId: number,
    serviceDate: string,
    billed: number,
    items: { item: string; amount: number }[],
    id: number
  ): PayInvoiceInput => ({ clientId, serviceDate, billed, collected: billed, invoiceId: id, invoiceNumber: String(id), lineItems: items });
  const invoices: PayInvoiceInput[] = [
    // Brett (1): 4x engagement is CANCELED in CA but bills $425 MN monthly.
    inv(1, "2026-03-19", 425, [li(MN4(), 425)], 101),
    inv(1, "2026-04-19", 425, [li(MN4(), 425)], 102),
    // Wynn (2): canceled 2x engagement still billing $265 monthly, day 21.
    inv(2, "2026-03-21", 265, [li("MN Subscription | (2x Month) Zoom Meetings (Harry Shenk) ($265)", 265)], 201),
    inv(2, "2026-04-21", 265, [li("MN Subscription | (2x Month) Zoom Meetings (Harry Shenk) ($265)", 265)], 202),
    // Nelson (3): March MN + April MT tuition (must NOT be paid).
    inv(3, "2026-03-09", 425, [li(MN4(), 425)], 301),
    inv(3, "2026-04-14", 550, [li("MT Engagement | One-Year Mentor Training Program (1 of 3 payments) ($550)", 550)], 302),
    // Cade (4): JYF-only both months (must produce NO pay line, only excludedBilled).
    inv(4, "2026-03-21", 175, [li("JYF Supervised Progress (w/ Dave Troyer) ($175)", 175)], 401),
    inv(4, "2026-04-21", 175, [li("JYF Supervised Progress (w/ Dave Troyer) ($175)", 175)], 402),
    // Kendrick (5): April MN + discount credit -> basis 355 (net), day 13.
    inv(5, "2026-04-13", 355, [li(MN4(), 425), li("First-Month Discount Credit", -70)], 501),
    // Orphan (6): eligible MN but NO owner and NO engagement -> unassigned bucket.
    inv(6, "2026-04-10", 425, [li(MN4("Unknown"), 425)], 601),
  ];
  // Engagements: Brett/Wynn CANCELED (the trap — must not matter); Nelson live 4x.
  const engagements: PayEngagementInput[] = [
    { clientId: 1, coachId: 900, startDate: "2025-09-15", endDate: null, isCanceled: true, name: TPL_4X },
    { clientId: 2, coachId: 900, startDate: "2025-11-19", endDate: null, isCanceled: true, name: TPL_2X },
    { clientId: 3, coachId: 900, startDate: "2026-01-05", endDate: "2026-06-05", isCanceled: false, name: TPL_4X },
    // Tenure anchor way back so the mentor is at the 60% rate.
    { clientId: 99, coachId: 900, startDate: "2024-01-01", endDate: "2024-06-01", isCanceled: false, name: TPL_4X },
  ];
  const owner = new Map<number, number>([[1, 900], [2, 900], [3, 900], [4, 900], [5, 900]]); // 6 unowned
  const rpt = computePayReport({
    ym: "2026-04",
    invoices,
    engagements,
    coachName: (id) => (id === 900 ? "Harry" : `#${id}`),
    clientName: (id) => `C${id}`,
    primaryCoachOf: (cid) => owner.get(cid) ?? null,
    payEligible: payEligibleForGroup(cfg, MENTORS_GROUP_ID)!,
    payEligibleLineItem: liPred,
  });
  const harry = rpt.mentors.find((m) => m.coachId === 900)!;
  const lineOf = (cid: number) => harry.lines.find((l) => l.clientId === cid)!;

  // Brett: 425×(19/30) rolled + 425×(11/30) this-month = 425.00 -> ×60% = 255.
  eq(lineOf(1).earned, 425, "CANCELED-engagement mentee still earns (Brett $425)");
  eq(lineOf(1).payout, 255, "Brett pays $255 despite canceled CA engagement");
  eq(lineOf(1).tier, "4x", "tier read from the LINE ITEM, not the engagement");
  // Wynn: 265×0.7 + 265×0.3 = 265 -> $159.
  eq(lineOf(2).earned, 265, "canceled 2x mentee still earns (Wynn $265)");
  eq(lineOf(2).payout, 159, "Wynn pays $159");
  eq(lineOf(2).tier, "2x", "2x tier from the line item");
  // Nelson: only the March rollover counts; the $550 MT tuition is excluded.
  eq(lineOf(3).earned, 127.5, "Nelson April = March rollover only (425×0.3)");
  eq(lineOf(3).payout, 76.5, "Nelson pays $76.50 — MT tuition NOT swept in");
  // Cade: no pay line at all.
  eq(harry.lines.some((l) => l.clientId === 4), false, "JYF-only mentee has NO pay line");
  // Kendrick: basis = 425 − 70 = 355 (credit auto-included as reduction).
  eq(lineOf(5).billed, 355, "discount credit reduces the basis (425−70)");
  const kSrc = lineOf(5).sources[0];
  eq(kSrc.eligibleBilled, 355, "source carries the eligible basis");
  eq(kSrc.lineItems[0].status, "included", "MN line auto-included");
  eq(kSrc.lineItems[1].status, "credit", "credit line flagged for review");
  // excludedBilled picks up the MT tuition + Cade's April JYF fee.
  eq(rpt.excludedBilled, 550 + 175, "MT tuition + JYF fee land in excludedBilled");
  // The unowned/uncovered eligible invoice surfaces as unassigned, not dropped.
  eq(rpt.unassigned.some((u) => u.clientId === 6), true, "eligible line with no coach -> unassigned bucket");

  // Legacy mode is untouched: same inputs WITHOUT the line-item predicate drops
  // Brett/Wynn (canceled) and pays Nelson's MT invoice — the old (wrong) behavior,
  // proven here so the mode switch is intentional and observable.
  const legacy = computePayReport({
    ym: "2026-04",
    invoices,
    engagements,
    coachName: () => "Harry",
    clientName: (id) => `C${id}`,
    primaryCoachOf: (cid) => owner.get(cid) ?? null,
  });
  const lHarry = legacy.mentors.find((m) => m.coachId === 900);
  eq(lHarry?.lines.some((l) => l.clientId === 1) ?? false, false, "legacy still drops the canceled-engagement mentee");
  eq(lHarry?.lines.find((l) => l.clientId === 3)?.billed ?? 0, 550, "legacy still sweeps the MT tuition (the bug, preserved until configured)");

  // --- review flow on classified sources ---
  const bLine = lineOf(3); // Nelson: rollover MN (included) + this-month MT (…wait, MT invoice produced no source)
  eq(bLine.sources.length, 1, "Nelson's line has only the MN source (MT invoice never joined)");
  const kLine = lineOf(5);
  eq(sourceIsClassified(kLine.sources[0]), true, "engine-classified source detected");
  eq(sourceAutoBasis(kLine.sources[0]), 355, "auto basis = eligible net");
  // Exclude the credit -> basis rises to 425; payout = 425×(17/30)×0.6.
  const noCredit: BuildLineState = { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(kLine.sources[0], 1)] };
  eq(lineItemCounts(kLine.sources[0], 1, noCredit), false, "excluded credit no longer counts");
  eq(sourceIncludedBilled(kLine.sources[0], noCredit), 425, "basis without the credit = 425");
  eq(payoutAfterExclusions(kLine, noCredit), round2(round2(425 * (17 / 30)) * 0.6), "payout recomputes with credit excluded");
  // Exclude the MN line, keep the credit -> clamped at 0, not negative.
  const onlyCredit: BuildLineState = { included: true, override: null, note: null, excludedLineItems: [payLineItemKey(kLine.sources[0], 0)] };
  eq(sourceIncludedBilled(kLine.sources[0], onlyCredit), -70, "credit-only basis stays raw per source (negative)");
  eq(payoutAfterExclusions(kLine, onlyCredit), 0, "…and the LINE clamps the payout at $0 (never negative)");
  // Opt IN an auto-excluded line: give Nelson's MT invoice a hand-inclusion…
  // (MT invoice creates no source, so opt-in applies to lines on eligible invoices —
  // exercise via a synthetic classified source with an excluded JYF line.)
  const mixed: import("../lib/pay.js").PayLineSource = {
    invoiceId: 700,
    invoiceNumber: "700",
    serviceDate: "2026-04-10",
    serviceMonth: "2026-04",
    invoiceDay: 10,
    slice: "this-month",
    billed: 600,
    eligibleBilled: 425,
    collected: 600,
    elapsedFraction: 1 / 3,
    recognized: 425 * (2 / 3),
    tier: "4x",
    payments: [],
    lineItems: [
      { item: MN4(), amount: 425, status: "included" },
      { item: "JYF Supervised Progress ($175)", amount: 175, status: "excluded" },
    ],
  };
  const mixedLine = { payout: round2(round2(425 * (2 / 3)) * 0.6), splitPct: 0.6, sources: [mixed] };
  const optIn: BuildLineState = { included: true, override: null, note: null, includedLineItems: [payLineItemKey(mixed, 1)] };
  eq(lineItemCounts(mixed, 1, DEFAULT_LINE_STATE), false, "auto-excluded line doesn't count by default");
  eq(lineItemCounts(mixed, 1, optIn), true, "…until the reviewer opts it in");
  eq(sourceIncludedBilled(mixed, optIn), 600, "opt-in raises the basis to 600");
  eq(payoutAfterExclusions(mixedLine, optIn), round2(round2(600 * (2 / 3)) * 0.6), "payout recomputes with the opt-in");
  eq(isDefaultLineState({ included: true, override: null, note: null, includedLineItems: ["x"] }), false, "an opt-in persists (not default)");
  eq(includedLineItemSet(optIn).has(payLineItemKey(mixed, 1)), true, "includedLineItemSet reads the state");
  // CSV: partial flag + tags for the mixed invoice.
  const mixedRows = payoutDetailCsvRows(
    [{ clientId: 9, clientName: "Mixed", tier: "4x", splitPct: 0.6, payout: mixedLine.payout, sources: [mixed] }],
    new Map()
  );
  const mcols = PAYOUT_DETAIL_CSV_COLUMNS;
  const mget = (row: (string | number)[], label: string) => row[mcols.indexOf(label as (typeof mcols)[number])];
  eq(mget(mixedRows[0], "Invoice incl."), "partial", "auto-partial invoice (excluded JYF line) reads 'partial'");
  eq(String(mget(mixedRows[0], "Line items")).includes("[not in pay]"), true, "auto-excluded line tagged in CSV");
  const kRows = payoutDetailCsvRows(
    [{ clientId: 5, clientName: "Kendrick", tier: "4x", splitPct: 0.6, payout: kLine.payout, sources: kLine.sources }],
    new Map()
  );
  eq(String(mget(kRows[0], "Line items")).includes("[credit]"), true, "counted credit line tagged [credit] in CSV");
}

console.log("[13d] pay stub model (mentor-facing dispositions + totals)");
{
  const src = (over: Partial<import("../lib/pay.js").PayLineSource>): import("../lib/pay.js").PayLineSource => {
    const base = {
      invoiceId: 4147,
      invoiceNumber: "4147",
      serviceDate: "2026-06-10",
      serviceMonth: "2026-06",
      invoiceDay: 10,
      slice: "this-month" as const,
      billed: 425,
      collected: 425,
      elapsedFraction: 1 / 3,
      recognized: 425 * (2 / 3),
      tier: "4x",
      payments: [],
      lineItems: [{ item: "MN Subscription | (4x Month) Zoom Meetings (Harry Shenk) ($425)", amount: 425, status: "included" as const }],
      ...over,
    };
    return { ...base, eligibleBilled: over.eligibleBilled ?? base.billed };
  };
  // Josh-style: MN charge + a refund credit the engine auto-includes (reduces),
  // which the REVIEWER kicks out — the stub must say "does NOT reduce your pay".
  const joshSrc = src({
    invoiceId: 900,
    invoiceNumber: "900",
    billed: 250,
    eligibleBilled: 250,
    recognized: 250 * (2 / 3),
    lineItems: [
      { item: "MN Subscription | (4x Month) Zoom Meetings (Harry Shenk) ($425)", amount: 425, status: "included" },
      { item: "Credit for previous payment", amount: -175, status: "credit" },
    ],
  });
  const mkLine = (over: Partial<import("../lib/pay.js").PayMenteeLine>): import("../lib/pay.js").PayMenteeLine => ({
    clientId: 1,
    clientName: "Josh Lehman",
    coachId: 900,
    billed: 250,
    collected: 250,
    invoiceDay: 10,
    recognizedThis: round2(250 * (2 / 3)),
    rolloverPrev: 0,
    earned: round2(250 * (2 / 3)),
    splitPct: 0.6,
    payout: round2(round2(250 * (2 / 3)) * 0.6),
    tier: "4x",
    sources: [joshSrc],
    ...over,
  });
  const josh = mkLine({});
  const plain = mkLine({ clientId: 2, clientName: "Myles Miller", sources: [src({ invoiceId: 4135, invoiceNumber: "4135" })], billed: 425, earned: round2(425 * (2 / 3)), recognizedThis: round2(425 * (2 / 3)), payout: round2(round2(425 * (2 / 3)) * 0.6) });
  const creditOut: BuildLineState = { included: true, override: null, note: "refund shouldn't hit Harry", excludedLineItems: [payLineItemKey(joshSrc, 1)] };
  const model = buildPayStubModel({
    coachName: "Harry Shenk",
    ym: "2026-06",
    splitPct: 0.6,
    status: "draft",
    lines: [josh, plain],
    states: new Map([[1, creditOut]]),
    monthNote: "June payout",
    generatedOn: "2026-07-17",
  });
  eq(model.approved, false, "draft build -> review copy");
  eq(model.monthLabel, "June 2026", "long month label");
  const jr = model.rows.find((r) => r.name === "Josh Lehman")!;
  eq(jr.invoices[0].items[1].disposition, "credit-out", "reviewer-excluded credit reads credit-out (does NOT reduce pay)");
  eq(jr.invoices[0].items[0].disposition, "counted", "MN line reads counted");
  eq(jr.invoices[0].counts, 425, "invoice counts $425 once the credit is kicked out");
  eq(jr.earned, round2(425 * (2 / 3)), "earned recomputed from the surviving basis");
  eq(jr.payout, round2(round2(425 * (2 / 3)) * 0.6), "payout follows the review");
  eq(jr.adjusted, true, "credit-out marks the line adjusted/reviewed");
  const mr = model.rows.find((r) => r.name === "Myles Miller")!;
  eq(mr.adjusted, false, "untouched line is not flagged");
  eq(model.totals.payout, round2(jr.payout + mr.payout), "stub total = Σ effective payouts");
  eq(model.totals.delta, round2(model.totals.payout - model.totals.enginePayout), "delta = effective − engine");
  eq(model.totals.adjustedCount, 1, "one adjusted line counted");
  // credit COUNTED (default) reads credit-counted; excluded line-level states.
  const model2 = buildPayStubModel({
    coachName: "Harry Shenk", ym: "2026-06", splitPct: 0.6, status: "approved",
    lines: [josh, plain],
    states: new Map([[2, { included: false, override: null, note: "no-show month" }]]),
    generatedOn: "2026-07-17",
  });
  eq(model2.approved, true, "approved build -> final stub");
  eq(model2.rows.find((r) => r.name === "Josh Lehman")!.invoices[0].items[1].disposition, "credit-counted", "default credit reads credit-counted");
  const mx = model2.rows.find((r) => r.name === "Myles Miller")!;
  eq(mx.excluded, true, "line-level exclusion surfaces");
  eq(mx.payout, 0, "excluded line pays 0 on the stub");
  eq(model2.totals.menteeCount, 1, "excluded mentee not counted");
  // HTML smoke: renders, carries the key transparency string + watermark rules.
  const html = payStubHtml(model);
  eq(html.includes("does NOT reduce your pay"), true, "stub HTML carries the credit-out explanation");
  eq(html.includes("REVIEW COPY"), true, "draft stub is watermarked/badged");
  eq(payStubHtml(model2).includes("APPROVED PAY STUB"), true, "approved stub badged");
  eq(html.includes("<script"), false, "no scripts in the stub document");
}

console.log("[13e] adversarial-review regressions (empty line items, refunds, tier stability, canceled attribution)");
{
  const TPL_4X = "MN Subscription | (4x Month) Zoom Meetings";
  const cfg = parsePayGroupsConfig(
    JSON.stringify({ groups: [{ id: "mentors", name: "Mentors", templateNames: [TPL_4X], coachIds: [] }] })
  );
  const liPred = lineItemEligibleForGroup(cfg, MENTORS_GROUP_ID)!;
  const MN = "MN Subscription | (4x Month) Zoom Meetings (Harry Shenk) ($425)";
  const inv = (clientId: number, serviceDate: string, billed: number, items: { item: string; amount: number }[], id: number): PayInvoiceInput =>
    ({ clientId, serviceDate, billed, collected: billed, invoiceId: id, invoiceNumber: String(id), lineItems: items });
  const baseIn = {
    coachName: () => "Harry",
    clientName: (id: number) => `C${id}`,
    payEligible: payEligibleForGroup(cfg, MENTORS_GROUP_ID)!,
    payEligibleLineItem: liPred,
  };
  const engLive: PayEngagementInput[] = [
    { clientId: 1, coachId: 900, startDate: "2024-01-01", endDate: null, isCanceled: false, name: TPL_4X },
  ];

  // (1) EMPTY line items in liMode -> legacy per-invoice fallback (engagement-
  //     gated, full billed basis) instead of silently dropping real revenue.
  const rEmpty = computePayReport({
    ym: "2026-04", ...baseIn, engagements: engLive,
    invoices: [inv(1, "2026-04-10", 425, [], 1)],
    primaryCoachOf: () => 900,
  });
  const eLine = rEmpty.mentors[0]?.lines[0];
  eq(eLine?.billed ?? 0, 425, "no-line-items invoice still pays via the legacy fallback");
  eq(rEmpty.excludedBilled, 0, "…and is NOT dumped into excludedBilled");
  // Without engagement coverage it stays excluded (auditable), as legacy did.
  const rEmptyNoCov = computePayReport({
    ym: "2026-04", ...baseIn, engagements: [],
    invoices: [inv(1, "2026-04-10", 425, [], 1)],
    primaryCoachOf: () => 900,
  });
  eq(rEmptyNoCov.excludedBilled, 425, "no-line-items + no coverage -> excludedBilled (unchanged from legacy)");

  // (2) A matched REFUND invoice nets against the month; the line clamps at $0.
  //     Charge +425 day 10 (recognizes 283.33) + refund −425 day 20 (recognizes
  //     −141.67 this month, −283.33 next) -> April earned 141.67, payout 85;
  //     May earned = 283.33 rollover − 283.33 refund rollover = 0, payout 0.
  const refundInvs = [
    inv(1, "2026-04-10", 425, [{ item: MN, amount: 425 }], 11),
    inv(1, "2026-04-20", -425, [{ item: MN, amount: -425 }], 12),
  ];
  const rApr = computePayReport({ ym: "2026-04", ...baseIn, engagements: engLive, invoices: refundInvs, primaryCoachOf: () => 900 });
  const rMay = computePayReport({ ym: "2026-05", ...baseIn, engagements: engLive, invoices: refundInvs, primaryCoachOf: () => 900 });
  const aprLine = rApr.mentors[0].lines[0];
  eq(aprLine.sources.length, 2, "the refund invoice EMITS a source (visible + reviewable)");
  eq(aprLine.earned, round2(425 * (2 / 3) - 425 * (1 / 3)), "April nets charge minus refund");
  const mayLine = rMay.mentors[0]?.lines[0];
  eq(mayLine?.earned ?? 0, round2(425 * (1 / 3) - 425 * (2 / 3)), "May nets negative (refund rollover exceeds charge rollover)");
  eq(mayLine?.payout ?? 0, 0, "…and pays $0, never negative");
  const life = round2((rApr.mentors[0]?.payout ?? 0) + (rMay.mentors[0]?.payout ?? 0));
  eq(life, 85, "lifetime payout = 60% x April's net recognized (no phantom $255)");

  // (3) LEGACY tier labels are stable again (first-processed wins, as before the
  //     diff); invoice-truth still relabels to the LATEST invoice's tier.
  const tierInvs = [
    inv(1, "2026-03-09", 425, [{ item: MN, amount: 425 }], 21),
    inv(1, "2026-04-09", 265, [{ item: "MN Subscription | (2x Month) Zoom Meetings (Harry Shenk) ($265)", amount: 265 }], 22),
  ];
  const tierEngs: PayEngagementInput[] = [
    { clientId: 1, coachId: 900, startDate: "2024-01-01", endDate: "2026-04-01", isCanceled: false, name: TPL_4X },
    { clientId: 1, coachId: 900, startDate: "2026-04-01", endDate: null, isCanceled: false, name: "MN Subscription | (2x Month) Zoom Meetings" },
  ];
  const legacyTier = computePayReport({
    ym: "2026-04", invoices: tierInvs, engagements: tierEngs,
    coachName: () => "Harry", clientName: (id) => `C${id}`, primaryCoachOf: () => 900,
  });
  eq(legacyTier.mentors[0].lines[0].tier, "4x", "legacy keeps the FIRST-processed tier (pre-diff behavior)");
  const cfg2 = parsePayGroupsConfig(JSON.stringify({ groups: [{ id: "mentors", name: "Mentors", templateNames: [TPL_4X, "MN Subscription | (2x Month) Zoom Meetings"], coachIds: [] }] }));
  const liTier = computePayReport({
    ym: "2026-04", invoices: tierInvs, engagements: tierEngs,
    coachName: () => "Harry", clientName: (id) => `C${id}`, primaryCoachOf: () => 900,
    payEligible: payEligibleForGroup(cfg2, MENTORS_GROUP_ID)!,
    payEligibleLineItem: lineItemEligibleForGroup(cfg2, MENTORS_GROUP_ID)!,
  });
  eq(liTier.mentors[0].lines[0].tier, "2x", "invoice-truth labels with the LATEST invoice's tier");

  // (4) liMode attribution fallback tolerates CANCELED engagements when no owner
  //     is synced (the Brett/Wynn record shape).
  const rCanc = computePayReport({
    ym: "2026-04", ...baseIn,
    engagements: [{ clientId: 1, coachId: 900, startDate: "2025-09-15", endDate: null, isCanceled: true, name: TPL_4X }],
    invoices: [inv(1, "2026-04-19", 425, [{ item: MN, amount: 425 }], 31)],
    primaryCoachOf: () => null,
  });
  eq(rCanc.mentors[0]?.coachId ?? null, 900, "no owner + canceled-but-billing engagement still credits its coach");
  eq(rCanc.unassigned.length, 0, "…instead of landing unassigned");
}

console.log("[13f] build-level Split % override (review layer + stub)");
{
  const mkSrc = (): import("../lib/pay.js").PayLineSource => ({
    invoiceId: 1, invoiceNumber: "1", serviceDate: "2026-06-10", serviceMonth: "2026-06",
    invoiceDay: 10, slice: "this-month", billed: 425, eligibleBilled: 425, collected: 425,
    elapsedFraction: 1 / 3, recognized: 425 * (2 / 3), tier: "4x", payments: [],
    lineItems: [{ item: "MN Subscription | (4x Month) Zoom Meetings (X) ($425)", amount: 425, status: "included" }],
  });
  const line = {
    clientId: 1, clientName: "A", coachId: 9, billed: 425, collected: 425, invoiceDay: 10,
    recognizedThis: round2(425 * (2 / 3)), rolloverPrev: 0, earned: round2(425 * (2 / 3)),
    splitPct: 0.6, payout: round2(round2(425 * (2 / 3)) * 0.6), tier: "4x", sources: [mkSrc()],
  } as import("../lib/pay.js").PayMenteeLine;

  eq(effectiveLineTotal(line, DEFAULT_LINE_STATE), line.payout, "no override -> engine payout");
  eq(effectiveLineTotal(line, DEFAULT_LINE_STATE, 0.5), round2(round2(425 * (2 / 3)) * 0.5), "split override reprices the line (engine earned x 50%)");
  eq(effectiveLineTotal(line, { included: true, override: 100, note: null }, 0.5), 100, "a per-line $ override still beats the split override");
  eq(effectiveLineTotal(line, { included: false, override: null, note: null }, 0.5), 0, "a line exclusion still zeroes it");
  // Split override composes with line-item flips (recompute basis, then x split).
  const drop: BuildLineState = { included: true, override: null, note: null, excludedInvoices: ["id:1"] };
  eq(payoutAfterExclusions(line, drop, 0.5), 0, "override + whole-invoice drop -> $0");
  const sm = summarizeBuild([line], new Map(), 0.5);
  eq(sm.builtTotal, round2(round2(425 * (2 / 3)) * 0.5), "builtTotal honors the split override");
  eq(sm.computedTotal, line.payout, "computedTotal stays the raw engine number");
  // CSV: Split cell discloses both; effective payout uses the override.
  const rows = payoutDetailCsvRows([line], new Map(), 0.5);
  const cc = PAYOUT_DETAIL_CSV_COLUMNS;
  const g = (row: (string | number)[], label: string) => row[cc.indexOf(label as (typeof cc)[number])];
  eq(g(rows[0], "Split"), "50% (engine 60%)", "CSV Split cell discloses the override");
  eq(g(rows[0], "Effective payout"), round2(round2(425 * (2 / 3)) * 0.5), "CSV effective payout uses the override");
  // Stub: effective rate + disclosure flag; totals reprice.
  const model = buildPayStubModel({
    coachName: "H", ym: "2026-06", splitPct: 0.6, splitOverride: 0.5, status: "approved",
    lines: [line], states: new Map(), generatedOn: "2026-07-20",
  });
  eq(model.splitPct, 0.5, "stub shows the effective rate");
  eq(model.splitAdjusted, true, "stub flags the adjustment");
  eq(model.totals.payout, round2(round2(425 * (2 / 3)) * 0.5), "stub total repriced");
  eq(payStubHtml(model).includes("set by HJG for this month"), true, "stub HTML discloses the adjusted rate");
}

console.log("[13g] hourly (timesheet) staff pay math + stub");
{
  const entries = [
    { date: "2026-07-02", label: "Admin", hours: 3.5 },
    { date: null, label: "JYF supervision", hours: 10 },
    { date: "2026-07-09", label: "", hours: 0 }, // blank editor row -> dropped
    { date: null, label: "Zero-hour noted line", hours: 0 }, // kept (has a label)
  ];
  const clean = normalizeEntries(entries);
  eq(clean.length, 3, "blank rows dropped, noted zero-hour lines kept");
  eq(hoursTotal(clean), 13.5, "hours total");
  eq(hourlyTotal(clean, 22), 297, "13.5h x $22 = $297.00");
  eq(hourlyTotal(clean, 22, 25), 322, "adjustment adds on top");
  eq(hourlyTotal(clean, 22, -47), 250, "negative adjustment subtracts");
  eq(hourlyTotal([], 22), 0, "empty sheet pays $0");
  // jsonb parse defensiveness
  eq(parseEntries('[{"date":"2026-07-02","label":"A","hours":"2.5"}]')[0].hours, 2.5, "string hours coerced");
  eq(parseEntries("garbage").length, 0, "garbage json -> empty");
  eq(parseEntries(null).length, 0, "null -> empty");
  // stub model + html
  const model = buildHourlyStubModel({
    staffName: "Dave Troyer", ym: "2026-07", rate: 22, entries,
    adjustment: 25, adjustmentNote: "July bonus", notes: "Thanks for covering the extra JYF calls.",
    status: "draft", generatedOn: "2026-07-21",
  });
  eq(model.hours, 13.5, "model hours");
  eq(model.base, 297, "model base = hours x rate");
  eq(model.total, 322, "model total includes adjustment");
  eq(model.monthLabel, "July 2026", "long month label");
  const html = hourlyStubHtml(model);
  eq(html.includes("REVIEW COPY"), true, "draft hourly stub watermarked/badged");
  eq(html.includes("July bonus"), true, "adjustment note printed");
  eq(html.includes("Dave Troyer"), true, "staff name printed");
  eq(html.includes("<script"), false, "no scripts in the stub document");
  const finalHtml = hourlyStubHtml(buildHourlyStubModel({ ...{
    staffName: "Dave Troyer", ym: "2026-07", rate: 22, entries, generatedOn: "2026-07-21",
  }, status: "approved" }));
  eq(finalHtml.includes("APPROVED PAY STUB"), true, "approved hourly stub badged");
}

console.log("[13h] payment-run scheduling (default service month + month completion)");
{
  eq(prevYm("2026-07"), "2026-06", "prevYm mid-year");
  eq(prevYm("2026-01"), "2025-12", "prevYm across the year boundary");
  // The user's exact scenario: today is July 2026, nothing marked paid yet →
  // the builder opens on June.
  eq(defaultServiceMonth("2026-07", []), "2026-06", "no payments recorded → previous month (June)");
  eq(defaultServiceMonth("2026-07", ["2026-05", "2026-06"]), "2026-06", "newest paid month wins");
  eq(defaultServiceMonth("2026-07", ["2026-06", "2026-05"]), "2026-06", "order-independent");
  eq(defaultServiceMonth("2026-07", ["garbage", ""]), "2026-06", "malformed paid months ignored");
  eq(defaultServiceMonth("2026-01", []), "2025-12", "fallback handles the year boundary");

  const mm = [
    { coachId: 1, ym: "2026-06" },
    { coachId: 2, ym: "2026-06" },
    { coachId: 1, ym: "2026-06" }, // duplicate — must not double-count
    { coachId: 1, ym: "2026-05" },
    { coachId: 3, ym: "not-a-month" }, // dropped
  ];
  const paidSet = new Set(["1|2026-06", "1|2026-05"]);
  const prog = monthPayProgress(mm, (c, m) => paidSet.has(`${c}|${m}`));
  eq(prog.length, 2, "two valid months");
  eq(prog[0].ym, "2026-06", "newest month first");
  eq(prog[0].paid, 1, "June: one of two mentors paid");
  eq(prog[0].total, 2, "June: duplicate mentor-month deduped");
  eq(prog[0].complete, false, "June incomplete");
  eq(prog[0].unpaidCoachIds.join(","), "2", "June: coach 2 still unpaid");
  eq(prog[1].ym, "2026-05", "May second");
  eq(prog[1].complete, true, "May complete (its only mentor is paid)");
}

console.log("[25] user permissions — tab resolution (lib/permissions)");
{
  const all = APP_TAB_KEYS.length;
  eq(resolveAllowedTabs(null).size, all, "no app_users row → ALL tabs (today's behavior)");
  eq(resolveAllowedTabs(undefined).size, all, "undefined record → ALL tabs");
  eq(
    resolveAllowedTabs({ role: "admin", allowedTabs: ["metrics"], isActive: true }).size,
    all,
    "admin always sees everything, whatever the list says"
  );
  eq(
    resolveAllowedTabs({ role: "admin", allowedTabs: null, isActive: false }).size,
    all,
    "even an inactive admin keeps access (can't lock the owner out)"
  );
  const staffPick = resolveAllowedTabs({ role: "staff", allowedTabs: ["paystaff", "timeclock", "bogus"], isActive: true });
  eq(staffPick.size, 2, "explicit list is exact; unknown keys dropped");
  eq(staffPick.has("paystaff") && staffPick.has("timeclock"), true, "explicit tabs kept");
  eq(resolveAllowedTabs({ role: "staff", allowedTabs: null, isActive: true }).size, all, "staff role default = all tabs");
  eq(resolveAllowedTabs({ role: "staff", allowedTabs: [], isActive: true }).size, all, "staff empty list fails OPEN (no lockout)");
  eq(resolveAllowedTabs({ role: "mentor", allowedTabs: null, isActive: true }).size, 0, "mentor role default = nothing yet");
  eq(resolveAllowedTabs({ role: "mentor", allowedTabs: [], isActive: true }).size, 0, "mentor empty list = nothing");
  eq(
    resolveAllowedTabs({ role: "mentor", allowedTabs: ["timeclock"], isActive: true }).has("timeclock"),
    true,
    "mentor with a granted tab sees it"
  );
  eq(resolveAllowedTabs({ role: "staff", allowedTabs: ["metrics"], isActive: false }).size, 0, "inactive non-admin → no tabs");
  eq(normalizeRole("weird"), "staff", "unknown role normalizes to staff");
  eq(DEFAULT_ROLE_TABS.mentor.length, 0, "mentor default set is empty (bones)");
}

console.log("[26] Update-Mentee transition options (parse/serialize)");
{
  eq(parseTransitionOptions(null).join("|"), DEFAULT_TRANSITION_OPTIONS.join("|"), "null → seed defaults");
  eq(parseTransitionOptions("not json").join("|"), DEFAULT_TRANSITION_OPTIONS.join("|"), "garbage → seed defaults");
  eq(parseTransitionOptions("[]").join("|"), DEFAULT_TRANSITION_OPTIONS.join("|"), "empty list → seed defaults (dropdown never empty)");
  eq(parseTransitionOptions('["A"," B ","A","",42]').join("|"), "A|B|42", "trim, dedupe, drop blanks, stringify");
  eq(serializeTransitionOptions([" X ", "X", "", "Y"]), '["X","Y"]', "serialize trims + dedupes");
  const roundTrip = parseTransitionOptions(serializeTransitionOptions(DEFAULT_TRANSITION_OPTIONS));
  eq(roundTrip.join("|"), DEFAULT_TRANSITION_OPTIONS.join("|"), "round-trip stable");
  eq(DEFAULT_TRANSITION_OPTIONS[0], "Jumpstart Your Freedom", "seed order preserved (user's list)");
  eq(DEFAULT_TRANSITION_OPTIONS.length, 7, "seven seeded options");
}

console.log("[14] meetings to freedom (1-on-1 sessions JumpStart-end -> graduation)");
{
  const mentees: FreedomMenteeInput[] = [
    {
      // JumpStart end wins as window start; group + out-of-window meetings excluded;
      // graduation-day meeting counts (inclusive).
      clientId: 1,
      name: "Alice",
      graduated: true,
      graduationDate: "2026-06-30",
      jumpstartEnd: "2026-01-31",
      firstOngoingStart: "2026-02-01",
      meetings: [
        { date: "2026-01-15", isGroup: false }, // before window (JumpStart phase)
        { date: "2026-02-10", isGroup: false }, // in window
        { date: "2026-03-10", isGroup: true }, // group -> excluded
        { date: "2026-04-10", isGroup: false }, // in window
        { date: "2026-06-30", isGroup: false }, // on graduation day -> counts
        { date: "2026-07-15", isGroup: false }, // after graduation
      ],
    },
    {
      // No JumpStart end -> falls back to first ongoing-tier start.
      clientId: 2,
      name: "Bob",
      graduated: true,
      graduationDate: "2026-05-31",
      jumpstartEnd: null,
      firstOngoingStart: "2026-03-01",
      meetings: [
        { date: "2026-03-05", isGroup: false },
        { date: "2026-04-05", isGroup: false },
      ],
    },
    { clientId: 3, name: "Cara", graduated: false, graduationDate: null, jumpstartEnd: "2026-01-01", firstOngoingStart: "2026-02-01", meetings: [{ date: "2026-03-01", isGroup: false }] },
    { clientId: 4, name: "Dan", graduated: true, graduationDate: "2026-05-01", jumpstartEnd: null, firstOngoingStart: null, meetings: [] }, // no window
    { clientId: 5, name: "Eve", graduated: true, graduationDate: "2026-05-01", jumpstartEnd: "2026-06-01", firstOngoingStart: null, meetings: [] }, // window starts after graduation (anomaly)
  ];

  const rep = computeMeetingsToFreedom(mentees);
  eq(rep.n, 2, "two measurable graduated mentees (Alice, Bob)");
  eq(rep.unmeasured, 2, "Dan (no window) + Eve (start after grad) unmeasured");
  eq(rep.rows[0].name, "Alice", "rows sorted by meetings desc (Alice first)");
  eq(rep.rows[0].meetings, 3, "Alice: Feb10 + Apr10 + Jun30 (group + out-of-window excluded)");
  eq(rep.rows[0].windowStart, "2026-01-31", "Alice window starts at JumpStart end date");
  const bob = rep.rows.find((r) => r.name === "Bob")!;
  eq(bob.meetings, 2, "Bob: both ongoing meetings count");
  eq(bob.windowStart, "2026-03-01", "Bob falls back to first ongoing-tier start (no JumpStart end)");
  eq(rep.total, 5, "total sessions across measurable mentees");
  eq(rep.avg, 2.5, "avg meetings-to-freedom = 5/2");
  eq(rep.median, 2.5, "median of [2,3] = 2.5");
  eq(rep.min, 2, "min = 2");
  eq(rep.max, 3, "max = 3");

  eq(computeMeetingsToFreedom([]).n, 0, "empty input -> n 0");
  eq(computeMeetingsToFreedom([]).avg, null, "empty input -> avg null");
}

console.log("[15] JYF vs Active Mentoring cohort (open engagements by phase, distinct people)");
{
  const engs: CohortEngagementInput[] = [
    // Two distinct people in open JumpStart.
    { clientId: 1, name: "JumpStart Your Freedom", isComplete: false, isCanceled: false },
    { clientId: 2, name: "MN Subscription | (0x Month) JYF", isComplete: false, isCanceled: false },
    // Completed / canceled JumpStarts drop out (client 3 also has an open 4x -> mentoring).
    { clientId: 3, name: "JumpStart Your Freedom", isComplete: true, isCanceled: false },
    { clientId: 3, name: "MN Subscription | (4x Month) ...", isComplete: false, isCanceled: false },
    { clientId: 4, name: "JumpStart Your Freedom", isComplete: false, isCanceled: true },
    // Mentoring tiers (distinct people): 4x x2 (clients 3,5), 2x x1 (client 6), 1x x1 (client 7).
    { clientId: 5, name: "MN Subscription | (4x Month) ...", isComplete: false, isCanceled: false },
    { clientId: 6, name: "MN Subscription | (2x Month) ...", isComplete: false, isCanceled: false },
    { clientId: 7, name: "ONE appointment per month", isComplete: false, isCanceled: false },
    // A second open 4x for client 5 must NOT double-count them.
    { clientId: 5, name: "Every 4 appointments", isComplete: false, isCanceled: false },
    // Non-pipeline tiers ignored.
    { clientId: 8, name: "After Graduation Care", isComplete: false, isCanceled: false },
    { clientId: 9, name: "Mentor Training", isComplete: false, isCanceled: false },
    { clientId: 10, name: "Gain Momentum Group", isComplete: false, isCanceled: false },
  ];
  const c = computeJyfVsMentoring(engs);
  eq(c.jyf, 2, "JYF = distinct open-JumpStart people (clients 1,2; completed/canceled excluded)");
  eq(c.mentoring, 4, "Active Mentoring = distinct people across open 4x/2x/1x (clients 3,5,6,7)");
  eq(c.byTier["4x"], 2, "4x distinct people (clients 3,5; client 5's two 4x count once)");
  eq(c.byTier["2x"], 1, "2x distinct people (client 6)");
  eq(c.byTier["1x"], 1, "1x distinct people (client 7)");
  eq(c.total, 6, "total distinct people in either bucket (1,2,3,5,6,7)");

  const empty = computeJyfVsMentoring([]);
  eq(empty.jyf, 0, "empty -> jyf 0");
  eq(empty.mentoring, 0, "empty -> mentoring 0");
  eq(empty.total, 0, "empty -> total 0");
}

console.log("[16] Journeys per-stage colors (gradient interpolation + config resolution)");
{
  // Gradient endpoints are inclusive; the midpoint of 3 black->white steps is grey.
  const g3 = gradientColors("#000000", "#ffffff", 3);
  eq(g3.length, 3, "gradient(3) returns 3 colors");
  eq(g3[0], "#000000", "gradient start = from");
  eq(g3[2], "#ffffff", "gradient end = to");
  eq(g3[1], "#808080", "gradient midpoint of black->white = mid grey");

  const g6 = gradientColors("#e11d48", "#15803d");
  eq(g6.length, STAGE_COUNT, "gradient default length = 6 stages");
  eq(g6[0].toLowerCase(), "#e11d48", "6-step gradient keeps the red endpoint");
  eq(g6[5].toLowerCase(), "#15803d", "6-step gradient keeps the green endpoint");

  // Invalid endpoints fall back to defaults rather than throwing / NaN.
  eq(hexToRgb("nope"), null, "hexToRgb rejects a non-hex string");
  eq(gradientColors("nope", "#15803d").length, 6, "invalid 'from' still yields 6 colors");

  // Gradient mode ignores the explicit colors; custom mode uses them.
  const grad = resolveStageColors({ mode: "gradient", from: "#000000", to: "#ffffff", colors: ["#111111"] });
  eq(grad[0], "#000000", "gradient mode interpolates (ignores colors[])");
  const cust = resolveStageColors({ mode: "custom", from: "#000000", to: "#ffffff", colors: ["#123456", "#abcdef"] });
  eq(cust[0], "#123456", "custom mode uses colors[0]");
  eq(cust[2], DEFAULT_STAGE_COLORS[2], "custom mode fills a missing color from the default palette");

  // Defensive parsing: junk / empty -> a complete, valid default config.
  const def = parseStageColorConfig("not json");
  eq(def.colors.length, 6, "malformed JSON -> 6 default colors");
  eq(stageColorsFromRaw(null).length, 6, "null raw -> 6 default colors");
  const round = parseStageColorConfig(JSON.stringify({ mode: "gradient", from: "#aabbcc", to: "#112233", colors: [] }));
  eq(round.mode, "gradient", "round-trip preserves mode");
  eq(round.from, "#aabbcc", "round-trip preserves 'from'");
}

console.log("[17] Margins — staff-hours vs delivered-hours month merge");
{
  const delivered = new Map<string, { sessions: number; hours: number }>([
    ["2026-05", { sessions: 10, hours: 10 }],
    ["2026-04", { sessions: 6, hours: 6 }],
  ]);
  const staff = new Map<string, number>([
    ["2026-05", 4],
    ["2026-03", 8], // a month with staff hours but no delivered meetings
  ]);
  const rows = mergeProgramMonths(delivered, staff, ["2026-06"]); // current-month seed

  eq(rows.length, 4, "union of delivered + staff + extra months = 4 rows");
  eq(rows[0].month, "2026-06", "rows are newest-first (extra/current month on top)");
  const may = rows.find((r) => r.month === "2026-05")!;
  eq(may.deliveredHours, 10, "delivered hours = sessions × 1h");
  eq(may.staffHours, 4, "staff hours carried through");
  eq(may.ratio, 2.5, "ratio = delivered ÷ staff (10/4)");
  const apr = rows.find((r) => r.month === "2026-04")!;
  eq(apr.staffHours, null, "month with no staff entry -> staffHours null");
  eq(apr.ratio, null, "no staff hours -> ratio null");
  const mar = rows.find((r) => r.month === "2026-03")!;
  eq(mar.sessions, 0, "staff-only month has 0 delivered sessions");
  eq(mar.ratio, 0, "0 delivered ÷ 8 staff = 0 ratio");
  const jun = rows.find((r) => r.month === "2026-06")!;
  eq(jun.deliveredHours, 0, "seeded current month has 0 delivered");
  eq(jun.staffHours, null, "seeded current month has no staff hours yet");

  // meetingHours: real duration from CA datetime strings; null -> caller falls back.
  eq(meetingHours("2026-01-31 09:00:00", "2026-01-31 10:00:00"), 1, "1h meeting");
  eq(meetingHours("2026-01-31 09:00:00", "2026-01-31 09:30:00"), 0.5, "30-min meeting = 0.5h");
  eq(meetingHours("2026-01-31 09:00:00", null), null, "missing end -> null (fall back)");
  eq(meetingHours(null, "2026-01-31 10:00:00"), null, "missing start -> null");
  eq(meetingHours("2026-01-31 10:00:00", "2026-01-31 09:00:00"), null, "end before start -> null");
  eq(meetingHours("2026-01-31 09:00:00", "2026-01-31 11:30:00"), 2.5, "2.5h meeting");
}

console.log("[18] Conversion-rate trend window (parse + rolling trailing rate)");
{
  // Parse / serialize / label.
  eq(parseTrendWindow(null).n, DEFAULT_TREND_WINDOW.n, "null -> default n");
  eq(parseTrendWindow(null).unit, DEFAULT_TREND_WINDOW.unit, "null -> default unit");
  eq(parseTrendWindow("garbage").unit, "months", "junk -> default");
  eq(parseTrendWindow('{"n":6,"unit":"weeks"}').n, 6, "parse n=6");
  eq(parseTrendWindow('{"n":6,"unit":"weeks"}').unit, "weeks", "parse unit=weeks");
  eq(parseTrendWindow('{"n":0,"unit":"months"}').n, 3, "n<1 clamps to default");
  eq(parseTrendWindow('{"n":999,"unit":"months"}').n, 60, "n clamps to 60 max");
  eq(parseTrendWindow(serializeTrendWindow({ n: 6, unit: "weeks" })).n, 6, "round-trip n");
  eq(trendWindowLabel({ n: 3, unit: "months" }), "3-month", "label months");
  eq(trendWindowLabel({ n: 6, unit: "weeks" }), "6-week", "label weeks");

  const buckets = [
    { key: "2026-01", label: "Jan" },
    { key: "2026-02", label: "Feb" },
    { key: "2026-03", label: "Mar" },
    { key: "2026-04", label: "Apr" },
  ];
  // Jan 1/2, Feb 2/2, Mar 1/4, Apr 0 calls.
  const calls: TrendCall[] = [
    { date: "2026-01-10", converted: true },
    { date: "2026-01-20", converted: false },
    { date: "2026-02-15", converted: true },
    { date: "2026-02-16", converted: true },
    { date: "2026-03-10", converted: false },
    { date: "2026-03-12", converted: false },
    { date: "2026-03-14", converted: false },
    { date: "2026-03-30", converted: true },
  ];

  // months, n=1 = each month's raw rate; Apr has no calls -> null.
  const m1 = rollingConversionTrend(calls, buckets, { n: 1, unit: "months" });
  eq(m1[0].rate, 50, "months n=1 Jan = 50");
  eq(m1[1].rate, 100, "months n=1 Feb = 100");
  eq(m1[2].rate, 25, "months n=1 Mar = 25");
  eq(m1[3].rate, null, "months n=1 Apr (no calls) = null");

  // months, n=2 trailing (this + prior bucket).
  const m2 = rollingConversionTrend(calls, buckets, { n: 2, unit: "months" });
  eq(m2[1].rate, 75, "months n=2 Feb = (1+2)/(2+2) = 75");
  eq(m2[2].rate, 50, "months n=2 Mar = (2+1)/(2+4) = 50");
  eq(m2[3].rate, 25, "months n=2 Apr = (1+0)/(4+0) = 25");

  // months, n=3 trailing.
  const m3 = rollingConversionTrend(calls, buckets, { n: 3, unit: "months" });
  eq(m3[2].rate, 50, "months n=3 Mar = (1+2+1)/(2+2+4) = 50");

  // weeks: exact trailing N*7 days ending at the bucket's month end (Mar 31).
  const w1 = rollingConversionTrend(calls, buckets, { n: 1, unit: "weeks" });
  eq(w1[2].rate, 100, "weeks n=1 Mar (only 3/30) = 100");
  const w4 = rollingConversionTrend(calls, buckets, { n: 4, unit: "weeks" });
  eq(w4[2].rate, 25, "weeks n=4 Mar (3/3..3/31: 1 of 4) = 25");
  const w8 = rollingConversionTrend(calls, buckets, { n: 8, unit: "weeks" });
  eq(w8[2].total, 6, "weeks n=8 Mar includes Feb 15-16 + all March = 6 calls");
  eq(w8[2].rate, 50, "weeks n=8 Mar = 3 of 6 = 50");
}

console.log("[19] Pipeline-timing start-date cohort compare (windowing + roll-up)");
{
  const today = "2026-06-24";
  eq(monthsAgoYmd(today, 0), "2026-06-24", "monthsAgo 0 = today");
  eq(monthsAgoYmd(today, 3), "2026-03-24", "monthsAgo 3 = Mar 24");
  eq(monthsAgoYmd(today, 6), "2025-12-24", "monthsAgo 6 = prev-year Dec 24");

  // Cohort A = started 0–3 months ago (Mar 24 .. Jun 24 inclusive).
  const winA = { fromMonths: 0, toMonths: 3 };
  assert(inStartWindow("2026-05-01", winA, today), "A: May 1 in 0–3");
  assert(inStartWindow("2026-06-24", winA, today), "A: today edge inclusive");
  assert(inStartWindow("2026-03-24", winA, today), "A: far edge inclusive");
  assert(!inStartWindow("2026-02-01", winA, today), "A: Feb 1 out of 0–3");
  assert(!inStartWindow(null, winA, today), "A: null start never in window");
  // Order-insensitive (from/to swapped is the same band).
  assert(inStartWindow("2026-05-01", { fromMonths: 3, toMonths: 0 }, today), "A: swapped edges same band");

  // Cohort B = 4–6 months ago (Dec 24 .. Feb 24).
  const winB = { fromMonths: 4, toMonths: 6 };
  assert(inStartWindow("2026-01-15", winB, today), "B: Jan 15 in 4–6");
  assert(!inStartWindow("2026-05-01", winB, today), "B: May 1 out of 4–6");

  eq(startWindowLabel(winA), "0–3 mo ago", "label A");

  const base: CohortJourneyInput = {
    startDate: "2026-05-01", daysInSystem: 100, resolvedStatus: "active", currentTier: "4x", excluded: false, inSourceOfTruth: true,
  };
  const cohort: CohortJourneyInput[] = [
    { ...base, resolvedStatus: "active", currentTier: "jumpstart", daysInSystem: 10 },
    { ...base, resolvedStatus: "graduated", currentTier: "graduated", daysInSystem: 200 },
    { ...base, resolvedStatus: "active", currentTier: "4x", daysInSystem: 90 },
    { ...base, excluded: true, daysInSystem: 9999 }, // dropped (excluded)
    { ...base, inSourceOfTruth: false, daysInSystem: 9999 }, // dropped (off-roster)
    { ...base, resolvedStatus: "active", currentTier: null, daysInSystem: -5 }, // counted, but no tier + negative days skip the avg
  ];
  const s = summarizeCohort(cohort);
  eq(s.total, 4, "summarize: 4 in-scope (excluded + off-roster dropped)");
  eq(s.active, 3, "summarize: 3 active");
  eq(s.graduated, 1, "summarize: 1 graduated");
  assert(s.pctGraduated != null && Math.abs(s.pctGraduated - 0.25) < 1e-9, "summarize: 25% graduated");
  eq(s.avgDaysInSystem, 100, "summarize: avg days = (10+200+90)/3 (negative skipped)");
  eq(s.tierMix.jumpstart, 1, "tierMix jumpstart");
  eq(s.tierMix["4x"], 1, "tierMix 4x");
  eq(s.tierMix.graduated, 1, "tierMix graduated");
  eq(s.tierMix["2x"], 0, "tierMix 2x empty");
  eq(s.tierMix["1x"], 0, "tierMix 1x empty (null tier not counted)");

  const empty = summarizeCohort([]);
  eq(empty.total, 0, "empty cohort total 0");
  assert(empty.pctGraduated === null, "empty cohort pctGraduated null");
  assert(empty.avgDaysInSystem === null, "empty cohort avgDaysInSystem null");
}

console.log("[20] Mentee management — CA-layer derivation (deriveMenteeCaRecords)");
{
  const today = "2026-06-24";
  const coaches = [
    { id: 1, name: "Arthur" },
    { id: 2, name: "Caleb" },
  ];
  const clients = [
    { id: 10, name: "Grad Mentee", coachId: 1, isExcluded: false },
    { id: 11, name: "Active 4x", coachId: 2, isExcluded: false },
    { id: 12, name: "Declined", coachId: null, isExcluded: false },
    { id: 99, name: "Gain Momentum Group 1", coachId: null, isExcluded: true }, // dropped
  ];
  const engagements = [
    { id: 100, clientId: 10, name: "MN Subscription | (0x Month) JumpStart", startDate: "2025-01-01", endDate: "2025-02-01", isComplete: true, isCanceled: false },
    { id: 101, clientId: 10, name: "MN Subscription | (4x Month)", startDate: "2025-02-01", endDate: null, isComplete: true, isCanceled: false },
    { id: 102, clientId: 10, name: "After Graduation Care", startDate: "2025-12-01", endDate: null, isComplete: false, isCanceled: false },
    { id: 110, clientId: 11, name: "MN Subscription | (4x Month)", startDate: "2026-06-01", endDate: null, isComplete: false, isCanceled: false }, // open
    { id: 999, clientId: 99, name: "(4x)", startDate: "2026-01-01", endDate: null, isComplete: false, isCanceled: false }, // excluded client
  ];
  const appointments = [
    { clientId: 10, coachId: 1, engagementId: null, category: "discoveryZoom", date: "2024-12-15" },
    { clientId: 11, coachId: 2, engagementId: null, category: "discoveryPhone", date: "2026-05-01" },
    { clientId: 11, coachId: 2, engagementId: 110, category: "mentoring", date: "2026-06-05" },
    { clientId: 12, coachId: 1, engagementId: null, category: "discoveryZoom", date: "2025-01-01" }, // stale discovery only
  ];
  const purchases = [{ clientId: 11, date: "2026-05-20" }];
  const recs = deriveMenteeCaRecords({ clients, engagements, appointments, coaches, purchases, today, basis: "engagement_start" });
  eq(recs.length, 3, "3 records (excluded client dropped)");
  const byId = new Map(recs.map((r) => [r.clientId, r]));

  const g = byId.get(10)!;
  eq(g.status, "graduated", "10: graduated (after-graduation engagement)");
  eq(g.currentTier, "graduated", "10: current tier graduated");
  eq(g.ownerCoachName, "Arthur", "10: owner = primary coach Arthur");
  eq(g.ownerSource, "primary", "10: owner source primary");
  eq(g.discoveryDate, "2024-12-15", "10: discovery date");
  eq(g.jumpstartDate, "2025-01-01", "10: jumpstart date");
  eq(g.tier4xDate, "2025-02-01", "10: 4x date");
  eq(g.graduationDate, "2025-12-01", "10: graduation date");
  eq(g.jumpstartEnd, "2025-02-01", "10: jumpstart end");
  eq(g.startDate, "2024-12-15", "10: start = discovery");
  eq(g.meetingCount, 0, "10: no mentoring meetings");

  const a = byId.get(11)!;
  eq(a.status, "active", "11: active (open engagement)");
  eq(a.currentTier, "4x", "11: current tier 4x");
  eq(a.ownerCoachName, "Caleb", "11: owner Caleb");
  eq(a.tier4xDate, "2026-06-01", "11: 4x engagement start");
  eq(a.discoveryDate, "2026-05-01", "11: discovery date");
  eq(a.firstMeeting, "2026-06-05", "11: first meeting");
  eq(a.meetingCount, 1, "11: one meeting");
  eq(a.jyfPurchaseDate, "2026-05-20", "11: JYF purchase");
  eq(a.startDate, "2026-05-01", "11: start = discovery");
  assert(a.hasOpen, "11: has an open engagement");

  const d = byId.get(12)!;
  eq(d.status, "inactive", "12: inactive (stale discovery, no follow-through)");
  assert(d.currentTier === null, "12: no tier (discovery only)");
  eq(d.discoveryDate, "2025-01-01", "12: discovery date");
  eq(d.ownerSource, "none", "12: no owner (no primary, no meetings)");
  assert(d.ownerCoachName === null, "12: owner name null");
  eq(d.startDate, "2025-01-01", "12: start = discovery");
  eq(d.meetingCount, 0, "12: no meetings");

  // Upsert-row mapper carries only ca_* columns + client_id + synced timestamp.
  const row = toMenteeCaUpsertRow(g, "2026-06-24T00:00:00.000Z");
  eq(row.client_id, 10, "upsert row client_id");
  eq(row.ca_status, "graduated", "upsert row ca_status");
  eq(row.ca_graduation_date, "2025-12-01", "upsert row ca_graduation_date");
  eq(row.ca_synced_at, "2026-06-24T00:00:00.000Z", "upsert row ca_synced_at");
  assert(!("status" in row) && !("is_test" in row), "upsert row has NO hand-layer columns");
}

console.log("[21] Mentee management — effective view-model (hand ?? CA) + leg roll-up");
{
  const base = (o: Partial<MenteeRowLike>): MenteeRowLike => ({
    id: "x", client_id: 1, ca_name: null, ca_owner_coach_id: null, ca_owner_coach_name: null,
    ca_discovery_date: null, ca_jumpstart_date: null, ca_tier_4x_date: null, ca_tier_2x_date: null,
    ca_tier_1x_date: null, ca_graduation_date: null, ca_first_meeting: null, ca_last_meeting: null,
    ca_meeting_count: 0, ca_jumpstart_end: null, ca_jyf_purchase_date: null, ca_start_date: null,
    ca_status: null, ca_synced_at: null, name_override: null, status: null, status_stage: null,
    status_date: null, discovery_date_override: null, jumpstart_date_override: null,
    tier_4x_date_override: null, tier_2x_date_override: null, tier_1x_date_override: null,
    graduation_date_override: null, owner_coach_id_override: null,
    notion_name: null, notion_status: null, notion_coach: null, notion_coach_conflict: false,
    notion_email: null, notion_phone: null, notion_dc_date: null, notion_offering_signup: null,
    notion_imported_at: null, pre_waiting_date_override: null, email_override: null,
    phone_override: null, coach_override: null, is_test: false, ...o,
  });
  const today = "2026-06-24";

  // Hand layer wins over CA layer.
  const e1 = toEffectiveMentee(
    base({
      id: "a", client_id: 1, ca_name: "CA Name", ca_discovery_date: "2026-01-01", ca_jumpstart_date: "2026-01-15",
      ca_status: "active", name_override: "Hand Name", discovery_date_override: "2026-02-01",
      status: "quit", status_stage: "jumpstart", status_date: "2026-03-01",
    }),
    today
  );
  eq(e1.name, "Hand Name", "effective name = override");
  eq(e1.discoveryDate, "2026-02-01", "effective discovery = override (hand wins)");
  eq(e1.status, "quit", "hand status wins");
  eq(e1.resolvedStatus, "quit", "resolved = hand quit");
  eq(e1.statusLabel, "Quit", "status label");
  eq(e1.currentStage, "jumpstart", "current stage jumpstart");
  eq(e1.daysInSystem, 28, "days in system = override discovery -> status_date");

  // CA-only row: effective = CA values; status derives from the CA guess.
  const e2 = toEffectiveMentee(
    base({
      id: "b", client_id: 2, ca_name: "Grad", ca_discovery_date: "2025-01-01", ca_jumpstart_date: "2025-02-01",
      ca_tier_4x_date: "2025-03-01", ca_graduation_date: "2025-12-01", ca_status: "graduated", ca_owner_coach_name: "Arthur",
    }),
    today
  );
  eq(e2.discoveryDate, "2025-01-01", "CA-only discovery");
  eq(e2.graduationDate, "2025-12-01", "CA-only graduation");
  eq(e2.currentTier, "graduated", "CA-only current tier graduated");
  assert(e2.status === null, "no hand status");
  eq(e2.resolvedStatus, "graduated", "resolved graduated from CA");
  eq(e2.statusLabel, "Graduated", "label graduated");
  eq(e2.ownerCoachName, "Arthur", "owner from CA");
  eq(e2.daysInSystem, 334, "days = discovery -> graduation");

  // CA inactive + no hand status => Unclassified, sitting at discovery.
  const e3 = toEffectiveMentee(base({ id: "c", client_id: 3, ca_name: "Stale", ca_discovery_date: "2025-01-01", ca_status: "inactive" }), today);
  eq(e3.statusLabel, "Unclassified", "inactive + unclassified");
  eq(e3.currentStage, "discovery", "discovery-only stage");
  assert(e3.currentTier === null, "no tier");

  // Leg durations off effective mentees; is_test dropped.
  const m1 = base({ id: "m1", client_id: 11, ca_discovery_date: "2025-01-01", ca_jumpstart_date: "2025-01-11", ca_tier_4x_date: "2025-01-21", ca_graduation_date: "2025-02-01" });
  const m2 = base({ id: "m2", client_id: 12, ca_discovery_date: "2025-01-01", ca_jumpstart_date: "2025-01-21" });
  const mt = base({ id: "mt", client_id: 13, ca_discovery_date: "2020-01-01", ca_jumpstart_date: "2020-06-01", is_test: true });
  const legs = aggregateLegDurations([m1, m2, mt].map((r) => toEffectiveMentee(r, today)));
  const byKey = new Map(legs.map((l) => [l.key, l]));
  eq(byKey.get("dc_js")!.n, 2, "dc_js n=2 (test dropped)");
  eq(byKey.get("dc_js")!.avgDays, 15, "dc_js avg = (10+20)/2");
  eq(byKey.get("dc_js")!.medianDays, 15, "dc_js median");
  eq(byKey.get("js_4x")!.n, 1, "js_4x n=1");
  eq(byKey.get("js_4x")!.avgDays, 10, "js_4x avg");
}

console.log("[22] Mentee management — funnel + exits (computeFunnel)");
{
  const b = (o: Partial<MenteeRowLike>): MenteeRowLike => ({
    id: "x", client_id: 1, ca_name: null, ca_owner_coach_id: null, ca_owner_coach_name: null,
    ca_discovery_date: null, ca_jumpstart_date: null, ca_tier_4x_date: null, ca_tier_2x_date: null,
    ca_tier_1x_date: null, ca_graduation_date: null, ca_first_meeting: null, ca_last_meeting: null,
    ca_meeting_count: 0, ca_jumpstart_end: null, ca_jyf_purchase_date: null, ca_start_date: null,
    ca_status: null, ca_synced_at: null, name_override: null, status: null, status_stage: null,
    status_date: null, discovery_date_override: null, jumpstart_date_override: null,
    tier_4x_date_override: null, tier_2x_date_override: null, tier_1x_date_override: null,
    graduation_date_override: null, owner_coach_id_override: null,
    notion_name: null, notion_status: null, notion_coach: null, notion_coach_conflict: false,
    notion_email: null, notion_phone: null, notion_dc_date: null, notion_offering_signup: null,
    notion_imported_at: null, pre_waiting_date_override: null, email_override: null,
    phone_override: null, coach_override: null, is_test: false, ...o,
  });
  const t = "2026-06-24";
  const mentees = [
    b({ id: "A", client_id: 1, ca_discovery_date: "2026-01-01", status: "declined" }), // declined @ discovery
    b({ id: "B", client_id: 2, ca_discovery_date: "2026-01-01", ca_jumpstart_date: "2026-01-20", status: "quit" }), // quit @ jumpstart
    b({ id: "C", client_id: 3, ca_discovery_date: "2025-01-01", ca_jumpstart_date: "2025-02-01", ca_tier_4x_date: "2025-03-01", ca_graduation_date: "2025-09-01", ca_status: "graduated" }), // graduated from 4x
    b({ id: "D", client_id: 4, ca_discovery_date: "2026-02-01", ca_jumpstart_date: "2026-03-01", ca_tier_4x_date: "2026-05-01", ca_status: "active" }), // active @ 4x
    b({ id: "T", client_id: 5, ca_discovery_date: "2020-01-01", ca_jumpstart_date: "2020-02-01", is_test: true }), // dropped
  ].map((r) => toEffectiveMentee(r, t));
  const f = computeFunnel(mentees);
  eq(f.total, 4, "funnel total excludes test");
  const byStage = new Map(f.stages.map((s) => [s.stage, s]));
  eq(byStage.get("discovery")!.entered, 4, "entered discovery = 4");
  eq(byStage.get("jumpstart")!.entered, 3, "entered jumpstart = 3");
  eq(byStage.get("4x")!.entered, 2, "entered 4x = 2");
  eq(byStage.get("2x")!.entered, 0, "entered 2x = 0 (C graduated from 4x, skipped 2x)");
  eq(byStage.get("graduated")!.entered, 1, "entered graduated = 1");
  eq(byStage.get("discovery")!.exits.declined, 1, "1 declined at discovery");
  eq(byStage.get("jumpstart")!.exits.quit, 1, "1 quit at jumpstart");
  eq(byStage.get("4x")!.activeHere, 1, "1 active at 4x (D)");
  eq(byStage.get("graduated")!.activeHere, 0, "graduated not counted active");
  assert(Math.abs((byStage.get("discovery")!.conversionToNext ?? -1) - 0.75) < 1e-9, "discovery->jumpstart conversion 75%");
  assert(byStage.get("graduated")!.conversionToNext === null, "graduated has no next");
}

console.log("[23] Mentee management — Notion CSV importer (notionCsv)");
{
  // RFC4180: quoted comma, embedded newline, escaped "" quote.
  const grid = parseCsv('Name,Note\n"Doe, John","li\nne"\nJane,"say ""hi"""\n');
  eq(grid.length, 3, "parseCsv row count (header + 2)");
  eq(grid[1][0], "Doe, John", "quoted comma preserved");
  eq(grid[1][1], "li\nne", "embedded newline preserved");
  eq(grid[2][1], 'say "hi"', "escaped quote unescaped");

  // Notion page-link stripping.
  eq(stripNotionLink("Arthur Nisly (https://app.notion.com/p/Arthur-Nisly-1a4?pvs=21)"), "Arthur Nisly", "strip notion link");
  eq(stripNotionLink("Plain Name"), "Plain Name", "plain name untouched");

  // Coach reconciliation (Mentor 1 + Mentor). Notion exports render person cells
  // as `Name (https://app.notion.com/p/…)`; stripNotionLink removes that.
  const c1 = reconcileCoach("Arthur Nisly (https://app.notion.com/p/x?pvs=21)", "Arthur Nisly (https://app.notion.com/p/y?pvs=21)");
  assert(c1.value === "Arthur Nisly" && c1.conflict === false, "coach agree → no conflict");
  const c2 = reconcileCoach("Arthur Nisly (https://app.notion.com/p/a?pvs=21)", "Bill Moser (https://app.notion.com/p/b?pvs=21)");
  assert(c2.value === "Arthur Nisly" && c2.conflict === true, "coach disagree → conflict, prefer Mentor 1");
  const c3 = reconcileCoach("“None Available” (Placeholder) (https://app.notion.com/p/n?pvs=21)", "");
  assert(c3.value === null && c3.conflict === false, "none-placeholder → null coach");

  // Name normalization + date parsing.
  eq(normalizeName("  Dr.  Laverne   Miller "), "dr laverne miller", "normalize name");
  eq(parseNotionDate("April 1, 2024"), "2024-04-01", "parse 'Month D, YYYY'");
  eq(parseNotionDate("2024-04-01"), "2024-04-01", "parse ISO date");
  assert(parseNotionDate("") === null, "blank date → null");

  // End-to-end parse with the default HJG mapping.
  const csv =
    "Mentees Paired,Status,Mentor 1,Mentor,Email Address,Phone,DC Date,Offering Signup\n" +
    'Daniel Strite,Done (Graduated),Arthur Nisly (https://app.notion.com/p/x?pvs=21),Arthur Nisly (https://app.notion.com/p/y?pvs=21),d@e.com,,"April 1, 2024",Arthur Nisly (https://app.notion.com/p/z?pvs=21)\n';
  const { rows } = parseNotionCsv(csv);
  eq(rows.length, 1, "parseNotionCsv row count");
  eq(rows[0].name, "Daniel Strite", "mapped name");
  eq(rows[0].notion_status, "Done (Graduated)", "mapped status");
  eq(rows[0].notion_coach, "Arthur Nisly", "mapped+reconciled coach");
  eq(rows[0].notion_coach_conflict, false, "no coach conflict");
  eq(rows[0].notion_dc_date, "2024-04-01", "mapped dc date");

  // Match planning: 1 match → update, 0 → insert, >1 → ambiguous.
  const existing = [
    { id: "e1", clientId: 1, name: "Daniel Strite" },
    { id: "e2", clientId: 2, name: "Bryce Miller" },
    { id: "e3", clientId: null, name: "Bryce Miller" },
  ];
  const importRows: NotionImportRow[] = [
    { name: "daniel  strite", notion_status: null, notion_coach: null, notion_coach_conflict: false, notion_email: null, notion_phone: null, notion_dc_date: null, notion_offering_signup: null },
    { name: "New Prospect", notion_status: null, notion_coach: null, notion_coach_conflict: false, notion_email: null, notion_phone: null, notion_dc_date: null, notion_offering_signup: null },
    { name: "Bryce Miller", notion_status: null, notion_coach: null, notion_coach_conflict: false, notion_email: null, notion_phone: null, notion_dc_date: null, notion_offering_signup: null },
  ];
  const plan = planNotionUpsert(existing, importRows);
  eq(plan.updates.length, 1, "1 matched → update");
  eq(plan.updates[0].id, "e1", "matched the right id (normalized name)");
  eq(plan.inserts.length, 1, "1 unmatched → insert");
  eq(plan.ambiguous.length, 1, "1 homonym → ambiguous");
  eq(plan.ambiguous[0].candidateIds.length, 2, "ambiguous has 2 candidates");

  // Non-ASCII names must not collapse to "" (else they never match on re-import).
  eq(normalizeName("李明"), "李明", "non-ASCII name kept (no empty-key collapse)");
  eq(normalizeName("Søren"), "soren", "ø transliterated → soren (no token split)");
  // Dates with a trailing time / abbreviated month still parse.
  eq(parseNotionDate("April 1, 2024 9:00 AM"), "2024-04-01", "date tolerates trailing time");
  eq(parseNotionDate("Apr 1, 2024"), "2024-04-01", "abbreviated month parses");
  // Bare-CR (classic-Mac) line endings still split rows.
  {
    const g = parseCsv("a,b\rc,d");
    eq(g.length, 2, "bare-CR splits rows");
    eq(g[1][0], "c", "bare-CR row 2 starts cleanly");
  }
  // A Notion-only row (client_id NULL) is claimed by name when its CA client appears,
  // so the CA upsert merges instead of duplicating.
  {
    const ex = [
      { id: "n1", clientId: null, name: "Sam Twin" },
      { id: "c1", clientId: 7, name: "Other Person" },
    ];
    const claims = planClientIdClaims(ex, [{ clientId: 5, name: "sam  twin" }, { clientId: 7, name: "Other Person" }]);
    eq(claims.length, 1, "one client-id claim");
    eq(claims[0].id, "n1", "claim merges the Notion-only row by name");
    eq(claims[0].clientId, 5, "claim sets the CA client id");
  }
}

console.log("[24] Mentee management — new stages / exits / IMN (Notion-driven)");
{
  const b2 = (o: Partial<MenteeRowLike>): MenteeRowLike => ({
    id: "x", client_id: 1, ca_name: null, ca_owner_coach_id: null, ca_owner_coach_name: null,
    ca_discovery_date: null, ca_jumpstart_date: null, ca_tier_4x_date: null, ca_tier_2x_date: null,
    ca_tier_1x_date: null, ca_graduation_date: null, ca_first_meeting: null, ca_last_meeting: null,
    ca_meeting_count: 0, ca_jumpstart_end: null, ca_jyf_purchase_date: null, ca_start_date: null,
    ca_status: null, ca_synced_at: null, name_override: null, status: null, status_stage: null,
    status_date: null, discovery_date_override: null, jumpstart_date_override: null,
    tier_4x_date_override: null, tier_2x_date_override: null, tier_1x_date_override: null,
    graduation_date_override: null, owner_coach_id_override: null,
    notion_name: null, notion_status: null, notion_coach: null, notion_coach_conflict: false,
    notion_email: null, notion_phone: null, notion_dc_date: null, notion_offering_signup: null,
    notion_imported_at: null, pre_waiting_date_override: null, email_override: null,
    phone_override: null, coach_override: null, is_test: false, ...o,
  });
  const t = "2026-06-27";

  // Notion status drives the effective status when there's no hand classification.
  const pw = toEffectiveMentee(b2({ id: "PW", client_id: 1, notion_status: "Pre-Waiting List" }), t);
  eq(pw.effectiveStatus, "active", "Pre-Waiting List → active");
  eq(pw.mappedStage, "pre_waiting", "mapped stage pre_waiting");
  assert(reachedStage(pw, "pre_waiting") && !reachedStage(pw, "discovery"), "reached pre_waiting only");

  const coarse = toEffectiveMentee(b2({ id: "Q", client_id: 2, ca_discovery_date: "2026-01-01", ca_jumpstart_date: "2026-02-01", notion_status: "Done (Quit OR No Mentoring)" }), t);
  eq(coarse.effectiveStatus, "quit", "Done (Quit OR No Mentoring) → quit");
  assert(coarse.coarseExit === true, "coarse exit flagged for hand refinement");

  const imn = toEffectiveMentee(b2({ id: "I", client_id: 3, ca_discovery_date: "2026-01-01", notion_status: "IMN" }), t);
  eq(imn.effectiveStatus, "imn", "IMN status");

  const grad = toEffectiveMentee(b2({ id: "G", client_id: 4, ca_discovery_date: "2025-01-01", ca_jumpstart_date: "2025-02-01", ca_tier_4x_date: "2025-03-01", ca_graduation_date: "2025-09-01", notion_status: "Done (Graduated)" }), t);
  const active4x = toEffectiveMentee(b2({ id: "A4", client_id: 5, ca_discovery_date: "2026-02-01", ca_jumpstart_date: "2026-03-01", ca_tier_4x_date: "2026-05-01", notion_status: "4x Mentoring" }), t);
  const other = toEffectiveMentee(b2({ id: "O", client_id: 6, ca_discovery_date: "2026-01-01", ca_jumpstart_date: "2026-02-01", notion_status: "Done (Other)" }), t);

  const f = computeFunnel([pw, coarse, imn, grad, active4x, other]);
  eq(f.imnCount, 1, "IMN excluded from funnel, counted separately");
  eq(f.total, 5, "funnel total excludes IMN (6 - 1)");
  const byStage = new Map(f.stages.map((s) => [s.stage, s]));
  eq(byStage.get("pre_waiting")!.entered, 1, "1 entered pre_waiting (PW)");
  eq(byStage.get("graduated")!.entered, 1, "1 graduated (G)");
  eq(byStage.get("jumpstart")!.exits.quit, 1, "coarse quit attributed to jumpstart");
  eq(byStage.get("jumpstart")!.exits.declined, 1, "Done (Other) → declined at jumpstart");
  eq(byStage.get("4x")!.activeHere, 1, "active@4x (A4)");
  assert(byStage.get("pre_waiting")!.conversionToNext === null, "pre_waiting conversion is null (opt-in side stage)");

  // currentStage = furthest of date- and status-derived stage; exit lands there.
  const ahead = toEffectiveMentee(b2({ id: "AH", client_id: 9, ca_jumpstart_date: "2026-02-01", notion_status: "1x Mentoring", status: "quit" }), t);
  eq(ahead.currentStage, "1x", "currentStage = furthest (Notion 1x beats a CA jumpstart date)");
  const sAhead = new Map(computeFunnel([ahead]).stages.map((s) => [s.stage, s]));
  eq(sAhead.get("1x")!.exits.quit, 1, "exit attributed to 1x (furthest reached)");
  eq(sAhead.get("jumpstart")!.exits.quit, 0, "no phantom exit at jumpstart");
  assert(sAhead.get("1x")!.entered >= sAhead.get("1x")!.exitedHere, "entered >= exited at 1x");

  // Dateless coarse decline: exit lands at discovery AND is counted entered there.
  const dl = toEffectiveMentee(b2({ id: "DL", client_id: 10, notion_status: "Done (Other)" }), t);
  const sDl = new Map(computeFunnel([dl]).stages.map((s) => [s.stage, s]));
  eq(sDl.get("discovery")!.exits.declined, 1, "dateless decline attributed to discovery");
  eq(sDl.get("discovery")!.entered, 1, "...and counted entered there (entered >= exited)");

  // An exit never lands on the graduated stage, even with a graduation date.
  const ge = toEffectiveMentee(
    b2({ id: "GE", client_id: 11, ca_discovery_date: "2025-01-01", ca_jumpstart_date: "2025-02-01", ca_tier_4x_date: "2025-03-01", ca_graduation_date: "2025-09-01", status: "quit" }),
    t
  );
  const sGe = new Map(computeFunnel([ge]).stages.map((s) => [s.stage, s]));
  eq(sGe.get("graduated")!.exitedHere, 0, "no exit attributed to graduated");
  eq(sGe.get("4x")!.exits.quit, 1, "exit capped to furthest non-grad stage (4x)");
}

console.log("");
if (failures === 0) {
  console.log("All checks passed.");
} else {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
