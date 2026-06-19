# Session 005b — 2026-06-19

Branch: `claude/wonderful-wright-du8c1f` (per the session's branch instruction —
*not* `main` this time).

## Ask

> "Re-evaluate our pay system. I want to see a breakdown by month, be able to
> explore the raw data used to compile our numbers in a window, and sort/filter
> the data by date, coach, etc."

Interpreted as **better tooling to evaluate the existing payout model** (not a
change to the pay *rules*), since the three concrete asks are all about
viewing/auditing.

## Directional decisions (confirmed with the user via AskUserQuestion)

- **Explore window** = **compiled payout ledger + a raw-source toggle** (flip to
  the literal `Invoices` / `Engagements` engine inputs), not ledger-only or
  source-only.
- **By-month layout** = **all-months expandable table** (each month row expands
  to its per-mentor breakdown), replacing the old single-month picker — chosen
  over an "overview + separate drill-down" split.

## What shipped

- `lib/pay.ts`: added pure **`computePayTimeline`** (thin map over the untouched
  `computePayReport`) + flat **`PayLedgerRow`** / `PayTimeline` / `distinctServiceMonths`.
- `scripts/verify-metrics.ts`: **§9** covering the timeline + ledger (multi-month
  rollup, grand totals, unassigned-bucket ledger row, scoped months list).
- `src/db.ts`: re-export `computePayTimeline`, `distinctServiceMonths`,
  `engagementTier`, and the new pay types.
- `src/components/SortableTable.tsx` (NEW): reusable tri-state click-to-sort
  table that exports its current sorted view to CSV.
- `src/components/PayExploreModal.tsx` (NEW): the "Explore source data" window —
  Ledger / Invoices / Engagements views, filter bar (search, month-range From/To,
  coach, tier) + reset, per-view CSV.
- `src/views/PayStaffView.tsx`: rewritten — all-time summary tiles, payout-by-
  month graph (Collected vs Payout) **and** an all-months expandable table
  (per-mentor breakdown + "Explore this month →" jump), top-level "Explore source
  data" button. Empty-state banner preserved.
- `src/styles.css`: sortable-header, filter-bar, wide-modal, expandable-row styles.

Verified: `npm run typecheck`, `npm run verify` (9 sections), `npm run build` all
pass. **Not** browser-tested (headless container + no invoice data yet).

## Also shipped 005b — delivery signal (`countsInEngagement`)

The user wants to verify that the sessions a mentee *paid for* were actually
*delivered* (and by the same coach) — a "pay on delivered" basis beyond Clayton's
"billed" and our app's "collected". Investigated the CA data model: there's no
literal attended/no-show flag, but `Appointment.getAll` returns
**`countsInEngagement`** (1 = credited toward the engagement, -1 = not, 0 = no
judgement). CA already returns it in the response we sync — we were dropping it.

Wired it up end-to-end:
- `lib/types.ts`: `CAAppointment.countsInEngagement?` + `CaAppointmentRow.counts_in_engagement`.
- `lib/sync.ts`: map `a.countsInEngagement ?? null` into the appointment rows.
- `supabase/migrations/9992_appointment_counts_in_engagement.sql`: add the column
  + an `(engagement_id, counts_in_engagement)` index. Re-runnable.

Lands in the Raw-data tab automatically (`select *`). **Needs apply `9992` +
re-sync.** Then eyeball the 1/-1/0 distribution — only useful if coaches actually
maintain the flag in CA. Migration numbering: next new one is now `9991_…`.

## Also shipped 005b — revenue basis switched to BILLED

User decided to pay on **billed** (invoice `amount`), not **collected**
(`amount_paid`) — "that's when, in a perfect world, they'd pay." Switched the
engine accordingly:
- `lib/pay.ts`: `PayInvoiceInput` now carries `billed` + `collected`; the engine
  pays on `billed` (earned = billed × proration), and carries `collected` through
  every output (line/summary/totals/ledger) for reference. Comments updated.
- `src/db.ts`: `fetchAllPayInvoices` selects `amount` + `amount_paid`.
- `scripts/verify-metrics.ts` §8/§9: updated to billed; the old "pay on collected
  (partial)" case is now "billed basis ignores partial collection → $255", and a
  new check confirms collected is carried for reference.
- UI (`PayStaffView`, `PayExploreModal`): "Revenue billed" is the headline /
  pay basis; "Collected so far" shown alongside (tile, ledger + invoices columns,
  CSV) so the billed-vs-paid gap stays auditable.

typecheck, verify (9 sections), build all pass.

## Also shipped 005b — ramp resolved (per-MENTOR) + mentor-start override + legacy doc

User confirmed the ramp is built on the **MENTOR's** tenure (35% the mentor's 1st
month of work across ALL their mentees, 50% the 2nd, 60% the 3rd+) — Clayton's
per-mentee reset was wrong. The engine already worked this way, so "the rework"
was: (a) lock it with tests, (b) make the mentor start explicit/overridable.

- `lib/pay.ts`: clearer comment; no logic change (already per-mentor; the
  `startMonthOverride` hook existed).
- `scripts/verify-metrics.ts` §8: new tests — one mentor / two mentees both at 35%
  ($297.50 = 35% of $850); and the start-month override (April-start mentor looks
  new → 35%, but pinning Jan start → month 4 → 60%).
- **Mentor-start override (the real rework):** `coach_settings.pay_start_month`
  ('YYYY-MM', migration **9991**), edited in Admin → Mentor capacity → "Pay start"
  (a `<input type="month">`). Threaded `fetchPayData.startMonthOverride` →
  `computePayTimeline`. Only well-formed 'YYYY-MM' values are honored; blank =
  derive from earliest engagement.
- `docs/legacy-pay-calculator.md`: plain-English decode of Clayton's sheet (6-row
  block, roll-forward trick, catch-up, the per-mentee ramp mistake, tier drops),
  plus a legacy→app mapping table.

⚠ **Apply migration 9991** before this deploys — the Pay-staff data layer now
selects `pay_start_month`. typecheck, verify (9 sections), build all pass.

## Open / next
- **Pending: align `lib/pay.ts` to Clayton's logic, ramp by mentee-month** (the
  AskUserQuestion decision). Not started — confirmed the ramp interpretation in
  chat first. Also still owed: the plain-English legacy-logic doc.

- **Still gated on data:** the tab stays empty until `9993_ca_invoices.sql` is
  applied in Supabase + a re-sync runs. The by-month view and Explore window
  populate from that same re-sync. **Browser-verify both then.**
- Possible follow-ups: reuse `SortableTable` in the Raw data tab; add per-mentor
  (not just per-month) trend lines; if "re-evaluate" also means revisiting the
  *rules*, the open HANDOFF items (ramp basis: tenure vs per-mentee; revenue
  source: invoices vs tier→price) are the threads to pull.
