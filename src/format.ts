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
