# Feature backlog

Planned features to build **later** — captured here so they aren't lost. Each
entry has enough context (what, why, where in code, acceptance criteria) to pick
up cold. When one ships, move it to "Shipped" at the bottom (or delete it and note
it in `HANDOFF.md`). Newest ideas on top.

> Orientation: read `HANDOFF.md`, `new_session_instructions.md`, and the north
> star in `CLAUDE.md` first. North star = *every metric viewable as a graph AND a
> table at the same time.*

---

## 1. Journeys — exclude a mentee (test/placeholder) from the list + metrics

**Status:** Planned · **Area:** Journeys tab (+ Metrics aggregates)

**What:** A way to **remove a mentee** (e.g. **Arthur Nisly**, a test account) from
the Journeys search list **and** from the data used to build pipeline metrics —
especially the "time in system" / pipeline-timing aggregates.

**Why:** Test/placeholder accounts muddy the board-level pipeline-leg averages and
clutter the searchable list.

**Where (code):**
- There's already an exclusion mechanism: **`ca_clients.is_excluded`** (honored by
  `fetchRangeAppointments` and `fetchMenteeJourneys`, which skip excluded clients)
  and **`EXCLUDE_CLIENT_NAMES`** in `lib/config.ts` (compile-time list). Two ways to
  do the UI version:
  - **(a)** A per-mentee **"Exclude from metrics"** toggle persisted to an HJG-owned
    table (like `mentee_outcomes` — RLS, staff-writable), checked everywhere
    journeys/metrics are built. Cleanest reversible UI path.
  - **(b)** A button that sets `ca_clients.is_excluded` — but that column is
    sync-owned and a re-sync could flip it back; avoid unless sync preserves it.
- Touch points: `JourneysView` list (`filtered`) + `PipelineSummary`
  (`aggregateJourneyDurations`) + ideally the Metrics tab so the same client is
  excluded dashboard-wide.

**Acceptance criteria / notes:**
- Clicking "exclude" on a mentee removes them from the Journeys list (or greys them
  with an "excluded" badge + an "include" toggle to undo); **persisted** across
  reloads; **reversible**.
- Excluded mentees drop out of **PipelineSummary** aggregates and the per-mentee
  "time in system" stats.
- Decide whether exclusion is **Journeys-only** or **dashboard-wide** (recommend
  dashboard-wide, mirroring how `is_excluded` already works) — confirm during build.

---

## 2. Discovery → conversion chart — click a column to explore that month's calls

**Status:** Planned · **Area:** Metrics page → "Discovery → conversion" card

**What:** Clicking a **column** in the Discovery → conversion chart opens a
**popout** listing the **discovery calls that built that column** — date, prospect,
type, and **outcome** (converted / pending / not converted / no-show + source).

**Why:** Drill-down to audit *what made a bar that height*, scoped to the clicked
month (more targeted than the card-level "Explore", which shows the whole range).

**Where (code):**
- `MetricsView.tsx` — the conversion `ComposedChart`. Recharts gives an `onClick`
  with the active payload (the month label) on the chart or `<Bar>`. Reuse the
  existing **`ExploreModal`** and the **`exploreDiscoveryRaw()`** builder, but
  **filter to the clicked month** (`byMonth` already buckets appts by `YYYY-MM`).

**Acceptance criteria / notes:**
- Clicking a column opens the Explore modal **pre-filtered to that month's**
  discovery calls (sortable, CSV — same affordances as today).
- A clear title (e.g. "Discovery calls — Jun 2026"); clicking other charts is
  unaffected.
- In **compare mode**, click uses Period A's month (and could note Period B) —
  confirm the exact behavior during build.

---

## 3. Sticky range/preset bar — "freeze" the period + mode controls to the top

**Status:** Planned · **Area:** Metrics page (consider other tabs later)

**What:** The range presets (**This month / Last month / This quarter / …**) and the
**Compare** toggle (+ Period A/B inputs) should **freeze to the top** of the page so
that when you scroll down you don't have to scroll back up to change the time period
or the mode.

**Why:** The Metrics page is long; changing the period currently means scrolling all
the way up.

**Where (code):**
- `MetricsView.tsx` — the `.range` block (and the compare Period B row). CSS
  `position: sticky; top: <header offset>` on a wrapper, with a **solid background**
  + `z-index` so charts don't bleed through, in `src/styles.css` (`.range`).
- Mind the app's existing top nav/header height so the sticky bar sits **below** it,
  not under it.

