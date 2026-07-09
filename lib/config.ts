// HJG configuration. This is the file Derrick edits to keep categorization,
// exclusions, and budget knobs correct. Everything here is read-only policy;
// none of it calls CoachAccountable.

import type { AppointmentCategory } from "./types.js";

// --- Appointment categorization (case-insensitive substring match) ---
// Precedence: excluded -> discoveryPhone -> discoveryZoom -> group -> mentoring
// -> other.
export const EXCLUDE_CONTAINS = [
  "mentor training extra teaching",
  "get-acquainted zoom visit",
  "gain momentum group",
];

export const DISCOVERY_PHONE_CONTAINS = ["discovery call appointment (phone call)"];

export const DISCOVERY_ZOOM_CONTAINS = ["discovery call appointment (zoom)"];

// Older generic discovery bookings (no phone/zoom suffix) predate the medium
// split. They're real discovery calls — historically dropped to "other", which
// undercounted the funnel. Checked LAST (the suffixed names above win their
// medium first), defaulting the unspecified medium to zoom (the current flow).
// NOTE: categorization runs at sync time, so a re-sync is needed to reclassify
// existing rows.
export const DISCOVERY_GENERIC_CONTAINS = ["discovery call appointment"];

export const MENTORING_CONTAINS = [
  "mentoring call",
  "single men",
  "married men",
];

// --- Group mentoring sessions (multi-mentee formats) ---
// "In Depth Mentoring Session" and "Tracking Together" are GROUP formats where
// several distinct mentees attend the same slot. They're real mentoring (so they
// still count toward meetings / active-mentee metrics), but they must NOT inflate
// a mentor's 1-on-1 CAPACITY utilization — each group attendee otherwise counts
// as a mentee filling an individual slot (the "Arthur Nisly" inflation). Given
// their own category so the capacity calc can drop them while everything else
// keeps treating them as mentoring. Checked BEFORE MENTORING_CONTAINS.
// NOTE: categorization runs at sync time, so a re-sync is needed to reclassify
// existing rows before the capacity fix takes effect.
export const GROUP_SESSION_CONTAINS = [
  "in depth mentoring session",
  "tracking together",
];

export function categorizeAppointmentName(rawName: string): AppointmentCategory {
  const name = (rawName ?? "").toLowerCase();
  if (EXCLUDE_CONTAINS.some((s) => name.includes(s))) return "excluded";
  if (DISCOVERY_PHONE_CONTAINS.some((s) => name.includes(s))) return "discoveryPhone";
  if (DISCOVERY_ZOOM_CONTAINS.some((s) => name.includes(s))) return "discoveryZoom";
  if (DISCOVERY_GENERIC_CONTAINS.some((s) => name.includes(s))) return "discoveryZoom";
  if (GROUP_SESSION_CONTAINS.some((s) => name.includes(s))) return "group";
  if (MENTORING_CONTAINS.some((s) => name.includes(s))) return "mentoring";
  return "other";
}

// --- Client exclusions (cohort placeholders / group "clients", not mentees) ---
// Exact, case-insensitive match against full name, firstName, or lastName.
export const EXCLUDE_CLIENT_NAMES = [
  "Sept 2025 - Season 9",
  "2025 May Group; Season 8",
  "Gain Momentum Group 1",
  "Gain Momentum Group 2",
];

export function isExcludedClientName(
  full: string,
  first?: string,
  last?: string
): boolean {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const targets = new Set(EXCLUDE_CLIENT_NAMES.map(norm));
  return targets.has(norm(full)) || targets.has(norm(first)) || targets.has(norm(last));
}

// --- Graduation ---
// CoachAccountable has no "graduated" field; HJG's 4x->2x->1x->Graduated cadence
// is operational. Until a rule is agreed, the funnel reports graduated as null
// rather than guessing. Set GRADUATION_RULE to a function later to enable it.
export const GRADUATION_RULE: null = null;

// Budget governance now lives in lib/budget.ts, sourced from the app_settings
// table (ca_plan_daily_limit, daily_cap_pct) with env fallbacks.

