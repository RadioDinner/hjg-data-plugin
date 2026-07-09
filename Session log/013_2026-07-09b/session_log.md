# Session 013 — 2026-07-09 (b)

Payout transparency: diagnose Ty Miller's $430.83, then make Export CSV export the
*data used to build the payout* and add a click-the-mentee invoice/payment drill-down.

## The question — why does Caleb's June payout show $430.83 "earned" for Ty Miller?

The Build-payout screen (§204) computes each mentee's payout under **Clayton's
two-month split**:

- `e = min(invoiceDay, 30) / 30` (fixed 30-day month)
- this month's invoice recognizes its **remaining** slice `billed × (1 − e)`
- last month's invoice rolls its **elapsed** slice `billed × e` forward
- `earned = recognizedThis + rolloverPrev`; `payout = earned × splitPct`

For **Ty Miller, June 2026** (from the user's export):
- June invoice = **$425 dated the 30th** → `e = 30/30 = 1` → this-month slice `= 425 × (1−1) = $0`.
- So June's payout is **entirely May's rolled-in slice = $430.83**.
- `payout = 430.83 × 60% = $258.50` (Caleb's fast-track ramp 50/60/60 → 60% by June).

Why **> $425**? `rolloverPrev` **sums over all of the prior month's mentoring
invoices** for the mentee. $430.83 > the $425 tier price means Ty had **more than
one 4× invoice in May** (or one billed at a non-standard amount) — most plausibly
a proration/adjustment around his JumpStart→4× transition (~5/29) **plus** his
regular $425 4× invoice, both dated late in the month so nearly their full amounts
rolled into June. The engine math is faithful; the old screen/CSV just **hid the
invoices**, so you couldn't see it. That's exactly what this session fixed.
(Reassurance: June's $425/day-30 invoice isn't lost — it rolls fully into **July**.)

A verify assertion now reproduces the exact numbers with a two-May-invoice replica
($425 on the 29th + $20 on the 30th → $410.83 + $20.00 = **$430.83** → **$258.50**).

## What shipped

**Engine (`lib/pay.ts`)** — additive, math unchanged:
- New `PayLineSource` (+ `PayInvoicePayment`, `PayInvoiceLineItem`); `PayInvoiceInput`
  gained optional `invoiceId / invoiceNumber / payments / lineItems`.
- `computePayReport` now records, per `PayMenteeLine` (and `PayLedgerRow`), the
  `sources[]` — the individual invoices whose slices built the line (slice type,
  elapsed fraction, recognized amount, payment dates, line items), oldest first.
  `recognized` stored **unrounded** so Σ sources foots to the engine's rounded `earned`.

**Data (`src/db.ts`)** — `fetchAllPayInvoices` now also selects `id, invoice_number,
line_items, payments` and normalizes the jsonb (`asArray` / `normInvoicePayments` /
`normInvoiceLineItems`). The data was already synced (9993 `ca_invoices.payments`) —
it was just being dropped before the engine.

**CSV (`lib/payBuild.ts`)** — new `payoutDetailCsvRows()` + `PAYOUT_DETAIL_CSV_COLUMNS`:
one row **per contributing invoice** (this-month + rolled-in slices) with the dates
each was paid; mentee-level payout columns appear only on each mentee's **first**
invoice row (blank after) so a column sum never double-counts.

**§204 `BuildPayoutView`**:
- **Export CSV** now exports that invoice-level detail (was: the on-screen per-mentee
  summary). TOTAL row aligned by column label.
- **Mentee name is now a button** → opens **`PayoutLineDetailModal`** (§905): that
  mentee's invoices, every payment date/amount/method, line items, and the
  `this-month + rolled-in = earned → payout` math spelled out. "Rather too much
  information than too little."

**Pay Explore Invoices view (§901)** — added Invoice #, Payment dates, Payment methods,
Line items columns, so its CSV carries the underlying data too.

**Registry/help** — `modal.payoutLineDetail = 905` (uiRegistry + UI_INDEX); `pay.build`
help article updated (drill-down + "data used to build the payout" export).

**verify-metrics** — §8 gained the Ty-Miller $430.83/$258.50 replica + `sources`
invariants (audit foots, payment dates thread through, ordering); §13 gained
`payoutDetailCsvRows` alignment/no-double-count tests.

## State
- `typecheck` + `verify` + `build` all green.
- Adversarial review run (parallel subagents): DB-normalization dimension came back
  clean; engine/CSV + UI dimensions reviewed too (findings folded in — see HANDOFF).
- **UI NOT browser-tested** (headless container — no live Supabase creds).
- **No migration** — payments/line_items were already in `ca_invoices` (9993).

## Next session
- Browser-verify §204: click a mentee → the drill-down shows their invoices + payment
  dates; Export CSV downloads the per-invoice detail; Pay Explore → Invoices shows the
  new columns.
- With live data, open Ty Miller's June drill-down to confirm the actual May invoices
  behind the $430.83 (and decide whether any is a duplicate to exclude/override).
- Consider making the mentee name clickable in the other pay tables too (reconcile §205,
  Explore ledger) if wanted — this session scoped the drill-down to §204 per the request.
