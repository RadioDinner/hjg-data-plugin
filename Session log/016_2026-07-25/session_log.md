# Session 016 — 2026-07-25

## What this session was

Two halves. **Part 1** (below) was analysis only. **Part 2** (further down) shipped
three code changes off the back of it — v0.7.0.

The user asked for a **hand-built payout calculation for Harry Shenk** (the hardest mentor to compute), reconciled line-by-line against the
dashboard's June-2026 payout build, to settle whether the dashboard is trustworthy.

Inputs supplied by the user:

- `Mentees_Database_…_all.csv` — Notion export, declared **the** source of truth for
  who mentors whom.
- `payoutbuildharryshenk20260620260725.csv` — the dashboard's June-2026 payout build.
- `hjgrawdata20260725.xlsx` — full Supabase table dump (invoice dates + amounts).
- `Harry_Shenk_manually_calculated.xlsx` — the user's hand-built sample, 3 mentees.

## Deliverable

`Session log/016_2026-07-25/Harry_Shenk_manual_payout_2026-06.xlsx` — 7 tabs, 1,122
live formulas, recalculated clean (0 errors). Build scripts in
`payout-reconciliation/` (`model.py` → `model.json` → `build_xlsx.py`; `verify.py` is
an independent Python mirror used to check every figure the workbook computes).

Tabs: README · Mentee Blocks · Adjustments · Monthly Roll-up · June Reconciliation ·
Roster · Invoice Source Data.

## Directional decisions (confirmed with the user via AskUserQuestion)

1. **Proration** — `% of mo to be paid = 1 - DAY(start) / DAY(EOMONTH(start,0))`,
   i.e. **real days in the month**. The user supplied this formula verbatim along
   with a worked "Lavon" example. Note their earlier sample sheet had `1.0` typed in
   every column, which silently disabled the roll-forward — that was not the intent.
2. **Credits** — `Amount` = **tier price**; every credit/discount line is listed on
   the Adjustments tab with a Y/N `Include?` toggle, all defaulting to **N**. Flipping
   a toggle recalculates the whole workbook (verified end-to-end).
3. **Double billing** — David Weaver's two separate May invoices get **two columns**;
   Josh Lehman's duplicated `4x` line on a single invoice is a **billing correction**
   (one column, duplicate line toggled off).
4. **Scope** — each mentee's timeline runs from their **first mentoring invoice**
   through one month past their last.

## Result

| | June 2026 |
|---|---|
| Manual method (this workbook) | **$2,983.59** |
| Dashboard paystub — Effective (post-review) | **$3,273.50** |
| Dashboard paystub — Engine (pre-review) | $3,017.70 |
| Variance, manual vs Effective | **−$289.91** |

The $289.91 decomposes **exactly**, and applying all three corrections reproduces the
dashboard to the penny on all 17 mentee lines:

| Cause | $ |
|---|---|
| Dashboard prorates on a fixed 30-day month; the user's formula uses real days | 51.91 |
| David Weaver's two May invoices — chained columns keep the 17 May remainder inside May; the dashboard rolls both into June | 144.50 |
| Josh Lehman's duplicate `4x` line — the user calls it a correction, the dashboard pays on it | 93.50 |

**The engine is not miscalculating.** `tier price × (1 − day/30) × 60%` reproduces the
dashboard's reviewed total to the cent. Every remaining difference is a **policy
choice**, not a bug.

## Findings worth acting on

- **The 30-vs-31-day denominator is the only systemic difference.** It costs Harry
  $51.91 in June alone and recurs every month with 31 days. `lib/pay.ts` hardcodes
  `PRORATION_DAYS = 30` (documented as "the user's choice"). If the user's
  `=1-DAY()/DAY(EOMONTH())` formula is the real policy, the engine is wrong and should
  use real month lengths. **-> The user chose real month lengths; shipped in Part 2.**
- **Engine $3,017.70 vs Effective $3,273.50** is entirely the six credit lines a
  reviewer removed in the June build. That's the reviewer override working as
  designed, not drift.
- **Roster:** all 32 Notion "Harry Shenk" mentees also have CA owner = Harry. Two
  mentees CA assigns to Harry are **not** Harry's in Notion:
  - **Bryce Wenger** (301320) — Notion "~None Assigned", JYF waiting list. No June
    impact (his 24 June invoice is JYF only) **but his 23 July invoice is a $425 4x
    line, so he lands in the July payout.** Needs an owner decision before July runs.
  - **William Beachy** (252530) — Notion blank, quit, no 2026 invoices. Harmless.
- **Ralph Swartzentruber** — the `mentees` table stores `notion_coach = 'Phil
  Herschberger'` with `notion_coach_conflict = true`; the fresh Notion export says
  Harry. JYF-only, so no dollar impact, but the stored conflict is stale.
- **Brandon Burkholder** — four invoices (Oct 2025 – Feb 2026) carry the line item
  `MN Subscription | (4x Month) Zoom Meetings (Arthur Nisly)` even though both Notion
  and CA assign him to Harry. Flagged in the workbook with a cell comment; worth
  confirming whether that was a real transfer or a mis-named CA product.
- **Joel Mast** — his 11 May mentoring line billed $400, not the $425 tier. Used
  as-is (no credit line to toggle).

## Environment note

