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
  type PayInvoiceInput,
  type PayEngagementInput,
} from "../lib/pay.js";
import {
  summarizeBuild,
  effectiveLinePayout,
  isDefaultLineState,
  DEFAULT_LINE_STATE,
  type BuildLineInput,
  type BuildLineState,
} from "../lib/payBuild.js";
import { mergeProgramMonths, meetingHours } from "../lib/margins.js";
import {
  parseTrendWindow,
  serializeTrendWindow,
  trendWindowLabel,
  rollingConversionTrend,
  DEFAULT_TREND_WINDOW,
  type TrendCall,
} from "../lib/conversionTrend.js";
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
  // Ramp: month 1 = 35%, month 2 = 50%, month 3+ = 60% (by MENTOR tenure).
  eq(splitForTenureMonth(1), 0.35, "tenure month 1 -> 35%");
  eq(splitForTenureMonth(2), 0.5, "tenure month 2 -> 50%");
  eq(splitForTenureMonth(3), 0.6, "tenure month 3 -> 60%");
  eq(splitForTenureMonth(12), 0.6, "established mentor -> 60%");
  eq(tenureMonthsBetween("2026-01", "2026-03"), 3, "Jan start -> March is tenure month 3");
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

  // ---- Unassigned: billed revenue with no overlapping engagement ----
  const noEng = computePayReport({
    ym: "2026-04",
    invoices: [{ clientId: 1, serviceDate: "2026-04-12", billed: 425, collected: 425 }],
    engagements: [{ clientId: 1, coachId: 29074, startDate: "2026-09-01", endDate: null, isCanceled: false, name: "(4x)" }],
    coachName,
    clientName,
  });
  eq(noEng.mentors.length, 0, "no mentor paid when no engagement overlaps the invoice month");
  eq(noEng.unassigned.length, 1, "revenue surfaced as unassigned, not dropped");
  eq(noEng.unassigned[0].payout, 0, "unassigned pays 0");

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
}

console.log("[9] staff payment timeline + flat ledger (Clayton roll, unassigned, scoping)");
{
  const coachName = (id: number) => (id === 29074 ? "Harry Shenk" : `#${id}`);
  const clientName = (id: number) => `Mentee ${id}`;

  // Mentee 1: one invoice (Apr 10), Harry established. Mentee 2: invoice (May 5)
  // with NO overlapping engagement -> unassigned.
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

  const unassigned = tl.ledger.filter((r) => !r.assigned);
  eq(unassigned.length >= 1, true, "mentee 2 surfaced as unassigned (no engagement)");
  eq(unassigned.every((r) => r.payout === 0), true, "unassigned lines pay 0");

  // An explicit months list scopes the timeline (e.g. a single-month explore).
  const one = computePayTimeline({ invoices, engagements, coachName, clientName, months: ["2026-04"] });
  eq(one.months.length, 1, "explicit months list scopes the timeline");
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

console.log("");
if (failures === 0) {
  console.log("All checks passed.");
} else {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
