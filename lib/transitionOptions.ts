// Pure "Transition to..." option list for the Update Mentee tab's Transition
// form (§552). The list is org-editable in Company options (§451) and stored as
// a JSON string (array of option names) in app_settings under
// `mentee_transition_options` (seeded by migration 9967). No I/O — unit-tested
// in scripts/verify-metrics.ts.

export const MENTEE_TRANSITION_OPTIONS_KEY = "mentee_transition_options";

// The seed list the user specified (2026-07-22).
export const DEFAULT_TRANSITION_OPTIONS: string[] = [
  "Jumpstart Your Freedom",
  "4x Mentoring",
  "2x Mentoring",
  "1x Mentoring",
  "Graduated",
  "Quit",
  "Fired",
];

// Parse the stored JSON-string list; trims entries, drops blanks, dedupes
// (case-sensitive — options are display names), and falls back to the default
// seed on missing/garbage input so the dropdown is never empty.
export function parseTransitionOptions(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_TRANSITION_OPTIONS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_TRANSITION_OPTIONS];
    const out: string[] = [];
    for (const v of parsed) {
      const s = String(v ?? "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out.length ? out : [...DEFAULT_TRANSITION_OPTIONS];
  } catch {
    return [...DEFAULT_TRANSITION_OPTIONS];
  }
}

export function serializeTransitionOptions(options: string[]): string {
  const out: string[] = [];
  for (const v of options) {
    const s = String(v ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return JSON.stringify(out);
}
