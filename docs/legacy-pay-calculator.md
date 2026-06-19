# The legacy mentor-pay calculator, explained

A plain-English decode of the spreadsheet the old administrative assistant
("Clayton") used to pay mentors — e.g. `Calculator_for_Harry_Shenks_Mentees.xlsx`.
This exists so the institutional knowledge isn't trapped in one workbook, and so
we can say exactly how the dashboard's `Pay staff` engine (`lib/pay.ts`) relates
to it.

> **TL;DR.** The sheet is one idea wrapped in a lot of manual bookkeeping: pay a
> mentor a percentage of what each mentee pays, prorated for partial months, with
> the percentage ramping up over time — and do it so the mentor can be paid on the
> 1st of every month even though mentees start mid-month. The dashboard keeps the
> intent but computes it from synced data instead of by hand, and **fixes the one
> thing the sheet got wrong: the ramp is built on the MENTOR's tenure, not each
> mentee's.**

---

## 1. What the file is

One workbook **per mentor** (the example is all Harry Shenk). Tabs are years
(`2024`, `2025`, `2026 Payments`). Down each tab is a small **6-row block per
mentee** (Allen, Stephen, Harvey, Sam Glick, William, Josh, Landin, …). At the
bottom, the blocks roll up into a single row of **"what to pay the mentor this
calendar month"** (labeled `January Hours`, `February Hours`, … — "Hours" is a
misnomer; it's dollars).

Everything is typed in by hand each month, which is why it drifts and why it
feels "weird." It's a spreadsheet doing a database's job.

## 2. The building block — one mentee, six rows

Using **Stephen (2024)** as the clean example (he started July 5, 2024):

| Row | Meaning | Stephen |
|---|---|---|
| **Amount** | What the mentee pays that month (their tier price) | 425 |
| **Month Start** | The date the mentor's month for this mentee begins. Hand-entered, and it *drifts* (Jul 5 → Aug 18 → Sep 18) | Jul 5 |
| **Harry's Percentage** | The mentor's share, ramping **35% → 50% → 60%** | .35 / .5 / .6 |
| **% of mo to be paid** | Fraction of the month to pay *now* = `1 − day(start) / days_in_month` | .84 / .42 / … |
| **Harry's Pay** | The actual payout for the calendar month (formula in §3) | $124.76 / ~$113 / … |
| **Assured Take-Home** | The *target* with no proration = `Amount × Percentage` | $148.75 / $255 / $255 |

(`Month Start` is stored as an Excel date serial — e.g. `45478` = 2024-07-05.)

## 3. The "weird" part — pay on the 1st, roll the remainder forward

A mentee starts mid-month and pays on a drifting date, but the mentor is paid on
the **1st of each calendar month**. So each mentee-payment is **split across two
calendar months**, and because the mentor's percentage is *also* climbing, the
sheet pays **this month's slice at this month's rate + last month's unpaid slice
at last month's rate**:

```
Pay(this month) = Amount × %this × fracThis   +   (1 − fracLast) × Amount × %last
                  └──── current slice ─────┘       └──── last month's leftover ────┘
```

Worked — Stephen's August:
`(425 × 0.50 × 0.42)  +  ((1 − 0.84) × 425 × 0.35)` = `89.04 + 23.95` ≈ **$113**.

The author wrote it out in plain English in a cell on the 2024 tab: *"…his
percentage will go up, so we …pay him the remainder …in the next month… This
ensures that by the time month two starts for the mentee, the mentor will have
been paid the adequate percentage… It also enables the mentor to be paid at the
beginning of each month, regardless of when the mentor starts."*

## 4. Make-whole: Assured Take-Home, residuals, and catch-up

- **Assured Take-Home** = `Amount × Percentage` (no proration) — the steady-state
  target. For a full 60% month that's `425 × 0.60 = $255`.
- Because the roll-forward perpetually lags by one partial slice, each mentee
  accrues a small residual (`Assured − Actual`, the `M` column).
