import {
  downloadCsv,
} from "../csv";
import {
  payoutDetailCsvRows,
  PAYOUT_DETAIL_CSV_COLUMNS,
  DEFAULT_LINE_STATE,
  effectiveLinePayout,
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
}: {
  line: PayMenteeLine;
  coachName: string;
  ym: string;
  state?: BuildLineState;
  onClose: () => void;
}) {
  const s = state ?? DEFAULT_LINE_STATE;
  const eff = effectiveLinePayout(line.payout, s);
  const prevYm = (() => {
    const [y, m] = ym.split("-").map(Number);
    const o = y * 12 + (m - 1) - 1;
    return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
  })();

  const thisMonth = line.sources.filter((x) => x.slice === "this-month");
  const rollover = line.sources.filter((x) => x.slice === "rollover");
  const sumRecognized = (arr: PayLineSource[]) => round2(arr.reduce((t, x) => t + x.recognized, 0));

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

  const sliceRows = (arr: PayLineSource[], label: string, subtotal: number) =>
    arr.length ? (
      <>
        {arr.map((src, i) => (
          <tr key={`${label}-${i}`}>
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
            <td className="num" style={{ fontWeight: 600 }} title={src.slice === "this-month" ? "billed × (1 − e)" : "billed × e (rolled forward)"}>
              {fmtUsd(round2(src.recognized))}
            </td>
            <td style={{ textAlign: "left" }}>{paymentsCell(src.payments)}</td>
            <td style={{ textAlign: "left" }}>{itemsCell(src)}</td>
          </tr>
        ))}
        <tr className="row--muted">
          <td colSpan={8} style={{ textAlign: "right", fontWeight: 600 }}>
            {label} subtotal
          </td>
          <td className="num" style={{ fontWeight: 700 }}>{fmtUsd(subtotal)}</td>
          <td colSpan={2} />
        </tr>
      </>
    ) : null;

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
              This-month slice <strong>{fmtUsd(line.recognizedThis)}</strong>
            </span>
            <span style={{ color: "var(--muted)" }}>+</span>
            <span title={`rolled forward from ${monthLabel(prevYm)}'s invoice(s)`}>
              Rolled-in from {monthLabel(prevYm)} <strong>{fmtUsd(line.rolloverPrev)}</strong>
            </span>
            <span style={{ color: "var(--muted)" }}>=</span>
            <span>
              Earned <strong>{fmtUsd(line.earned)}</strong>
            </span>
            <span style={{ color: "var(--muted)" }}>× {fmtPct(line.splitPct)} =</span>
            <span>
              Engine payout <strong>{fmtUsd(line.payout)}</strong>
            </span>
            {eff !== line.payout && (
              <span style={{ color: "var(--accent)" }}>
                Effective <strong>{fmtUsd(eff)}</strong>
                {!s.included ? " (excluded)" : s.override != null ? " (override)" : ""}
              </span>
            )}
          </div>

          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
            Under the two-month split, each invoice pays its <em>remaining</em> fraction in its own month and rolls its{" "}
            <em>elapsed</em> fraction (invoice day ÷ 30) into the next. So {monthLabel(ym)}'s payout blends{" "}
            {monthLabel(ym)}'s new invoice slice with {monthLabel(prevYm)}'s rolled-in slice — which is why the earned
            amount can differ from a single month's billed total.
            {s.note ? <> Review note: <strong>{s.note}</strong>.</> : null}
          </p>

          <div className="table-scroll">
            <table className="table table--center">
              <thead>
                <tr>
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
                {sliceRows(rollover, `Rolled in from ${monthLabel(prevYm)}`, sumRecognized(rollover))}
                {sliceRows(thisMonth, `This month (${monthLabel(ym)})`, sumRecognized(thisMonth))}
                {line.sources.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted">
                      No invoice detail is attached to this line (it may predate the invoice sync that captures payment
                      dates). Re-sync to populate it.
                    </td>
                  </tr>
                )}
                {line.sources.length > 0 && (
                  <tr style={{ fontWeight: 700 }}>
                    <td colSpan={8} style={{ textAlign: "right" }}>
                      Earned (this + rolled)
                    </td>
                    <td className="num">{fmtUsd(line.earned)}</td>
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
