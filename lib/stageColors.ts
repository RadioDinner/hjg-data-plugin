// Pure color logic for the Journeys per-stage color coding (src/views/JourneysView.tsx)
// and its Company-options editor (src/views/CompanyOptionsView.tsx).
//
// Six pipeline stages get their own color: Discovery → JumpStart (JYF) → 4x → 2x
// → 1x → Graduation. The org picks colors two ways:
//   - "gradient": choose two endpoint colors; the 6 stage colors are a linear
//     interpolation between them (e.g. bright red → dark green).
//   - "custom":   set each of the 6 stage colors individually.
//
// The config is stored as a JSON string in app_settings (key
// `journeys_stage_colors`) so it rides the existing string-valued Company-options
// plumbing. resolveStageColors() turns a (possibly partial / malformed) config
// into a guaranteed 6-color array in stage order.
//
// No I/O, no React — unit-tested in scripts/verify-metrics.ts §16.

// Stage order is fixed (Discovery first, Graduation last). Mirrors the stage rail.
export const STAGE_KEYS = ["discovery", "jumpstart", "4x", "2x", "1x", "graduated"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_COUNT = STAGE_KEYS.length;

export const STAGE_LABELS: Record<StageKey, string> = {
  discovery: "Discovery",
  jumpstart: "JumpStart (JYF)",
  "4x": "4x mentoring",
  "2x": "2x mentoring",
  "1x": "1x mentoring",
  graduated: "Graduation",
};

export type StageColorMode = "gradient" | "custom";

export interface StageColorConfig {
  mode: StageColorMode;
  from: string; // gradient start (hex) — used when mode === "gradient"
  to: string; // gradient end (hex)
  colors: string[]; // explicit per-stage colors — used when mode === "custom"
}

// Default endpoints for gradient mode: bright red → dark green ("the red to
// green system" the user asked for).
export const DEFAULT_GRADIENT_FROM = "#e11d48"; // rose-600
export const DEFAULT_GRADIENT_TO = "#15803d"; // green-700

// A curated red → green palette (red, orange, yellow, lime, green, dark-green) —
// reads cleanly out of the box; the gradient mode is there for a pure two-color
// blend. This is the seeded default (custom mode).
export const DEFAULT_STAGE_COLORS: string[] = ["#e11d48", "#f97316", "#eab308", "#84cc16", "#22c55e", "#15803d"];

export const DEFAULT_STAGE_COLOR_CONFIG: StageColorConfig = {
  mode: "custom",
  from: DEFAULT_GRADIENT_FROM,
  to: DEFAULT_GRADIENT_TO,
  colors: DEFAULT_STAGE_COLORS,
};

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

// Parse a #rrggbb hex into [r,g,b] (0–255). Returns null for anything else
// (short hex, names, malformed) so callers can fall back safely.
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec((hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clampByte(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Linear RGB interpolation from `from` to `to` in `steps` evenly-spaced colors
// (inclusive of both endpoints). Invalid endpoints fall back to the defaults so
// the result is always `steps` valid hex strings.
export function gradientColors(from: string, to: string, steps: number = STAGE_COUNT): string[] {
  const a = hexToRgb(from) ?? hexToRgb(DEFAULT_GRADIENT_FROM)!;
  const b = hexToRgb(to) ?? hexToRgb(DEFAULT_GRADIENT_TO)!;
  if (steps <= 1) return [rgbToHex(...a)];
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    out.push(rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t));
  }
  return out;
}

// Normalize one color string to a safe #rrggbb (fallback when invalid).
function safeHex(c: string | undefined, fallback: string): string {
  return c && HEX_RE.test(c.trim()) ? c.trim().toLowerCase() : fallback;
}

// Turn a config into exactly STAGE_COUNT colors in stage order. In gradient mode
// the colors are interpolated from the endpoints; in custom mode the explicit
// colors are used (each validated, missing ones filled from the default palette).
export function resolveStageColors(config: StageColorConfig): string[] {
  if (config.mode === "gradient") {
    return gradientColors(config.from, config.to, STAGE_COUNT);
  }
  const cols = config.colors ?? [];
  return STAGE_KEYS.map((_, i) => safeHex(cols[i], DEFAULT_STAGE_COLORS[i]));
}

// Parse the stored JSON-string config defensively into a complete config.
// Anything missing or malformed falls back to the defaults, so the UI and the
// stage rail always have a usable config.
export function parseStageColorConfig(raw: string | null | undefined): StageColorConfig {
  if (!raw) return { ...DEFAULT_STAGE_COLOR_CONFIG, colors: [...DEFAULT_STAGE_COLORS] };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_STAGE_COLOR_CONFIG, colors: [...DEFAULT_STAGE_COLORS] };
  }
  const o = (obj ?? {}) as Partial<StageColorConfig>;
  const mode: StageColorMode = o.mode === "gradient" ? "gradient" : "custom";
  const from = safeHex(o.from, DEFAULT_GRADIENT_FROM);
  const to = safeHex(o.to, DEFAULT_GRADIENT_TO);
  const colors = STAGE_KEYS.map((_, i) => safeHex(o.colors?.[i], DEFAULT_STAGE_COLORS[i]));
  return { mode, from, to, colors };
}

// Resolve straight from the stored JSON string to the 6 stage colors.
export function stageColorsFromRaw(raw: string | null | undefined): string[] {
  return resolveStageColors(parseStageColorConfig(raw));
}

// Serialize a config to the JSON string stored in app_settings.
export function serializeStageColorConfig(config: StageColorConfig): string {
  return JSON.stringify({ mode: config.mode, from: config.from, to: config.to, colors: config.colors });
}
