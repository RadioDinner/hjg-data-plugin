// Central registry of stable 3-digit ids for every addressable UI section
// (screen / card / chartcard / editor / table / modal / drawer). The number is the
// source of truth — assigned ONCE here and never changed, so "fix section 104"
// always points at the same element. See UI_INDEX.md for the browsable list.
//
// RULES (append-only):
//  - Never renumber an existing key. To remove an element, retire its number
//    (leave the entry or delete it) — do NOT reuse the number for something else.
//  - Adding a section = add ONE entry here + drop a <SectionId id="key" /> in the
//    JSX. Numbers are grouped by area so ranges are mnemonic:
//      0xx Metrics · 1xx Journeys · 2xx Pay/Build · 3xx Raw data · 4xx Admin (45x
//      Company options) · 5xx Mentees · 6xx Margins · 7xx Discovery · 8xx Maps ·
//      9xx modals/drawers.
//  - Keys mirror the help-article ids where one exists (e.g. metrics.capacity).

export const UI_SECTIONS: Record<string, number> = {
  // 0xx — Metrics
  "metrics.screen": 1,
  "metrics.compare": 2,
  "metrics.conversion": 3,
  "metrics.freedom": 4,
  "metrics.jyfVsMentoring": 5,
  "metrics.meetings": 6,
  "metrics.mentees": 7,
  "metrics.mentors": 8,
  "metrics.capacity": 9,
  "metrics.resource": 10,
  "metrics.pipelineTiming": 11, // §102 leg-timing moved here in the mentee-mgmt rework
  "metrics.funnel": 12, // mentee funnel + exits, moved from Mentees → Metrics (2026-06-27)

  // 1xx — Journeys (RETIRED 2026-06-24 — the Journeys tab was removed in the mentee-
  // management rework. Numbers kept reserved per the append-only rule; do not reuse.)
  "journeys.screen": 101,
  "journeys.pipelineTiming": 102,
  "journeys.timeline": 103,
  "journeys.stageDays": 104,
  "journeys.meetings": 105,
  "journeys.menteeRecord": 106,
  "journeys.statusEditor": 107,

  // 2xx — Pay staff + Build payout
  "pay.screen": 201,
  "pay.payoutByMonth": 202,
  "build.screen": 203,
  "build.review": 204,
  "pay.reconcile": 205,
  "pay.hourly": 206, // Pay staff -> Hourly staff (timesheet pay) sub-mode (2026-07-21)
  "pay.history": 207, // Pay staff -> Pay stub history archive sub-mode (2026-07-21)

  // 3xx — Raw data
  "raw.screen": 301,

  // 4xx — Admin (45x Company options)
  "admin.screen": 400,
  "admin.sync": 401,
  "admin.manualMetrics": 402,
  "admin.capacity": 403,
  "admin.settings": 404,
  "options.screen": 451,
  "options.payGroups": 452, // Payment groups: engagement templates × staff groups (2026-07-09)

  // 5xx — Mentees (rebuilt mentee management, 2026-06-24)
  "mentees.screen": 501,
  "mentees.roster": 502,
  "mentees.detail": 503, // per-mentee detail incl. the 3-source (CA/Notion/hand) panel
  "mentees.funnel": 504, // RETIRED 2026-06-27 — funnel moved to Metrics (metrics.funnel=12). Reserved.

  // 6xx — Margins
  "margins.screen": 601,

  // 7xx — Discovery
  "discovery.screen": 701,

  // 8xx — Maps
  "maps.screen": 801,

  // 9xx — Modals & drawers
  "modal.payExplore": 901,
  "modal.explore": 902,
  "modal.marginsDrill": 903,
  "drawer.help": 904,
  "modal.payoutLineDetail": 905, // per-mentee invoice/payment drill-down on Build payout (2026-07-09)
};

// 3-digit, zero-padded string for a key (e.g. "104"); "" if the key is unknown.
export function sectionNumber(key: string): string {
  const n = UI_SECTIONS[key];
  if (n == null) {
    if (import.meta.env?.DEV) console.warn(`[uiRegistry] unknown section key: "${key}"`);
    return "";
  }
  return String(n).padStart(3, "0");
}

// Dev-only integrity check: warn on any number assigned to two keys.
if (import.meta.env?.DEV) {
  const seen = new Map<number, string>();
  for (const [key, n] of Object.entries(UI_SECTIONS)) {
    if (seen.has(n)) console.warn(`[uiRegistry] duplicate section number ${n}: "${seen.get(n)}" and "${key}"`);
    seen.set(n, key);
  }
}