`libreoffice-calc` was **not installed** in this container — only `libreoffice-core`,
so `scripts/recalc.py` timed out on every file, including a 5-cell test. Fixed with
`apt-get update && apt-get install -y --no-install-recommends libreoffice-calc`.
Future sessions that build spreadsheets will need the same install.

---

# Part 2 — three shipped changes (v0.7.0)

After reading the reconciliation the user made three calls in one message:
*"Change the proration denominator to match the legacy calculator"*, then
*"I'll need a per line Hourly Rate for the hourly staff"* and *"add a way for me to
add items to the hourly and calculated staff where I can pay them for certain items
by piece work. For example, Dave Troyer (an hourly staff member) gets $25 for every
new mentee. He had 8 in June"*, plus *"commit this to main"*.

## 1. Proration denominator -> real month lengths

`lib/pay.ts`: `PRORATION_DAYS = 30` deleted; `elapsedFraction(dayOfMonth)` became
`elapsedFraction(dayOfMonth, ym)` and divides by `daysInMonth(ym)`. This is exactly
the legacy sheet's `1 - DAY(start)/DAY(EOMONTH(start,0))`.

**This moves money.** Harry's June 2026 goes $3,273.50 -> $3,213.93. Any month
neighbouring a 31-day month changes.

Knock-ons, all done:
- `lib/payStub.ts` + `src/components/PayoutLineDetailModal.tsx` reconstructed the
  day as `elapsedFraction * 30`; both now use `daysInMonth(src.serviceMonth)`, so
  the fraction labels read "19/31" correctly. `daysInMonth` re-exported from `src/db.ts`.
- `public/pay-map.html` (the mentor-facing explainer) gained a **28/30/31**
  month-length selector wired through its `calc()`.
- Copy updated in `docs/legacy-pay-calculator.md` (TL;DR, §6, §7 table),
  `src/help/articles.ts`, `src/views/PayStaffView.tsx`, `FEATURE_BACKLOG.md`.
- **12 verify expectations were rebuilt** — they encoded /30 arithmetic. The Ty
  Miller replica went $430.83/$258.50 -> $416.94/$250.16 and the Caleb Otto June
  replica $765 -> $752.67; both comments now record the old numbers and why.
  Conservation still holds per INVOICE (an invoice's two slices add back to its
  full share); what no longer holds is "a mid-month mentee nets exactly one tier
  price per month", because 15/31 + 15/30 != 1.

## 2. Per-line hourly rates

`HourlyEntry` gained `rate?: number | null` — null/absent means "use the period's
default", so every timesheet saved before today reads back identically. New pure
helpers: `entryRate`, `entryAmount`, `laborTotal`, `hasCustomRates`.
`hourlyTotal` now sums each line at its own rate (summing unrounded, then rounding
once, so a single-rate sheet reproduces the old number to the penny).

UI: a **Rate ($/h)** column on the timesheet, blank = default, off-default lines
highlighted. The pay stub only grows a Rate column when rates actually vary, so an
ordinary stub is unchanged. **No migration needed** — `entries` is jsonb.

## 3. Piece work on BOTH pay builders

New pure module `lib/pieceWork.ts`: `PieceEntry {date, label, qty, unitRate}` with
`pieceAmount` / `normalizePieces` / `piecesTotal` / `piecesQty` / `parsePieces`.
New shared `src/components/PieceWorkCard.tsx`, wired into:
- **Hourly staff (§211)** — added on top of the hours.
- **Build payout (§210)** — added to `builtTotal`, deliberately NOT to
  `computedTotal`, so it surfaces as review delta. `summarizeBuild` gained a 4th
  `pieces` argument; `buildPayStubModel` gained `pieces` and a `totals.linePayout`.

Both stubs print piece work: the hourly stub as its own section, the mentor stub as
rows in the summary table so the TOTAL still foots to the check.

Migration **`9964_pay_piece_work.sql`** adds `piece_items` jsonb + `pieces_total`
to `staff_pay_builds` AND `payout_builds`. Both writers retry without the columns
on a pre-9964 database, and only error when there are actually piece-work items to
save.

## Verification

- `typecheck` clean, `verify` **677 checks** (was 622 — 55 new), `build` green.
- Hourly stub render-checked in headless Chromium with mixed rates + two
  piece-work lines: $497 labor + $245 piece work + $25 adjustment = **$767**, and
  the printed table foots to it.
- Piece-work maths verified against the user's own example: 8 x $25 = $200.

## Environment gotchas (cost real time)

1. **`libreoffice-calc` is not installed** — only `libreoffice-core`. The xlsx
   skill's `recalc.py` times out on *every* file, including a 5-cell test, with a
   misleading "LibreOffice timed out" message. Fix:
   `apt-get update && apt-get install -y --no-install-recommends libreoffice-calc`.
2. **Node deps are not installed** at session start — `npm ci` first or `tsx` is
   missing.
3. **Playwright is only global** (`/opt/node22/lib/node_modules/playwright`), not in
   the repo; import from that absolute path and launch with
   `executablePath: '/opt/pw-browsers/chromium'`.

## Next step

- **Apply `9964_pay_piece_work.sql`.**
- Resolve **Bryce Wenger**'s ownership before the July payout (CA says Harry,
  Notion says unassigned; his 23 July invoice is a $425 4x line).
- Consider whether saved/approved builds from before today should be re-reviewed
  now that the denominator changed — the drift warning will flag them on reopen,
  but nobody is forced to look.
