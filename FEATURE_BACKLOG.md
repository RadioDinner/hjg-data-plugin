# Feature backlog

Planned features to build **later** — captured here so they aren't lost. Each
entry has enough context (what, why, where in code, acceptance criteria) to pick
up cold. When one ships, move it to "Shipped" at the bottom (or delete it and note
it in `HANDOFF.md`). Newest ideas on top.

> Orientation: read `HANDOFF.md`, `new_session_instructions.md`, and the north
> star in `CLAUDE.md` first. North star = *every metric viewable as a graph AND a
> table at the same time.*

---

## 1. Pay staff "Explore" — coach dropdown shows only coaches with rows

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

### Metrics "Compare" mode (period vs period) — session 006, 2026-06-22

Toggle on the Metrics page to compare **Period A vs Period B**. Shipped as
**"Both"** (the user's choice): a board **scorecard** card — grouped A/B bars for
the four headline KPIs plus a delta table covering *every* metric with Δ
(absolute) and Δ% (vs Period B) — **and per-chart overlays**: Period B is drawn
as a paired bar on the bar charts and a dashed reference line on the line /
composed charts, and each card's table gains B + Δ columns in compare mode.
Presets **MoM / QoQ / YoY** auto-derive a **span-aligned** Period B from Period A
(so year-to-date stays comparable to year-to-date), plus free **custom** A/B
ranges. Pure math in `lib/compare.ts` (`shiftMonths`, `derivePeriodB`, `delta`),
re-exported through `src/db.ts`; locked by **verify §10**. Toggling compare off
returns the view to the exact single-period state (acceptance #1).