- At the bottom, **Catch-Up Amount** sums those residuals (e.g. ~$532) and pays
  them out to make the mentor whole, plus ad-hoc fixes ("Overpaid", "June-July
  Fix", "Sept adjustment for S. Glick overpay").

## 5. The ramp — and the one thing the sheet got WRONG

The percentage ramps **35% → 50% → 60%**. The sheet applies the ramp **per
mentee** — each mentee climbs over *their own* first three months. You can see it
because Allen and Stephen both start July 2024, yet Allen sits at 60% the whole
time while Stephen climbs from 35%.

**This per-mentee ramp is the wrong rule.** HJG's actual policy (confirmed
2026-06-19) is that the ramp is built on the **MENTOR's** tenure:

> A mentor's **first month of work** pays **35%** of revenue across **all** their
> assigned mentees; the **second month** pays **50%**; the **third month onward**
> pays **60%**.

So a brand-new mentee of an *established* mentor is paid at 60% immediately — not
restarted at 35%. The dashboard implements this correct (per-mentor) rule; it
never copied the sheet's per-mentee reset.

## 6. Other moving parts

- **Proration** in the sheet is `1 − day(start) / days_in_month` off a
  hand-entered, drifting anchor date. (The app instead counts active engagement
  days ÷ days in month, from real engagement dates.)
- **Tier price drops** are typed in by hand when a mentee downgrades — e.g.
  Landin goes 425 → 265 → 145, Sam Glick 425 → 265 (4x → 2x → 1x cadence lowering
  the monthly price).
- **Coach attribution** is moot in the sheet — the whole workbook is one mentor.

## 7. How the dashboard (`lib/pay.ts`) relates to it

The app keeps the **intent** but is simpler and data-driven. It assigns each
invoice wholly to its **service month** and prorates by active days, which removes
the need for the roll-forward and catch-up machinery.

| Dimension | Legacy sheet (Clayton) | Dashboard engine (`lib/pay.ts`) |
|---|---|---|
| Ramp 35/50/60 | **per mentee** (wrong) | **per MENTOR tenure**, across all their mentees (correct) — with an editable per-coach **Pay start** override (Admin → Mentor capacity) |
| Revenue basis | the mentee's billed Amount | **billed** (invoice `amount`); collected (`amount_paid`) carried for reference |
| Time assignment | one payment split across two calendar months by anchor date, remainder rolled forward | each invoice lands wholly in its **service month** (`date_of`) |
| Mid-month proration | `1 − day/days` off a drifting hand-entered date | active engagement days ÷ days in month, from real dates |
| Make-whole | explicit **catch-up** residual + ad-hoc fixes | none needed (no lag); "unassigned" bucket for revenue with no overlapping engagement |
| Tier price drops | typed by hand | falls out of the invoice amount |
| Maintenance | re-typed monthly; drifts | re-synced from CoachAccountable; derived + auditable (the Explore window) |

For a steady, full-month, established mentee paying $425, **both produce $255**
(`425 × 0.60`). They only diverge in the messy cases — a mentor's first 1–2
months, mid-month starts, tier changes, partial/late payments — which is exactly
where the sheet piled on its roll-forward and catch-up and the app stays simple.

## 8. Where "delivery" fits (future)

The sheet pays on what's *billed*. The app does too, but also mirrors CA's
`countsInEngagement` flag (`ca_appointments.counts_in_engagement`: 1 = a session
credited toward the engagement). That's a third lens — *delivered* — that can later
verify the mentee's paid-for sessions actually happened, and with the same coach,
without changing the billed pay basis. See `HANDOFF.md`.

## 9. Cell glossary (quick reference)

- **Amount** — mentee's monthly payment (tier price).
- **Month Start** — Excel date serial of the mentor's month start for that mentee.
- **Harry's Percentage** — mentor's revenue share that month (the ramp value).
- **% of mo to be paid** — `1 − day(start)/days_in_month`.
- **Harry's Pay** — actual payout = current slice + last month's rolled-forward leftover.
- **Assured Take-Home** — `Amount × Percentage`, the un-prorated target.
- **To Be Paid / M column** — `Assured − Actual`, the residual owed.
- **Catch-Up Amount** — sum of residuals across mentees, trued up at the bottom.
- **January Hours … December Hours** — total to pay the mentor that calendar month (dollars, not hours).