// --- Discovery-call conversion (automated outcome) ---
// A discovery call auto-counts as "converted" once the prospect buys the
// SUPERVISED JumpStart Your Freedom offering. Matched by CoachAccountable
// Offering.ID (stable across renames), never by name:
//   42840 = "2. JumpStart Your Freedom (Waiting List)"  -> supervised, counts.
// The self-paced course (32326 "JumpStart Your Freedom") and the test offering
// (42841 "zTEST ...") deliberately do NOT auto-convert; staff can still set the
// outcome by hand, and a manual outcome always wins over this rule.
export const CONVERSION_OFFERING_IDS: number[] = [42840];

// With no qualifying purchase on/after the call, a discovery call stays
// "pending" until this many days have elapsed, then flips to "not_converted"
// (assumed decided-against / ghosted).
export const DISCOVERY_DECISION_WINDOW_DAYS = 30;

// --- Engagement → pipeline tier ---
// CoachAccountable Engagement names encode HJG's pipeline stage. A mentee's
// journey is JumpStart → 4x → 2x → 1x → graduated; mentor_training / group /
// other are NOT part of a mentee's pipeline.
export type EngagementTier = "jumpstart" | "4x" | "2x" | "1x" | "graduated" | "mentor_training" | "group" | "other";

// The mentee pipeline tiers, in journey order. JumpStart is the supervised
// start; "graduated" is reached via an "After Graduation Care" engagement.
export const PIPELINE_TIERS = ["jumpstart", "4x", "2x", "1x", "graduated"] as const;
export type PipelineTier = (typeof PIPELINE_TIERS)[number];

// Map an engagement name to its tier. Handles the modern
// "MN Subscription | (Nx Month) ..." naming and the legacy
// "... Every N Appointments" / "ONE|TWO appointment per month" / "WEEKLY
// appointments" conventions. Order matters: the legacy mentoring names all
// carry a "60 minute weekly Zoom call" description regardless of cadence, so the
// explicit frequency markers (one/two/twice/(1x/(2x) are checked BEFORE the 4x
// "weekly appointments" markers, and bare "weekly" is never used as a signal.
export function engagementTier(rawName: string | null | undefined): EngagementTier {
  const s = (rawName ?? "").toLowerCase();
  if (!s) return "other";
  if (s.includes("mentor training") || s.includes("mt engagement")) return "mentor_training";
  if (s.includes("after graduation")) return "graduated";
  if (s.includes("gain momentum")) return "group";
  if (s.includes("jumpstart") || s.includes("(0x") || s.includes("jyf")) return "jumpstart";
  if (s.includes("(1x") || s.includes("one appointment") || s.includes("1x month") || s.includes("1 hour per month")) return "1x";
  if (
    s.includes("(2x") ||
    s.includes("biweekly") ||
    s.includes("twice") ||
    s.includes("two appointment") ||
    s.includes("every 2 appointment") ||
    s.includes("2x month")
  )
    return "2x";
  if (s.includes("(4x") || s.includes("weekly appointment") || s.includes("every 4 appointment") || s.includes("normal monthly")) return "4x";
  return "other";
}

// --- CoachAccountable function names (centralized so they're easy to correct) ---
// Offering.getAll is confirmed in the docs. The submissions function name is
// inferred from the docs ("submissions for Offerings") and MUST be verified on
// the first real call; change it here if the live API rejects it.
export const CA_FN = {
  coachGetAll: "Coach.getAll",
  clientGetAll: "Client.getAll",
  appointmentGetAll: "Appointment.getAll",
  appointmentGetTypes: "Appointment.getTypes",
  offeringGetAll: "Offering.getAll",
  offeringGetSubmissions: "Offering.getSubmissions", // UNCONFIRMED name
  engagementGetAll: "Engagement.getAll",
  engagementGetTemplates: "Engagement.getTemplates",
  invoiceGetAll: "Invoice.getAll",
  invoiceGetPayments: "Invoice.getPayments",
};
