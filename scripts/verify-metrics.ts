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

console.log("");
if (failures === 0) {
  console.log("All checks passed.");
} else {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
