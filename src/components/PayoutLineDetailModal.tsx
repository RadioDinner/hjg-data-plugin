import {
  downloadCsv,
} from "../csv";
import {
  payoutDetailCsvRows,
  PAYOUT_DETAIL_CSV_COLUMNS,
  DEFAULT_LINE_STATE,
  effectiveLineTotal,
  payoutAfterInvoiceExclusions,
  payLineSourceKey,
  excludedInvoiceSet,
  type PayMenteeLine,
  type PayLineSource,
  type PayInvoicePayment,
  type BuildLineState,
} from "../db";
import { SectionId } from "./SectionId";
import { fmtDate } from "../format";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);
const fmtPct = (n: number) => `${Math.round((n || 0) * 100)}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m ? `${SHORT[m - 1]} ${y}` : ym;
}

// The invoices (and the dates they were paid) behind ONE mentee's payout for the
// selected month — the "data used to build the payout," opened by clicking the
// mentee's name on the Build-payout screen (204). A payout blends TWO months
// (Clayton's split): this month's invoice slice + the prior month's rolled-in
// slice. This window makes that split, and every payment date, explicit so a
// number like "$430.83 earned" is auditable to the invoice.
export function PayoutLineDetailModal({
  line,
  coachName,
  ym,
  state,
  onClose,
  onToggleInvoice,
  readOnly = false,
}: {
  line: PayMenteeLine;
  coachName: string;
  ym: string;
  state?: BuildLineState;
  onClose: () => void;
  // Toggle one invoice in/out of this mentee's payout. Absent => a read-only view
  // (no checkboxes). Called with the invoice's source-key + whether it's now excluded.
  onToggleInvoice?: (sourceKey: string, excluded: boolean) => void;
  readOnly?: boolean; // build approved/locked — show the selection but disable edits
}) {
  const s = state ?? DEFAULT_LINE_STATE;
  const excluded = excludedInvoiceSet(s);
  const isExcluded = (src: PayLineSource) => excluded.has(payLineSourceKey(src));
  const canToggle = !!onToggleInvoice && !readOnly;
  const eff = effectiveLineTotal(line, s);
  const prevYm = (() => {
    const [y, m] = ym.split("-").map(Number);
    const o = y * 12 + (m - 1) - 1;
    return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
  })();

  const thisMonth = line.sources.filter((x) => x.slice === "this-month");
  const rollover = line.sources.filter((x) => x.slice === "rollover");
  // Recognized subtotals over the SURVIVING (included) invoices — the live effect
  // of the checkboxes. adjEarned/adjPayout track the current selection; the raw
  // engine figure (line.payout) stays available as the "before" reference.
  const sumRecognizedIncl = (arr: PayLineSource[]) =>
    round2(arr.filter((x) => !isExcluded(x)).reduce((t, x) => t + x.recognized, 0));
  const adjThisMonth = sumRecognizedIncl(thisMonth);
  const adjRollover = sumRecognizedIncl(rollover);
  const adjEarned = round2(adjThisMonth + adjRollover);
  const adjPayout = payoutAfterInvoiceExclusions(line, excluded);
  const excludedCount = line.sources.filter(isExcluded).length;

  // Every payment across the contributing invoices, oldest first — the plain
  // answer to "when did he pay?".
  const allPayments = line.sources
    .flatMap((src) =>
      src.payments.map((p) => ({ ...p, invoiceNumber: src.invoiceNumber, serviceDate: src.serviceDate }))
    )
    .sort((a, b) => String(a.datePaid ?? "").localeCompare(String(b.datePaid ?? "")));
  const totalPaid = round2(allPayments.reduce((t, p) => t + (p.amount || 0), 0));

  function exportCsv() {
    const rows = payoutDetailCsvRows([line], new Map([[line.clientId, s]]));
    downloadCsv(
      `payout-detail-${coachName.replace(/\s+/g, "-").toLowerCase()}-${line.clientName.replace(/\s+/g, "-").toLowerCase()}-${ym}`,
      [...PAYOUT_DETAIL_CSV_COLUMNS],
      rows
    );
  }

  const paymentsCell = (payments: PayInvoicePayment[]) => {
    if (!payments.length) return <span className="muted">no payment recorded</span>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {payments.map((p, i) => (
          <span key={i} style={{ fontSize: 12, whiteSpace: "nowrap" }}>
            <strong>{p.datePaid ? fmtDate(p.datePaid) : "—"}</strong> · {fmtUsd(p.amount)}
            {p.method ? ` · ${p.method}` : ""}
            {p.checkNumber ? ` #${p.checkNumber}` : ""}
          </span>
        ))}
      </div>
    );
  };

  const itemsCell = (src: PayLineSource) =>
    src.lineItems.length ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {src.lineItems.map((li, i) => (
          <span key={i} style={{ fontSize: 12 }}>
            {li.item ?? "—"} ({fmtUsd(li.amount)})
          </span>
        ))}
      </div>
    ) : (
      <span className="muted">—</span>
    );

  const sliceRows = (arr: PayLineSource[], label: string) => {
    if (!arr.length) return null;
    const inclSubtotal = round2(arr.filter((x) => !isExcluded(x)).reduce((t, x) => t + x.recognized, 0));
    const droppedHere = arr.filter(isExcluded).length;
    return (
      <>
        {arr.map((src, i) => {
          const off = isExcluded(src);
          const key = payLineSourceKey(src);
          return (
            <tr key={`${label}-${i}`} className={off ? "builder__row--excluded" : ""}>
              <td>
                {onToggleInvoice ? (
                  <input
                    type="checkbox"
                    checked={!off}
                    disabled={!canToggle}
                    onChange={(e) => onToggleInvoice(key, !e.target.checked)}
                    aria-label={`Include invoice ${src.invoiceNumber ?? src.serviceDate} in the payout`}
                    title={off ? "Excluded — check to count this invoice" : "Included — uncheck to drop this invoice"}
                  />
                ) : (
                  <span className="muted">{off ? "✕" : "✓"}</span>
                )}
              </td>
              <td>
                <span className={`pill ${src.slice === "this-month" ? "pill--success" : "pill--running"}`}>
                  {src.slice === "this-month" ? "this month" : "rolled in"}
                </span>
              </td>
              <td>{fmtDate(src.serviceDate)}</td>
              <td className="num">{src.invoiceDay}</td>
              <td>{src.invoiceNumber ?? "—"}</td>
              <td>{src.tier}</td>
              <td className="num">{fmtUsd(src.billed)}</td>
              <td className="num">{fmtUsd(src.collected)}</td>
              <td className="num" title={`elapsed ${Math.round(src.elapsedFraction * 30)}/30`}>{fmtPct(src.elapsedFraction)}</td>
              <td
                className="num"
                style={{ fontWeight: 600, textDecoration: off ? "line-through" : undefined, color: off ? "var(--muted)" : undefined }}
                title={src.slice === "this-month" ? "billed × (1 − e)" : "billed × e (rolled forward)"}
              >
                {fmtUsd(round2(src.recognized))}
              </td>
              <td style={{ textAlign: "left" }}>{paymentsCell(src.payments)}</td>
              <td style={{ textAlign: "left" }}>{itemsCell(src)}</td>
            </tr>
          );
        })}
        <tr className="row--muted">
          <td colSpan={9} style={{ textAlign: "right", fontWeight: 600 }}>
            {label} subtotal{droppedHere ? ` · ${droppedHere} dropped` : ""}
          </td>
          <td className="num" style={{ fontWeight: 700 }}>{fmtUsd(inclSubtotal)}</td>
          <td colSpan={2} />
        </tr>
      </>
    );
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2>
              {line.clientName} — invoices behind {monthLabel(ym)} <SectionId id="modal.payoutLineDetail" />
            </h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {coachName} · {line.tier} · every invoice (and payment date) whose two-month slice built this payout.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--sm" onClick={exportCsv} title="Download this mentee's invoice detail as CSV">
              Export CSV
            </button>
            <button className="btn btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="modal__body">
          {/* The earned → payout math, spelled out */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "baseline",
              padding: "10px 12px",
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            <span title={`recognized from ${monthLabel(ym)}'s own invoice(s)`}>
              This-month slice <strong>{fmtUsd(adjThisMonth)}</strong>
            </span>
            <span style={{ color: "var(--muted)" }}>+</span>
            <span title={`rolled forward from ${monthLabel(prevYm)}'s invoice(s)`}>
              Rolled-in from {monthLabel(prevYm)} <strong>{fmtUsd(adjRollover)}</strong>
            </span>
            <span style={{ color: "var(--muted)" }}>=</span>
            <span>
              Earned <strong>{fmtUsd(adjEarned)}</strong>
            </span>
            <span style={{ color: "var(--muted)" }}>× {fmtPct(line.splitPct)} =</span>
            <span>
              Payout <strong>{fmtUsd(adjPayout)}</strong>
            </span>
            {excludedCount > 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                (engine {fmtUsd(line.payout)} before {excludedCount} excluded invoice{excludedCount === 1 ? "" : "s"})
              </span>
            )}
            {eff !== adjPayout && (
              <span style={{ color: "var(--accent)" }}>
                Effective <strong>{fmtUsd(eff)}</strong>
                {!s.included ? " (line excluded)" : s.override != null ? " (manual override)" : ""}
              </span>
            )}
          </div>

          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
            Under the two-month split, each invoice pays its <em>remaining</em> fraction in its own month and rolls its{" "}
            <em>elapsed</em> fraction (invoice day ÷ 30) into the next. So {monthLabel(ym)}'s payout blends{" "}
            {monthLabel(ym)}'s new invoice slice with {monthLabel(prevYm)}'s rolled-in slice — which is why the earned
            amount can differ from a single month's billed total.
            {canToggle ? (
              <>
                {" "}
                <strong>Uncheck an invoice</strong> to drop it from this payout — e.g. a JumpStart/JYF charge that
                shouldn't count toward mentor pay. The earned and payout recompute live and save with the build.
              </>
            ) : onToggleInvoice ? (
              <> This build is approved — reopen it to change which invoices are included.</>
            ) : null}
            {s.note ? <> Review note: <strong>{s.note}</strong>.</> : null}
          </p>

          <div className="table-scroll">
            <table className="table table--center">
              <thead>
                <tr>
                  <th style={{ width: 40 }} title="Include this invoice in the payout?">Incl.</th>
                  <th>Slice</th>
                  <th>Invoice date</th>
                  <th>Day</th>
                  <th>Invoice #</th>
                  <th>Tier</th>
                  <th>Billed</th>
                  <th>Collected</th>
                  <th>Elapsed</th>
                  <th>Into {monthLabel(ym)}</th>
                  <th style={{ textAlign: "left" }}>Payments (date · amount · method)</th>
                  <th style={{ textAlign: "left" }}>Line items</th>
                </tr>
              </thead>
              <tbody>
                {sliceRows(rollover, `Rolled in from ${monthLabel(prevYm)}`)}
                {sliceRows(thisMonth, `This month (${monthLabel(ym)})`)}
                {line.sources.length === 0 && (
                  <tr>
                    <td colSpan={12} className="muted">
                      No invoice detail is attached to this line (it may predate the invoice sync that captures payment
                      dates). Re-sync to populate it.
                    </td>
                  </tr>
                )}
                {line.sources.length > 0 && (
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={9} style={{ textAlign: "right" }}>
                      Earned (this + rolled{excludedCount ? ", included only" : ""})
                    </td>
                    <td className="num">{fmtUsd(adjEarned)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Plain "when did he pay" list across all the invoices above */}
          <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Payments received ({allPayments.length})</h3>
          {allPayments.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No payments are recorded against these invoices yet (billed but uncollected). The payout pays on{" "}
              <strong>billed</strong> revenue, so it doesn't wait on collection.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="table table--center">
                <thead>
                  <tr>
                    <th>Date paid</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Check #</th>
                    <th>Invoice #</th>
                    <th>Invoice date</th>
                  </tr>
                </thead>
                <tbody>
                  {allPayments.map((p, i) => (
                    <tr key={i}>
                      <td>{p.datePaid ? fmtDate(p.datePaid) : "—"}</td>
                      <td className="num">{fmtUsd(p.amount)}</td>
                      <td>{p.method ?? "—"}</td>
                      <td>{p.checkNumber ?? "—"}</td>
                      <td>{p.invoiceNumber ?? "—"}</td>
                      <td>{fmtDate(p.serviceDate)}</td>
                    </tr>
                  ))}
                  <tr className="row--muted" style={{ fontWeight: 700 }}>
                    <td style={{ textAlign: "right" }}>Total paid</td>
                    <td className="num">{fmtUsd(totalPaid)}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