**Acceptance criteria / notes:**
- The preset/date/compare controls stay pinned and usable while scrolling Metrics
  content; solid background; no awkward overlap with card headers.
- Works on the Metrics tab; decide later whether Journeys/Pay-staff get the same.

---

## Shipped

### Contextual help — "?" drawer framework + seed articles — session 006b, 2026-06-22

A reusable **`HelpButton`** ("?") that side-loads a short explainer into a **right-side
slide-in drawer** (not a navigation — chart state is preserved; Esc / click-away /
Close dismiss it; focus moves into the drawer; `aria-label` + `role="dialog"`).
Articles are authored as Markdown strings in **`src/help/articles.ts`** keyed by a
stable `helpId` (bundled/versioned with the code — no `help_articles` table, no extra
write path), rendered by a tiny dependency-free Markdown renderer in
**`src/components/HelpDrawer.tsx`** (## / ### / - lists / **bold** / \`code\` / >
notes). Each article covers **definition + logic + source tables/columns**. Wired in
additively via an optional **`helpId` prop on `ChartCard`** (zero change for cards
that don't opt in) across the Metrics cards (Discovery, Meetings, Active mentees,
Mentors, Discovery→conversion, Compare), plus standalone buttons on **Pay staff**,
**Build payout**, and the **Journeys** pipeline-timing card. Framework is ready —
drop a `HelpButton` + an article entry to cover more cards later. ⚠ Not
browser-verified (headless container).

### Raw data — Data map promoted to its own in-app tab — session 006b, 2026-06-22

The interactive data-relationship map is now a **first-class top-nav tab** ("Data
map") instead of a button that launched the static `/data-map.html` in a separate
browser tab (which broke the app shell — no nav, no auth chrome). New
`src/views/DataMapView.tsx` embeds the existing static D3 page in an **iframe**
sized to the view (the fast, faithful option — keeps the snapshot; native-React
rendering with live Supabase is the later upgrade), with a **"Full screen ↗"**
convenience link that still opens `/data-map.html` directly. The old "Data map ↗"
button on the Raw data tab is gone. Tab wired in `src/App.tsx` (between Raw data and
Admin). ⚠ Not browser-verified (headless container).

### Pay staff — "Build payout" interactive review / builder — session 006b, 2026-06-22

A human review-and-assemble layer over the automated payroll engine, shipped as a
**full top-nav tab** ("Build payout") — the user's choice over a modal. Pick a
**mentor + service month** and every engine-computed line for that coach/month is
listed (mentee, tier, billed, active days, split, engine payout). Each line has an
**include/exclude checkbox** and a **per-line override + note**; a **running total
side panel** updates live (built total, engine total, review delta, included/
dropped/overridden counts). Reviews **persist** to a new HJG-owned `payout_builds`
table (**migration `9989_payout_builds.sql`**, staff RLS, one row per coach+month):
**Save draft → Approve → Reopen**, plus **Discard** and **CSV export**. The month
dropdown badges saved months (draft / approved ✓). The engine's numbers are **never
mutated** — overrides live only in the review record (read-only toward CA). Pure
math in **`lib/payBuild.ts`** (`summarizeBuild`, `effectiveLinePayout`,
`isDefaultLineState`), re-exported through `src/db.ts` and locked by **verify §13**.
Unassigned (no-coach) billed revenue for the month is surfaced as an info banner,
not silently hidden. A **"Build payout →"** button on the Pay-staff tab cross-links
in. ⚠ Needs **9989 applied** + (as ever) invoices synced; **not browser-verified**
(headless container). `src/views/BuildPayoutView.tsx`, `src/App.tsx`.

### Pay staff "Explore" — coach dropdown scoped to the active view — session 006, 2026-06-22

The **Coach** filter in the Pay-staff "Explore source data" window now lists only
coaches with **≥1 row in the active view** (Ledger / Invoices / Engagements) under
the **current month range, tier, and text filters** — not every coach in the whole
dataset. The options are computed from everything **except** the coach filter
itself, so picking a coach never collapses the dropdown to just that coach. "All
coaches" stays first; if the selected coach drops out of the options (e.g. after
narrowing the month range or switching views) it auto-falls-back to All coaches so
the table isn't stuck empty behind a stale selection. Invoices (no native coach)
use the engine's per-month attribution (`coachByClientMonth`). The `overlaps`
month-range predicate was factored out and shared with the Engagements view.
`src/components/PayExploreModal.tsx`.

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
