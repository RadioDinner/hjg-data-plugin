# Session 016 — 2026-07-25

## What this session was

No app code changed. The user asked for a **hand-built payout calculation for Harry
Shenk** (the hardest mentor to compute), reconciled line-by-line against the
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
  use real month lengths. **Open question for the user.**
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

## Next step

Ask the user to settle the proration denominator (30 fixed vs real days). If they
choose real days, `PRORATION_DAYS` in `lib/pay.ts` and the `elapsedFraction()` helper
need to change, plus `docs/legacy-pay-calculator.md` §7 which currently documents the
fixed 30 as deliberate. Also resolve Bryce Wenger's ownership before the July payout.
