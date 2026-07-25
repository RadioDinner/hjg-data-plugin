import { pieceAmount, piecesTotal, type PieceEntry } from "../db";
import { SectionId } from "./SectionId";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);

// PIECE WORK editor — flat per-unit pay lines ("New mentee onboarded", 8 × $25).
// Shared by BOTH pay builders, because the user needs it on both:
//   • Hourly staff (§206)  — on top of the timesheet hours
//   • Build payout (§204)  — on top of the mentor engine lines
// Purely controlled: the parent owns the array and persists it.
export function PieceWorkCard({
  items,
  onChange,
  locked,
  sectionId,
  hint,
}: {
  items: PieceEntry[];
  onChange: (next: PieceEntry[]) => void;
  locked?: boolean;
  sectionId: string;
  hint?: string;
}) {
  const total = piecesTotal(items);

  const patch = (i: number, p: Partial<PieceEntry>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            Piece work <SectionId id={sectionId} />
          </h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {hint ??
              "Flat pay per unit, on top of everything else — e.g. $25 for every new mentee. Enter how many and what each one pays."}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Piece-work total
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtUsd(total)}</div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table table--center">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Date (optional)</th>
              <th style={{ textAlign: "left" }}>Item</th>
              <th style={{ width: 90 }}>Qty</th>
              <th style={{ width: 110 }}>Rate each</th>
              <th style={{ width: 110 }}>Amount</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((p, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="cell-edit"
                    type="date"
                    value={p.date ?? ""}
                    disabled={locked}
                    onChange={(e) => patch(i, { date: e.target.value || null })}
                    aria-label={`Date for piece-work line ${i + 1}`}
                  />
                </td>
                <td style={{ textAlign: "left" }}>
                  <input
                    className="cell-edit"
                    type="text"
                    style={{ width: "100%" }}
                    placeholder="e.g. New mentee onboarded"
                    value={p.label}
                    disabled={locked}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    aria-label={`Item for piece-work line ${i + 1}`}
                  />
                </td>
                <td>
                  <input
                    className="cell-edit"
                    type="number"
                    step="1"
                    style={{ width: 70 }}
                    value={p.qty === 0 ? "" : String(p.qty)}
                    placeholder="0"
                    disabled={locked}
                    onChange={(e) => patch(i, { qty: num(e.target.value) })}
                    aria-label={`Quantity for piece-work line ${i + 1}`}
                  />
                </td>
                <td>
                  <input
                    className="cell-edit"
                    type="number"
                    step="0.01"
                    style={{ width: 90 }}
                    value={p.unitRate === 0 ? "" : String(p.unitRate)}
                    placeholder="0.00"
                    disabled={locked}
                    onChange={(e) => patch(i, { unitRate: num(e.target.value) })}
                    aria-label={`Rate each for piece-work line ${i + 1}`}
                  />
                </td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {fmtUsd(pieceAmount(p))}
                </td>
                <td>
                  <button
                    className="linkbtn"
                    disabled={locked}
                    onClick={() => onChange(items.filter((_, j) => j !== i))}
                    title="Remove this piece-work line"
                    aria-label={`Remove piece-work line ${i + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No piece-work items — add one below if any of this period's pay is per-unit.
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>
                  Piece-work total
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmtUsd(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!locked && (
        <button
          className="btn btn--sm"
          style={{ marginTop: 8 }}
          onClick={() => onChange([...items, { date: null, label: "", qty: 0, unitRate: 0 }])}
        >
          + Add piece-work item
        </button>
      )}
    </section>
  );
}
