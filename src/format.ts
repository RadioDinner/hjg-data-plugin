const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function money(n: number): string {
  return usd.format(n);
}

export function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

export function num(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

// Signed integer for Δ columns: "+12", "-3", "0".
export function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r.toLocaleString("en-US")}` : r.toLocaleString("en-US");
}

// Signed percent-change for Δ% columns. null (undefined baseline) → "—".
export function signedPct(n: number | null): string {
  if (n === null) return "—";
  const r = Math.round(n);
  return r > 0 ? `+${r}%` : `${r}%`;
}

// Signed percentage-points for rate deltas (e.g. conversion rate): "+7pp".
export function signedPp(points: number): string {
  const r = Math.round(points);
  return r > 0 ? `+${r}pp` : `${r}pp`;
}

// --- Dates: display everywhere in MM-DD-YYYY (US) format ---
// Underlying values stay ISO (YYYY-MM-DD) in the DB, logic, inputs, and CSV/xlsx
// exports — these helpers only reformat for on-screen display.

const pad2 = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD" (or an ISO datetime) -> "MM-DD-YYYY". Null/empty -> "". Anything
// that isn't a leading ISO date is returned unchanged.
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[2]}-${m[3]}-${m[1]}` : s;
}

// Reformat the LEADING ISO date inside any string to MM-DD-YYYY, preserving any
// trailing time (e.g. "2026-01-31 09:00:00" -> "01-31-2026 09:00:00"). Non-string
// or non-date values pass through (null/empty -> ""). Used by generic display
// tables so date cells render US-style without per-column wiring.
export function formatMaybeDate(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v !== "string") return String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(v);
  return m ? `${m[2]}-${m[3]}-${m[1]}${m[4]}` : v;
}

// ISO timestamp -> "MM-DD-YYYY h:mm AM" (local). Null -> "—".
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const date = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${date} ${h}:${pad2(d.getMinutes())} ${ampm}`;
}
