// Registry of org-wide "Company options" — the single source of truth for the
// Company options tab. Each entry renders (grouped by `section`) and is persisted
// in app_settings (jsonb) under `key`. Add a new option here + seed its key in a
// migration (app_settings has no staff INSERT policy) and it shows up on the tab
// automatically.
//
// Control types:
//   - "select"      (default): a labelled dropdown of `choices`.
//   - "stageColors": the Journeys per-stage color editor (gradient / custom). Its
//                    stored value is a JSON string (see lib/stageColors.ts); the
//                    registry just declares the key + a JSON-string default.
//   - "duration":   a number + unit (weeks / months) input. Its stored value is a
//                   JSON string {n, unit} (see lib/conversionTrend.ts).

import { serializeStageColorConfig, DEFAULT_STAGE_COLOR_CONFIG } from "../lib/stageColors";
import { serializeTrendWindow, DEFAULT_TREND_WINDOW } from "../lib/conversionTrend";

export interface CompanyOptionChoice {
  value: string;
  label: string;
}

export type CompanyOptionType = "select" | "stageColors" | "duration" | "action";

export interface CompanyOption {
  key: string; // app_settings key
  section: string; // dashboard section this option belongs to
  label: string;
  help: string;
  default: string;
  type?: CompanyOptionType; // defaults to "select"
  choices: CompanyOptionChoice[]; // ignored for non-select types
  disabled?: boolean; // shown but not editable (feature parked); displays the default
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
      "when there's no meeting yet. Affects the stage rail and the pipeline-leg timing. " +
      "Currently FIXED to “First 1-on-1 meeting” — editing is disabled here while this " +
      "feature is built out further.",
    default: "first_meeting",
    type: "select",
    disabled: true,
    choices: [
      { value: "engagement_start", label: "Engagement start date" },
      { value: "first_meeting", label: "First 1-on-1 meeting" },
    ],
  },
  {
    key: "journeys_recalculate_dates",
    section: "Journeys",
    label: "Recalculate journey dates",
    help:
      "Recompute every mentee's pipeline stage dates using the “Pipeline stage dates” logic " +
      "above. Use this after changing that setting — e.g. if the board decides to date stages " +
      "by engagement start instead of first 1-on-1 meeting. Enabled once the stage-date logic " +
      "toggle is re-enabled and changed.",
    default: "",
    type: "action",
    disabled: true,
    choices: [],
  },
  {
    key: "journeys_stage_colors",
    section: "Journeys",
    label: "Pipeline stage colors",
    help:
      "The color of each pipeline stage (Discovery → JumpStart → 4x → 2x → 1x → Graduation) " +
      "on a mentee's timeline. Choose “Gradient” to blend two endpoint colors across all six " +
      "stages (e.g. bright red → dark green), or “Custom” to set each stage color individually.",
    default: serializeStageColorConfig(DEFAULT_STAGE_COLOR_CONFIG),
    type: "stageColors",
    choices: [],
  },
  {
    key: "metrics_conversion_trend_window",
    section: "Metrics",
    label: "Conversion-rate trend window",
    help:
      "The trailing window the conversion-rate trend line uses on the Metrics " +
      "“Discovery calls → conversion” card. Each point shows the conversion rate over " +
      "this many weeks or months ending there, instead of that single month alone — a " +
      "longer window means a smoother trend. The card's table still lists the exact " +
      "per-month rates. Set it to whatever span your organization watches (e.g. 3 or 6 months).",
    default: serializeTrendWindow(DEFAULT_TREND_WINDOW),
    type: "duration",
    choices: [],
  },
];

// The configured default for an option key (used until a stored value loads / if
// a key is missing).
export function companyOptionDefault(key: string): string {
  return COMPANY_OPTIONS.find((o) => o.key === key)?.default ?? "";
}
