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
import { engagementTier } from "../lib/config.js";
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

console.log("");
if (failures === 0) {
  console.log("All checks passed.");
} else {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
