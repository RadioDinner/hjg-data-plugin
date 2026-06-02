// HJG configuration. This is the file Derrick edits to keep categorization,
// exclusions, and budget knobs correct. Everything here is read-only policy;
// none of it calls CoachAccountable.

import type { AppointmentCategory } from "./types.js";

// --- Appointment categorization (case-insensitive substring match) ---
// Precedence: excluded -> discoveryPhone -> discoveryZoom -> mentoring -> other.
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
  "in depth mentoring session",
  "tracking together",
  "single men",
  "married men",
];

export function categorizeAppointmentName(rawName: string): AppointmentCategory {
  const name = (rawName ?? "").toLowerCase();
  if (EXCLUDE_CONTAINS.some((s) => name.includes(s))) return "excluded";
  if (DISCOVERY_PHONE_CONTAINS.some((s) => name.includes(s))) return "discoveryPhone";
  if (DISCOVERY_ZOOM_CONTAINS.some((s) => name.includes(s))) return "discoveryZoom";
  if (DISCOVERY_GENERIC_CONTAINS.some((s) => name.includes(s))) return "discoveryZoom";
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

// --- Optional mentor whitelist ---
// If non-empty, only these CoachIDs count toward activeMentors. Empty = all.
export const MENTOR_COACH_ID_WHITELIST: number[] = [];

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
};
