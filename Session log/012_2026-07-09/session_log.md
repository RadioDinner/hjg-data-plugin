# Session 012 — 2026-07-09

## Focus
Verify the mentor-payment system against the full CoachAccountable export
(`hjgrawdata20260708.xlsx`), nail down how **Caleb Otto's June 2026** payout should
be computed, then build a **mentor payout reconciliation** feature (calculate any
past month + a running total + remaining, as an accuracy check).

## The grilling → decisions locked (user answered via AskUserQuestion)
Reconstructed Caleb's picture from the export (owner = `ca_clients.coach_id` = 40711):
4 owned clients — **Joash Troyer, Jonathan Heinzman, Ty Miller**, + a self "Caleb Otto"
record (no invoices). Ran a faithful Python port of `lib/pay.ts` against the raw data
and surfaced four forks; the user ruled:

1. **Jonathan → Caleb.** His 4× engagement is cut under Arthur Nisly in CA, but the
   owner was re-pointed to Caleb. Pay follows the **owner** → Caleb gets his $255.
   (Real fix: re-cut Jonathan's 4× engagement to Caleb in CA so owner + deliverer agree.)
2. **JYF excluded.** Only **4×/2×/1×** mentoring revenue counts; JumpStart/JYF (and
   other non-mentoring) never counts toward mentor pay.
3. **Running total = full 4×/2×/1× history** (JYF excluded entirely).
4. **Per-mentor ramp.** Default 35/50/60; **Caleb was fast-tracked to 50/60/60** → 60%
   ongoing. So the ramp had to become per-mentor, not a global constant.

### Verified numbers (Python against the export, then locked into `verify-metrics`)
- **Caleb June 2026 = $765.00** (Joash/Jonathan/Ty each $255; JYF excluded; ramp → 60%).
- Running total through June = **$2,130.67**; remaining (as-of June) = **$348.50**;
  total billed-through-June = **$2,479.17** (paid + remaining reconcile).
- The user's illustrative example ($425 4× from Mar 15 → $892.50 paid + $127.50 remaining
  = $1,020) is exactly the Clayton two-month split; engine reproduces it to the penny.

## What shipped (branch `claude/mentor-payment-verification-3asxd8`)
- **`lib/pay.ts`** — (a) **JYF/non-mentoring exclusion**: `computePayReport` skips any
  invoice whose covering-engagement tier ∉ {4x,2x,1x}; excluded billed (this-month) is
  summed into new `PayReport.excludedBilled` (surfaced, not dropped). Consequence: the
  `unassigned` bucket is now effectively unreachable (a mentoring tier implies a covering
  engagement with a coach). (b) **Per-mentor ramp**: `splitForTenureMonth(tenure, ramp)`
  + `PayInputs.rampOverride: Map<coachId, number[]>` + `PayTimelineInput.rampOverride`.
  (c) `parseRampSpec`/`formatRampSpec` ("50/60/60" ↔ [0.5,0.6,0.6]). (d) `MENTORING_PAY_TIERS`.
- **`supabase/migrations/9973_coach_pay_ramp.sql`** — adds `coach_settings.pay_ramp text`;
  seeds Caleb (40711) `pay_ramp='50/60/60'`, `pay_start_month='2026-03'`, `is_mentor=true`
  (insert-or-update, non-clobbering, re-runnable). **Next new migration is `9972_…`.**
- **`src/db.ts`** — `fetchAll… ` unchanged; `fetchPayData` selects `pay_ramp`, builds
  `rampOverride` (via `parseRampSpec`), adds it to `PayData`; `CoachWithSettings.payRamp`
  + `fetchCoachesWithSettings`/`upsertCoachSettings` carry it; re-exports the ramp helpers.
- **`src/views/PayStaffView.tsx`** — new **MentorReconcile** panel (`SectionId pay.reconcile=205`):
  mentor + "through month" pickers, tiles (this-month payout / paid-through / remaining /
  total-billed-through), a ComposedChart (monthly-payout bars + running-total line, selected
  month highlighted), per-mentee table (this-month / paid / remaining + Total row), CSV.
  Also a new **"Excluded from pay"** stat tile (JumpStart/JYF + non-mentoring), and header
  prose updated. Threads `rampOverride` into the timeline.
- **`src/views/BuildPayoutView.tsx`** — threads `rampOverride` into both engine calls
  (so Build payout agrees with Pay staff).
- **`src/views/AdminView.tsx`** — new **"Pay ramp"** editor column in Mentor capacity
  (placeholder `35/50/60`), wired through `mcEdits`/`saveCoachSettings`; hint updated.
- **`src/uiRegistry.ts`** — `pay.reconcile: 205`.
- **`src/help/articles.ts`** — new `pay.reconcile` article; `pay.payout` updated (per-mentor
  ramp + JYF exclusion + "excluded" instead of "unassigned").
- **`scripts/verify-metrics.ts`** — §8/§9 updated: per-mentor ramp override, ramp-spec
  parse/format, JYF exclusion (`excludedBilled`), no-coverage → excluded (not unassigned),
  a **Caleb June = $765** replica, and the **running + remaining = billed-to-date** invariant.

## State
- `typecheck` + `build` + `verify` all **green**. UI **not** browser-tested (headless).
- An **adversarial review workflow** (3 dimensions → independent refutation → synthesis) was
  launched over the staged diff; results to be folded in (follow-up commit if anything confirmed).

## ⚠ Cutover / next steps
1. **Apply `9973_coach_pay_ramp.sql`** in the Supabase SQL Editor (HJG-owned table; no re-sync
   needed). Until applied, `pay_ramp` reads as null everywhere → everyone uses the default
   35/50/60 (Caleb would show 35/50/60 instead of 50/60/60).
2. **Browser-verify** the new Pay-staff reconciliation panel (mentor/month pickers, the four
   tiles reconciling, the graph, per-mentee table, CSV) and the Admin "Pay ramp" column.
3. Note: excluding JYF + per-mentor ramps changes **every** mentor's historical numbers, not
   just Caleb's — spot-check a couple of others and any signed-off Build-payout months.
4. Consider surfacing WHICH invoices were excluded (today only the aggregate $ is shown; the
   old `unassigned` ledger rows no longer carry them).
