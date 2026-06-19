# Session 005 — 2026-06-19

## Purpose
Orientation → branch consolidation → a real feature build: a staff/mentor
**payment tool** backed by a new **invoice sync**. Worked directly on `main`
(per the user's instruction for this session).

## What shipped (commits, in order)
- `07be701` / `f8a58ab` — **Consolidated all branches into `main`.** Fast-forwarded
  `main` to the old `admiring-lovelace` tip (session 003 capacity fix + 003/004
  logs), added session 005 log (renumbered from a transient `003` → `005`).
- `488dd27` — log: Supabase data-access discussion.
- `91cb79f` — log: coach payment / invoice API question.
- `d8e412f` — **Scaffold CoachAccountable invoice sync (read-only).** New
  `ca_invoices` mirror (migration `9993`), `CAClient.getInvoices()`, best-effort
  sync step, `CA_FN.invoiceGetAll/getPayments`, types, RAW_TABLES entry.
- `f2ff3e3` — **Add "Pay staff" tab + payout engine.** `lib/pay.ts`
  (`computePayReport`), `src/views/PayStaffView.tsx`, `fetchPayData` in `db.ts`,
  tab wired in `App.tsx`, `.stack` CSS, verify §8, HANDOFF refresh.
- (this commit) — session wrap: handoff + session log.

## The payment model (decided with the user)
- **Pay on revenue COLLECTED** (invoice `amount_paid`), credited to the invoice's
  **service month** (`date_of`) — never the payment date. Solves "which month
  does a 4/15 payment count toward."
- **Daily proration** by active engagement days: `(active days / days in month)`.
  Full month = whole share; handles mid-month start/quit/graduation/tier-change.
- **Split ramps by mentor tenure: 35% → 50% → 60%** (month 1 / 2 / 3+). Tenure
  derived from the mentor's earliest engagement (overridable later).
- Mentee → mentor via `ca_engagements.coach_id` (invoices carry NO coach — the
  CoachID on `Invoice.getAll` is only a filter). Majority-day coach wins a
  hand-off month. Collected revenue with no overlapping engagement → "unassigned".
- Moved OFF per-appointment pay (it paid on cancellations; policy is the mentee
  pays for the month regardless of attendance).

## Directional decisions
- Branch merge method: **direct push to `main`**; delete merged branches (remote
  delete blocked by the git proxy 403 — must be done in the GitHub UI).
- AskUserQuestion answers: pay on **collected**; **daily proration**; split
  **varies** via the new-mentor ramp 35/50/60.
- Revenue source = **invoices** (collected). Tier→price config is the fallback if
  CA doesn't invoice subscriptions — to be confirmed from real `ca_invoices`.

## Re-evaluation / bugs caught while building
- `Invoice.getAll` returns no coach → engine maps mentee→mentor via engagements.
- `lib/pay.ts` importing `"./config.js"` made the whole module `any` under Vite
  "Bundler" resolution → switched to extensionless (matches `config`/`conversion`).
- `src/lib/` exists, so `../lib/pay` from `src/views/` mis-resolved → re-export
  the engine through `db.ts`. (Both gotchas now documented in HANDOFF.)
- Skip $0-collected mentees (pay-on-collected) to keep the report payout-focused.

## Open questions / next step
- **OPEN:** ramp basis — mentor tenure (implemented) vs reset per new mentee
  relationship. User asked, not yet answered.
- **Action required:** apply `9993_ca_invoices.sql` + re-sync (also activates the
  session-003 capacity fix), then export `ca_invoices` to verify the revenue
  source. See HANDOFF "Immediate next steps".

## Notes for future-me
- `npm run verify` is now **8 sections** (added [8] staff payment). The Alex
  Reiff → Harry $255 full-month example is a hard assertion there.
- Next migration number is **`9992_…`** (descending). `9993` still needs applying.
- UI not browser-tested (headless container).
