// PIECE WORK — flat per-unit pay that sits alongside (or instead of) hours and
// the CA-invoice engine. "Dave Troyer gets $25 for every new mentee; he had 8 in
// June" is one piece-work line: qty 8 × $25 = $200.
//
// Deliberately shared by BOTH pay paths, because the user needs it on both:
//   • hourly staff  — staff_pay_builds.piece_items  (lib/hourlyPay, HourlyPayView)
//   • calculated (mentor) staff — payout_builds.piece_items (lib/payBuild, BuildPayoutView)
//
// No I/O, so it's unit-tested in scripts/verify-metrics.ts §26 and safe to import
// from the browser. Persistence: migration 9964_pay_piece_work.sql.

const round2 = (n: number) => Math.round(n * 100) / 100;

// One piece-work line. `qty` and `unitRate` may both be negative (a clawback for
// a miscounted month), so the amount is signed — the same posture the hourly
// adjustment already takes.
export interface PieceEntry {
  date: string | null; // 'YYYY-MM-DD' or null (a whole-period line)
  label: string; // "New mentee onboarded"
  qty: number; // 8
  unitRate: number; // 25
}

export function emptyPiece(): PieceEntry {
  return { date: null, label: "", qty: 0, unitRate: 0 };
}

// What one line pays: quantity × rate per unit.
export function pieceAmount(p: PieceEntry): number {
  return round2((p.qty || 0) * (p.unitRate || 0));
}

// Drop rows carrying no information (no label AND nothing to pay) — blank editor
// rows — while keeping a deliberate zero-quantity noted line ("0 new mentees").
export function normalizePieces(items: PieceEntry[]): PieceEntry[] {
  return (items ?? [])
    .filter(
      (p) => (p.label ?? "").trim().length > 0 || (p.qty || 0) !== 0 || (p.unitRate || 0) !== 0,
    )
    .map((p) => ({
      date: p.date || null,
      label: (p.label ?? "").trim(),
      qty: round2(p.qty || 0),
      unitRate: round2(p.unitRate || 0),
    }));
}

// Total piece-work pay for a period. Each line rounds to the cent first, because
// each line is a real amount the staff member can check against their own count.
export function piecesTotal(items: PieceEntry[]): number {
  return round2(normalizePieces(items).reduce((t, p) => t + pieceAmount(p), 0));
}

// Total units across lines — a headline number for the editor ("8 pieces").
export function piecesQty(items: PieceEntry[]): number {
  return round2(normalizePieces(items).reduce((t, p) => t + (p.qty || 0), 0));
}

// Parse the piece_items jsonb defensively (same posture as the other jsonb
// readers: garbage collapses to safe defaults, never throws).
export function parsePieces(raw: unknown): PieceEntry[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      date: typeof o.date === "string" && o.date ? o.date.slice(0, 10) : null,
      label: o.label != null ? String(o.label) : "",
      qty: Number(o.qty) || 0,
      unitRate: Number(o.unitRate ?? o.unit_rate) || 0,
    };
  });
}
