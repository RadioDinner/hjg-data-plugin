// Pure user-permissions model — the "bones" of per-user tab access (2026-07-22).
// Users are set up in Company options (§453) and stored in `app_users` (migration
// 9968), matched to the signed-in Supabase auth user by EMAIL (a hard auth-user
// link + per-mentor coach link ride along for the future "mentors log in" phase).
//
// Resolution rules (deliberately fail-open for staff so nobody locks themselves
// out while the system is bones):
//   * No app_users row for the signed-in email  -> ALL tabs (today's behavior).
//   * role 'admin'                              -> ALL tabs, always.
//   * allowed_tabs NULL                         -> the role's default set.
//   * allowed_tabs set                          -> exactly those tabs.
//   * is_active false                           -> NO tabs (except admins).
// No I/O, no React — unit-tested in scripts/verify-metrics.ts.

export type AppRole = "admin" | "staff" | "mentor";
export const APP_ROLES: AppRole[] = ["admin", "staff", "mentor"];

export interface AppTabDef {
  key: string; // App.tsx tab key — the permission unit
  label: string;
  sectionId: string; // uiRegistry section for the nav badge
}

// The canonical tab list (source of truth for App.tsx nav + the §453 checkboxes).
export const APP_TABS: AppTabDef[] = [
  { key: "metrics", label: "Metrics", sectionId: "metrics.screen" },
  { key: "discovery", label: "Discovery", sectionId: "discovery.screen" },
  { key: "mentees", label: "Mentees", sectionId: "mentees.screen" },
  { key: "update", label: "Update Mentee", sectionId: "updateMentee.screen" },
  { key: "paystaff", label: "Pay staff", sectionId: "pay.screen" },
  { key: "timeclock", label: "Time clock", sectionId: "timeclock.screen" },
  { key: "finevent", label: "Report financial event", sectionId: "finevent.screen" },
  { key: "margins", label: "Margins", sectionId: "margins.screen" },
  { key: "raw", label: "Raw data", sectionId: "raw.screen" },
  { key: "maps", label: "Maps", sectionId: "maps.screen" },
  { key: "admin", label: "Admin", sectionId: "admin.screen" },
  { key: "options", label: "Company options", sectionId: "options.screen" },
];

export const APP_TAB_KEYS: string[] = APP_TABS.map((t) => t.key);

// Role defaults, used when a user row has allowed_tabs = NULL. Mentors start with
// nothing until tabs are explicitly granted (their mentor-facing surfaces don't
// exist yet); admin/staff default to everything.
export const DEFAULT_ROLE_TABS: Record<AppRole, string[]> = {
  admin: [...APP_TAB_KEYS],
  staff: [...APP_TAB_KEYS],
  mentor: [],
};

// The subset of an `app_users` row this module reads (structural, so db.ts's
// AppUserRecord satisfies it without an import cycle).
export interface AppUserLike {
  role: string | null;
  allowedTabs: string[] | null;
  isActive: boolean;
}

export function normalizeRole(raw: string | null | undefined): AppRole {
  return raw === "admin" || raw === "mentor" ? raw : "staff";
}

// The set of tab keys the signed-in user may see. `record` is their app_users
// row, or null/undefined when none exists (=> all tabs, today's behavior).
// Unknown tab keys in a stored list are dropped; an explicit EMPTY list means
// "no tabs" for mentors but falls back to the role default for admin/staff
// (fail-open — an accidental empty save must not lock staff out).
export function resolveAllowedTabs(record: AppUserLike | null | undefined): Set<string> {
  if (!record) return new Set(APP_TAB_KEYS);
  const role = normalizeRole(record.role);
  if (role === "admin") return new Set(APP_TAB_KEYS);
  if (!record.isActive) return new Set();
  const stored = record.allowedTabs?.filter((k) => APP_TAB_KEYS.includes(k)) ?? null;
  if (stored && stored.length > 0) return new Set(stored);
  if (stored && stored.length === 0 && role === "mentor") return new Set();
  return new Set(DEFAULT_ROLE_TABS[role]);
}
