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
