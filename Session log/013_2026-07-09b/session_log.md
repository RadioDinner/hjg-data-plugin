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

**⚠ CORRECTION (later in the session).** My first write-up here said the > $425 came from
a legit *rollover / second 4× invoice* — a "made-whole across two months" story. **That was
wrong, and I said it without ever seeing the invoice line items.** The user corrected me:
the extra is **JumpStart Your Freedom "Supervised Progress" (non-MN-Subscription) revenue
being swept into the mentoring basis.** Root mechanism (confirmed in code): the engine pays
on the invoice's **total `amount`** and gates eligibility only by whether a 4×/2×/1×
engagement covers the invoice DATE — it never inspects the invoice's own line items — so a
JYF/supervised-progress charge riding on (or alongside) an MN Subscription invoice gets paid.
The user's rule: **only MN Subscription mentoring counts.** The exact invoice breakdown was
deferred by the user ("wait for context"); the durable fix is the **Payment groups** feature
(below) — the admin picks exactly which engagement templates count, so JYF stays unchecked.

(The invoice-drilldown + CSV shipped this session are still correct + useful — they now
surface the line items so the JYF charge is visible. The two-May-invoice verify replica is a
synthetic reproducing the *arithmetic* of $430.83→$258.50; it is NOT a claim about Ty's real
invoices.)

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

## Payment groups — configurable "what counts as pay" (the durable fix)

New Company-options (§451) feature: an admin-controlled grid of **which CoachAccountable
engagement templates count toward which group of staff** for payouts — replacing the
hardcoded 4×/2×/1× name-parsing. Confirmed with the user (AskUserQuestion): the grid
**decides** (unchecked templates never count); templates load **via Admin → Sync + a
Refresh button**; **multiple groups** supported with a **separate coach-to-group** grid.

**What shipped:**
- **Migration `9972_pay_engagement_groups.sql`** — `ca_engagement_templates` mirror
  (RLS read) + seeds `app_settings` key `pay_engagement_groups` (default: one "Mentors"
  group, empty). **Next new migration is `9971_…`.**
- **CA + sync** — `Engagement.getTemplates` (`CA_FN.engagementGetTemplates`,
  `ca.getEngagementTemplates`); `lib/sync.ts` upserts templates in `runSync` (best-effort)
  + a standalone `syncEngagementTemplates()`; **`api/sync-templates.ts`** POST endpoint +
  `refreshEngagementTemplates()` client helper for the Refresh button.
- **`lib/payGroups.ts`** (pure) — `PayGroup`/`PayGroupsConfig`, parse/serialize,
  `normalizeTemplateName`, `payEligibleForGroup` (predicate or **null** when a group has no
  templates → legacy fallback), `MENTORS_GROUP_ID`.
- **Engine (`lib/pay.ts`)** — `computePayReport`/`mentoringCoverFor` take an optional
  `payEligible(engagementName)` predicate; when present it **replaces** the
  `MENTORING_PAY_TIERS.has(engagementTier)` gate, else legacy. Tier LABEL still from the name.
- **`src/db.ts`** — `fetchEngagementTemplates`, `fetchPayGroupsConfig`, `savePayGroupsConfig`;
  `fetchPayData` builds `payEligible` from the Mentors group (`?? undefined` → legacy).
  Threaded into the Build/Pay/Reconcile call sites. `ca_engagement_templates` added to RAW_TABLES.
- **UI — `src/components/PayGroupsCard.tsx`** on §451 (`options.payGroups=452`): the
  template×group checkbox grid + coach×group grid + add/rename/remove group + "Refresh
  templates". Debounced save. Help article `options.payGroups`.
- **verify-metrics §9b** — parse/serialize, `payEligibleForGroup` null-vs-predicate,
  normalized matching, and the **grid-overrides-legacy** engine cases (a 4× engagement whose
  template is unchecked is excluded → `excludedBilled`; a checked one is paid; tier label kept).

**⚠ CUTOVER (next session / user):** apply **`9972_pay_engagement_groups.sql`**, then
**Refresh templates** (or Admin → Sync) to populate `ca_engagement_templates`, then on §451
check the mentoring templates for **Mentors** (e.g. the (4x/2x/1x Month) MN Subscriptions) and
leave JYF/(0x)/groups/MT unchecked. Until templates are checked, payouts use the legacy rule.

**Open (still pending the user's context):** whether the pay basis must also be filtered at the
**line-item** level (a JYF charge as a line item on the SAME invoice as an MN Subscription
charge — the grid gates by engagement template, and the engine still pays on the invoice TOTAL).
Confirm the invoice structure, then decide if line-item filtering is also needed.

## Next session
- **Apply `9972`** + Refresh templates + configure the Mentors group (see cutover above).
- Browser-verify §204 drill-down + CSV, Pay Explore → Invoices columns, and the §451 grid
  (toggle a template → payout changes; add/rename/remove a group; coach assignment; Refresh).
- Resolve the open line-item question once the user sends the invoice breakdown.
- Optional: make the mentee name clickable in the other pay tables (reconcile §205, Explore ledger).
