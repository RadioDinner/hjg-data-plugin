import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Site-wide light/dark theme. The active theme is written to <html data-theme>,
// which flips the CSS variable sets in styles.css; the choice is persisted and
// falls back to the OS preference on first load. Charts can't read CSS variables
// (recharts needs concrete colors), so useChartTokens() returns per-theme hexes.

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState>({ theme: "light", setTheme: () => {}, toggle: () => {} });
const STORAGE_KEY = "hjg.theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, [theme]);
  return (
    <ThemeContext.Provider
      value={{ theme, setTheme: setThemeState, toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")) }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

// --- chart colors (recharts needs concrete values, not CSS vars) ---
export interface ChartTokens {
  axis: string; // axis tick text + axis line
  grid: string; // cartesian grid lines
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  accent: string; // primary series color (matches the UI accent)
  cmp: string; // comparison / Period-B series color
}

const CHART_TOKENS: Record<Theme, ChartTokens> = {
  light: { axis: "#64748b", grid: "#e5e8ee", tooltipBg: "#ffffff", tooltipBorder: "#cbd5e1", tooltipText: "#1e293b", accent: "#2563eb", cmp: "#94a3b8" },
  dark: { axis: "#94a3b8", grid: "#1e293b", tooltipBg: "#1e293b", tooltipBorder: "#334155", tooltipText: "#e2e8f0", accent: "#38bdf8", cmp: "#cbd5e1" },
};

export function useChartTokens(): ChartTokens {
  return CHART_TOKENS[useTheme().theme];
}
