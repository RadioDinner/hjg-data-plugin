import {
  downloadCsv,
} from "../csv";
import {
  payoutDetailCsvRows,
  PAYOUT_DETAIL_CSV_COLUMNS,
  DEFAULT_LINE_STATE,
  effectiveLineTotal,
  payoutAfterExclusions,
  payLineSourceKey,
  payLineItemKey,
  excludedInvoiceSet,
  excludedLineItemSet,
  includedLineItemSet,
  sourceIsClassified,
  sourceAutoBasis,
  lineItemCounts,
  lineItemsSplittable,
  sourceIncludedBilled,
  sourceRecognizedAfterExclusions,
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
  onChange,
  splitOverride = null,
  readOnly = false,
}: {
  line: PayMenteeLine;
  coachName: string;
  ym: string;
  state?: BuildLineState;
  onClose: () => void;
  // Update this line's invoice / line-item overrides. Absent => a read-only view
  // (no checkboxes). Called with the full next override arrays; the caller merges
  // them into the build's lineStates (so they save + reload with the build).
  onChange?: (patch: Pick<BuildLineState, "excludedInvoices" | "excludedLineItems" | "includedLineItems">) => void;
  // Build-level Split % override (fraction) — replaces the engine's ramp split
  // in the effective math shown here.
  splitOverride?: number | null;
  readOnly?: boolean; // build approved/locked — show the selection but disable edits
}) {
  const s = state ?? DEFAULT_LINE_STATE;
  const exclInv = excludedInvoiceSet(s);
  const exclLI = excludedLineItemSet(s);
  const inclLI = includedLineItemSet(s);
  const canEdit = !!onChange && !readOnly;
  const eff = effectiveLineTotal(line, s, splitOverride);
  const prevYm = (() => {
    const [y, m] = ym.split("-").map(Number);
    const o = y * 12 + (m - 1) - 1;
    return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
  })();

  const thisMonth = line.sources.filter((x) => x.slice === "this-month");
  const rollover = line.sources.filter((x) => x.slice === "rollover");
  // Effective (post-override) figures — the live effect of the checkboxes. recogOf
  // scales an invoice's recognized slice to its surviving line-item basis;
  // adjEarned/adjPayout track the selection while line.payout stays the "before".
  const recogOf = (src: PayLineSource) => sourceRecognizedAfterExclusions(src, s);
  const includedBilledOf = (src: PayLineSource) => sourceIncludedBilled(src, s);
  const fullyOff = (src: PayLineSource) => round2(includedBilledOf(src)) <= 0.005;
  // "Adjusted" always means THE REVIEWER changed something — measured against the
  // engine's own auto basis, never against the raw billed amount (an untouched
  // mixed invoice whose JYF line the ENGINE excluded is not an adjustment).
  const partlyOff = (src: PayLineSource) => {
    const inc = includedBilledOf(src);
    return inc > 0.005 && Math.abs(inc - sourceAutoBasis(src)) > 0.005;
  };
  const sumRecogIncl = (arr: PayLineSource[]) => round2(arr.reduce((t, x) => t + recogOf(x), 0));
  const adjThisMonth = sumRecogIncl(thisMonth);
  const adjRollover = sumRecogIncl(rollover);
  const adjEarned = round2(adjThisMonth + adjRollover);
  const adjPayout = payoutAfterExclusions(line, s, splitOverride);
  // Invoices whose effective basis differs from the engine's auto basis (i.e. the
  // reviewer changed something) — powers the "(engine $X before …)" note.
  const affectedCount = line.sources.filter(
    (src) => Math.abs(includedBilledOf(src) - sourceAutoBasis(src)) > 0.005
  ).length;
  // Line items the engine flagged for human judgment (credits + unmatched charges).
  const reviewCount = line.sources.reduce(
    (t, src) => t + src.lineItems.filter((li) => li.status === "credit" || li.status === "excluded").length,
    0
  );

  const emit = (nextInv: Set<string>, nextExcl: Set<string>, nextIncl: Set<string>) =>
    onChange?.({ excludedInvoices: [...nextInv], excludedLineItems: [...nextExcl], includedLineItems: [...nextIncl] });
  // The invoice-level checkbox is a MASTER toggle. Classified (invoice-truth)
  // sources: OFF force-drops the whole invoice; ON restores the ENGINE's default
  // selection (clears that invoice's per-line flips too). Legacy sources keep the
  // splittable flip-all / whole-invoice behavior.
  function toggleInvoice(src: PayLineSource) {
    const key = payLineSourceKey(src);
    const inv = new Set(exclInv);
    const excl = new Set(exclLI);
    const incl = new Set(inclLI);
    const clearFlips = () => {
      src.lineItems.forEach((_, i) => {
        const k = payLineItemKey(src, i);
        excl.delete(k);
        incl.delete(k);
      });
    };
    if (sourceIsClassified(src)) {
      if (inv.has(key) || fullyOff(src)) {
        inv.delete(key);
        clearFlips(); // back to the engine's auto selection
      } else {
        inv.add(key);
        clearFlips(); // force-exclude whole; per-line flips are moot
      }
    } else if (lineItemsSplittable(src)) {
      const anyOn = src.lineItems.some((_, i) => !excl.has(payLineItemKey(src, i)));
      src.lineItems.forEach((_, i) => {
        const k = payLineItemKey(src, i);
        if (anyOn) excl.add(k);
        else excl.delete(k);
      });
      inv.delete(key); // splittable invoices are driven by their line items
    } else if (inv.has(key)) {
      inv.delete(key);
    } else {
      inv.add(key);
    }
    emit(inv, excl, incl);
  }
  // Flip ONE line item. Auto-excluded lines toggle via the opt-IN list; everything
  // else via the exclusion list — payBuild.lineItemCounts reads both.
  function toggleLineItem(src: PayLineSource, index: number) {
    const k = payLineItemKey(src, index);
    const inv = new Set(exclInv);
    const excl = new Set(exclLI);
    const incl = new Set(inclLI);
    const li = src.lineItems[index];
    if (sourceIsClassified(src) && li?.status === "excluded") {
      if (incl.has(k)) incl.delete(k);
      else incl.add(k);
    } else if (excl.has(k)) {
      excl.delete(k);
    } else {
      excl.add(k);
    }
    emit(inv, excl, incl);
  }
  // Master checkbox state for one invoice (checked / indeterminate).
  const invBoxState = (src: PayLineSource): { checked: boolean; indeterminate: boolean } => {
    if (sourceIsClassified(src)) {
      const basis = includedBilledOf(src);
      const adjusted = Math.abs(basis - sourceAutoBasis(src)) > 0.005;
      return { checked: basis > 0.005, indeterminate: basis > 0.005 && adjusted };
    }
    if (lineItemsSplittable(src)) {
      const n = src.lineItems.length;
      const dropped = src.lineItems.filter((_, i) => exclLI.has(payLineItemKey(src, i))).length;
      return { checked: dropped < n, indeterminate: dropped > 0 && dropped < n };
    }
    return { checked: !exclInv.has(payLineSourceKey(src)), indeterminate: false };
  };

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

  // Line items, each with its own checkbox. Classified (invoice-truth) sources show
  // the engine's auto-selection + a review pill on judgment lines (credits and
  // unmatched charges); legacy sources need the reconcile (splittable) guard. A
  // whole-invoice drop strikes and disables every item.
  const itemsCell = (src: PayLineSource) => {
    if (!src.lineItems.length) return <span className="muted">—</span>;
    const classified = sourceIsClassified(src);
    const splittable = lineItemsSplittable(src);
    const perLine = classified || splittable;
    const invOff = exclInv.has(payLineSourceKey(src));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {src.lineItems.map((li, i) => {
          const counts = !invOff && (perLine ? lineItemCounts(src, i, s) : true);
          const off = !counts;
          const pill =
            classified && li.status === "credit" ? (
              <span className="pill pill--running" style={{ fontSize: 10 }} title="Credit — auto-included as a reduction; review whether it should reduce mentor pay">
                credit · review
              </span>
            ) : classified && li.status === "excluded" ? (
              <span className="pill" style={{ fontSize: 10 }} title="Didn't match a pay-eligible template (Company options → Payment groups) — check to count it anyway">
                not pay · review
              </span>
            ) : null;
          return (
            <label
              key={i}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "baseline",
                fontSize: 12,
                textDecoration: off ? "line-through" : undefined,
                color: off ? "var(--muted)" : undefined,
              }}
            >
              {onChange && perLine ? (
                <input
                  type="checkbox"
                  checked={counts}
                  disabled={!canEdit || invOff}
                  onChange={() => toggleLineItem(src, i)}
                  aria-label={`Include line item "${li.item ?? "item"}" (${fmtUsd(li.amount)})`}
                  title={off ? "Not counted — check to include this line in the pay basis" : "Counted — uncheck to drop this line from the pay basis"}
                />
              ) : null}
              <span>
                {li.item ?? "—"} ({fmtUsd(li.amount)})
              </span>
              {pill}
            </label>
          );
        })}
        {onChange && !perLine && src.lineItems.length > 1 ? (
          <span className="muted" style={{ fontSize: 11 }}>
            line items don't reconcile to the total — use the Incl. box to drop the whole invoice
          </span>
        ) : null}
      </div>
    );
  };

  const sliceRows = (arr: PayLineSource[], label: string) => {
    if (!arr.length) return null;
    const inclSubtotal = round2(arr.reduce((t, x) => t + recogOf(x), 0));
    const adjustedHere = arr.filter((x) => Math.abs(includedBilledOf(x) - sourceAutoBasis(x)) > 0.005).length;
    return (
      <>
        {arr.map((src, i) => {
          const off = fullyOff(src);
          const part = partlyOff(src);
          const box = invBoxState(src);
          const effRecog = round2(recogOf(src));
          const rawRecog = round2(src.recognized);
          return (
            <tr key={`${label}-${i}`} className={off ? "builder__row--excluded" : ""}>
              <td>
                {onChange ? (
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = box.indeterminate;
                    }}
                    checked={box.checked}
                    disabled={!canEdit}
                    onChange={() => toggleInvoice(src)}
                    aria-label={`Include invoice ${src.invoiceNumber ?? src.serviceDate} in the payout`}
                    title={
                      box.indeterminate
                        ? "Some line items dropped — click to drop the rest"
                        : box.checked
                          ? "Included — uncheck to drop this invoice"
                          : "Excluded — check to count this invoice"
                    }
                  />
                ) : (
                  <span className="muted">{off ? "✕" : part ? "◐" : "✓"}</span>
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
                {fmtUsd(effRecog)}
                {part && effRecog !== rawRecog ? (
                  <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}> (was {fmtUsd(rawRecog)})</span>
                ) : null}
              </td>
              <td style={{ textAlign: "left" }}>{paymentsCell(src.payments)}</td>
              <td style={{ textAlign: "left" }}>{itemsCell(src)}</td>
            </tr>
          );
        })}
        <tr className="row--muted">
          <td colSpan={9} style={{ textAlign: "right", fontWeight: 600 }}>
            {label} subtotal{adjustedHere ? ` · ${adjustedHere} adjusted` : ""}
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
            <span style={{ color: "var(--muted)" }}>× {fmtPct(splitOverride ?? line.splitPct)}{splitOverride != null && splitOverride !== line.splitPct ? " (set for this build)" : ""} =</span>
            <span>
              Payout <strong>{fmtUsd(adjPayout)}</strong>
            </span>
            {affectedCount > 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                (engine {fmtUsd(line.payout)} before {affectedCount} adjusted invoice{affectedCount === 1 ? "" : "s"})
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
            {canEdit ? (
              <>
                {" "}
                <strong>Uncheck an invoice — or a single line item inside it</strong> — to drop it from this payout; check
                a "not pay" line to count it. Lines matching the pay-eligible templates (Company options → Payment groups)
                are selected automatically; <strong>credits and unmatched charges carry a "review" pill</strong> for human
                judgment. The basis is the sum of the counted lines; earned and payout recompute live and save with the
                build.
              </>
            ) : onChange ? (
              <> This build is approved — reopen it to change which invoices or line items are included.</>
            ) : null}
            {reviewCount > 0 ? (
              <>
                {" "}
                <strong style={{ color: "var(--accent)" }}>
                  {reviewCount} line item{reviewCount === 1 ? "" : "s"} flagged for review.
                </strong>
              </>
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
                      Earned (this + rolled{affectedCount ? ", included only" : ""})
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
