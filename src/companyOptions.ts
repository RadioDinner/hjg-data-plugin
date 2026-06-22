// Registry of org-wide "Company options" — the single source of truth for the
// Company options tab. Each entry renders as a labelled dropdown (grouped by
// `section`) and is persisted in app_settings (jsonb) under `key`. Add a new
// option here + seed its key in a migration (app_settings has no staff INSERT
// policy) and it shows up on the tab automatically.

export interface CompanyOptionChoice {
  value: string;
  label: string;
}

export interface CompanyOption {
  key: string; // app_settings key
  section: string; // dashboard section this option belongs to
  label: string;
  help: string;
  default: string;
  choices: CompanyOptionChoice[];
}

export const COMPANY_OPTIONS: CompanyOption[] = [
  {
    key: "journeys_stage_basis",
    section: "Journeys",
    label: "Pipeline stage dates",
    help:
      "How each pipeline stage (JumpStart → 4x → 2x → 1x → Graduation) is dated. " +
      "“Engagement start date” uses the CoachAccountable engagement's start date. " +
      "“First 1-on-1 meeting” uses the first individual mentoring meeting under that " +
      "engagement (group sessions excluded), falling back to the engagement start " +
      "when there's no meeting yet. Affects the stage rail and the pipeline-leg timing.",
    default: "engagement_start",
    choices: [
      { value: "engagement_start", label: "Engagement start date" },
      { value: "first_meeting", label: "First 1-on-1 meeting" },
    ],
  },
];

// The configured default for an option key (used until a stored value loads / if
// a key is missing).
export function companyOptionDefault(key: string): string {
  return COMPANY_OPTIONS.find((o) => o.key === key)?.default ?? "";
}
