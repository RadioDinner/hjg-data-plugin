# Feature backlog

Planned features to build **later** — captured here so they aren't lost. Each
entry has enough context (what, why, where in code, acceptance criteria) to pick
up cold. When one ships, move it to "Shipped" at the bottom (or delete it and note
it in `HANDOFF.md`). Newest ideas on top.

> Orientation: read `HANDOFF.md`, `new_session_instructions.md`, and the north
> star in `CLAUDE.md` first. North star = *every metric viewable as a graph AND a
> table at the same time.*

---

## 1. Metrics "Compare" mode (period vs period)

**Status:** Planned · **Area:** Metrics page

**What:** A toggle on the Metrics page to switch **into and out of comparison
mode**. In comparison mode the user picks two periods and every metric is shown
for both, with the delta. Preset comparisons:
- **This month vs last month** (MoM)
- **This quarter vs last quarter** (QoQ)
- (natural extensions: year-over-year, and two custom date ranges)

**Why:** Board-grade decisions need "are we up or down, and by how much?" at a
glance — not just the absolute shape. This is squarely on the north star
(*be a weapon with the data*).

**Where (code):**
- `src/views/MetricsView.tsx` — owns the date-range controls and the `ChartCard`
  components. Add a compare toggle + a period picker (presets + custom). Each
  `ChartCard` would render period A vs period B (overlaid series or grouped bars)
  and a delta (absolute **and** %).
- `src/db.ts` — the range fetchers (`fetchRangeAppointments`, etc.) are already
  date-bounded, so comparison = fetch the metric for two ranges and diff. No
  schema change expected.
- `lib/metrics.ts` — pure metric computation; reuse per period.

**Acceptance criteria / notes:**
- Toggling compare mode off returns to the current single-period view unchanged.
- Honor the north star: show graph **and** table together; the table gets a
  delta column (Δ and Δ%). Keep the existing Graph/Table/Both + Export CSV +
  Explore affordances.
- Presets compute the comparison period automatically from the selected period
  (MoM/QoQ/YoY); also allow two arbitrary custom ranges.
- Decide overlay vs side-by-side per chart type (lines overlay cleanly; bars may
  read better grouped) — confirm with the user during build.

---

## 2. Pay staff "Explore" — coach dropdown shows only coaches with rows

**Status:** Planned · **Area:** Pay staff page → "Explore source data" window

**What:** When the explorer is opened (especially via **"Explore this month"**,
which pre-filters to one month), the **Coach** filter dropdown should list **only
coaches that actually have ≥1 row in the current view** — not every coach in the
whole dataset. Empty-result coaches shouldn't be selectable.

**Why:** Opening "Explore this month" for, say, April and seeing 30 coaches in the
dropdown when only 4 had payouts that month is noise. The dropdown should reflect
what's actually on screen.

**Where (code):**
- `src/components/PayExploreModal.tsx` — the `coachOptions` `useMemo` currently
  derives from the *entire* `ledger` + `engagements` regardless of filters. Change
  it to derive from the rows that match the **current month range and active view**
  (ledger / invoices / engagements).

**Acceptance criteria / notes:**
- Open "Explore this month" → the Coach dropdown contains only coaches with rows
  in that month; changing the From/To month range updates the available coaches.
- Switching the view tab (Ledger / Invoices / Engagements) updates the options to
  that view's coaches.
- **Subtlety:** compute the options from rows filtered by everything **except the
  coach filter itself** — otherwise selecting a coach would collapse the dropdown
  to just that coach and you couldn't switch. (Invoices have no native coach; they
  borrow the engine's per-month attribution, so use that.)
- Keep "All coaches" as the first option.

---

## Shipped

_(none yet — move completed items here with the commit/date.)_
