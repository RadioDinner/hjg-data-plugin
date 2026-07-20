// Pure "Payment groups" config — which CoachAccountable engagement templates count
// toward which group of staff for payout calculations, plus which coaches belong to
// each group. Edited in Company options (§451), stored as a JSON string in
// app_settings under `pay_engagement_groups`. No I/O, so it's unit-testable
// (scripts/verify-metrics.ts) and reusable from the browser + the pay engine.
//
// The engine gates each invoice on whether the covering engagement's TEMPLATE is
// checked for the group (matched by the engagement's name/description). A group with
// NO templates checked is treated as "not configured" — the engine falls back to its
// legacy 4x/2x/1x auto-detection, so payouts are unchanged until an admin uses the
// grid. Once templates are checked, the grid is authoritative (JumpStart/JYF, groups,
// mentor training, etc. simply stay unchecked and never count).

export interface PayGroup {
  id: string; // stable slug, e.g. "mentors"
  name: string; // display name
  templateNames: string[]; // engagement-template names checked for this group
  coachIds: number[]; // staff coach IDs assigned to this group
}

export interface PayGroupsConfig {
  groups: PayGroup[];
}

export const MENTORS_GROUP_ID = "mentors";

export const DEFAULT_PAY_GROUPS_CONFIG: PayGroupsConfig = {
  groups: [{ id: MENTORS_GROUP_ID, name: "Mentors", templateNames: [], coachIds: [] }],
};

function clone(cfg: PayGroupsConfig): PayGroupsConfig {
  return { groups: cfg.groups.map((g) => ({ ...g, templateNames: [...g.templateNames], coachIds: [...g.coachIds] })) };
}

// Normalize an engagement/template name for matching: collapse internal whitespace,
// trim, lowercase. An opened engagement carries the exact template name, but this
// stays lenient about incidental whitespace/case drift between the two.
export function normalizeTemplateName(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

// A URL/id-safe slug for a new group's name (lowercase, hyphenated). Falls back to
// "group" so an id is never empty.
export function slugifyGroupName(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

export function parsePayGroupsConfig(raw: string | null | undefined): PayGroupsConfig {
  if (!raw) return clone(DEFAULT_PAY_GROUPS_CONFIG);
  try {
    const o = JSON.parse(raw) as { groups?: unknown };
    if (!o || !Array.isArray(o.groups)) return clone(DEFAULT_PAY_GROUPS_CONFIG);
    const seen = new Set<string>();
    const groups: PayGroup[] = [];
    for (const raw of o.groups) {
      if (!raw || typeof raw !== "object") continue;
      const g = raw as Record<string, unknown>;
      const name = String(g.name ?? "").trim() || "Group";
      let id = String(g.id ?? "").trim() || slugifyGroupName(name);
      while (seen.has(id)) id = `${id}-2`; // keep ids unique
      seen.add(id);
      const templateNames = Array.isArray(g.templateNames)
        ? [...new Set(g.templateNames.map((n) => String(n)).filter((n) => n.length > 0))]
        : [];
      const coachIds = Array.isArray(g.coachIds)
        ? [...new Set(g.coachIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)))]
        : [];
      groups.push({ id, name, templateNames, coachIds });
    }
    return groups.length ? { groups } : clone(DEFAULT_PAY_GROUPS_CONFIG);
  } catch {
    return clone(DEFAULT_PAY_GROUPS_CONFIG);
  }
}

export function serializePayGroupsConfig(cfg: PayGroupsConfig): string {
  return JSON.stringify({
    groups: cfg.groups.map((g) => ({
      id: g.id,
      name: g.name,
      templateNames: g.templateNames,
      coachIds: g.coachIds,
    })),
  });
}

export function findGroup(cfg: PayGroupsConfig, groupId: string): PayGroup | null {
  return cfg.groups.find((g) => g.id === groupId) ?? null;
}

// Whether a group has an explicit template list (so it's authoritative). An empty
// list means "not configured yet" → the caller should fall back to legacy detection.
export function groupHasTemplates(cfg: PayGroupsConfig, groupId: string): boolean {
  const g = findGroup(cfg, groupId);
  return !!g && g.templateNames.length > 0;
}

// The pay-eligibility predicate for a group, built from its checked template names,
// or NULL when the group has no templates (caller falls back to legacy detection).
// Matching is by normalized engagement name (an opened engagement's name equals its
// template's name).
export function payEligibleForGroup(
  cfg: PayGroupsConfig,
  groupId: string
): ((engagementName: string | null | undefined) => boolean) | null {
  const g = findGroup(cfg, groupId);
  if (!g || g.templateNames.length === 0) return null;
  const set = new Set(g.templateNames.map(normalizeTemplateName));
  return (name) => set.has(normalizeTemplateName(name));
}

// The LINE-ITEM pay-eligibility predicate for a group, or NULL when the group has
// no templates checked (caller falls back to legacy engagement-gated detection).
//
// This is the invoice-truth gate (decided with the user 2026-07-17): an invoice
// line item counts toward the group's payouts iff its text STARTS WITH a checked
// template's name. CA writes line items as the template name plus suffixes —
// "MN Subscription | (4x Month) Zoom Meetings (Harry Shenk) ($425)" — so a prefix
// match hits every real billing row while never matching JYF fees, setup fees,
// mentor-training tuition, or free-text credits. Deliberately NOT a contains-match:
// "Credit for the JYF Fee" must not match the 0x JumpStart template, and credits in
// general stay unmatched so the reviewer decides them (see lib/pay.ts).
export function lineItemEligibleForGroup(
  cfg: PayGroupsConfig,
  groupId: string
): ((lineItemText: string | null | undefined) => boolean) | null {
  const g = findGroup(cfg, groupId);
  if (!g || g.templateNames.length === 0) return null;
  const prefixes = g.templateNames.map(normalizeTemplateName).filter((p) => p.length > 0);
  return (text) => {
    const t = normalizeTemplateName(text);
    if (!t) return false;
    return prefixes.some((p) => t.startsWith(p));
  };
}
