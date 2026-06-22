# Feature backlog

Planned features to build **later** — captured here so they aren't lost. Each
entry has enough context (what, why, where in code, acceptance criteria) to pick
up cold. When one ships, move it to "Shipped" at the bottom (or delete it and note
it in `HANDOFF.md`). Newest ideas on top.

> Orientation: read `HANDOFF.md`, `new_session_instructions.md`, and the north
> star in `CLAUDE.md` first. North star = *every metric viewable as a graph AND a
> table at the same time.*

---

## 1. Raw data — make the Data map its OWN TAB (not a button to a separate page)

**Status:** Planned · **Area:** Raw data tab → "Data map ↗" button / top-nav tabs

**What:** Today the **Data map** is a `btn` on the Raw data tab that opens a whole
separate static page (`/data-map.html`) in a new browser tab. Make it a **first-class
in-app tab** ("Data map") in the top nav instead, so it lives alongside Metrics /
Journeys / etc. — no jumping to a different page.

**Why:** It's a core view, not an afterthought; opening a raw `.html` file in a new
browser tab is jarring and breaks the app shell (no nav, no auth chrome).

**Where (code):**
- `src/App.tsx` — add `"datamap"` to the `Tab` union + `TABS` array + the render
  switch (mirrors how every other tab is wired).
- New `src/views/DataMapView.tsx`. Simplest faithful port: embed the existing
  static page in an `<iframe src="/data-map.html">` sized to the view. Better
  (later): render the map natively in React so it shares auth/theme and can read
  live Supabase (ties into the existing "Data map is a static snapshot" TODO).
- `src/views/RawDataView.tsx` — remove the `Data map ↗` button (lines ~92-93).

**Acceptance criteria / notes:**
- "Data map" appears as a top-nav tab; clicking it shows the map **in-app** (no new
  browser tab); the old button on Raw data is gone.
- Decide iframe (fast, keeps the static snapshot) vs native React (more work, live
  data) — confirm during build. The static page is still served at `/data-map.html`
  either way.

---

## 2. Contextual help — a "?" on every card that side-loads an explainer article

**Status:** Planned · **Area:** Whole dashboard (cross-cutting)

**What:** A small **question-mark icon** on every card / metric / feature. Clicking
it **side-loads** (slide-in drawer, not a navigation) a short **article** explaining
(a) how that function works, (b) the logic behind it, and (c) **exactly which
numbers/columns feed the value** (e.g. "Active mentees = distinct `client_id`s with
a mentoring appointment in the range, placeholder clients excluded").

**Why:** Board users and staff need to *trust* the numbers. Self-serve docs cut
"where does this come from?" questions (literally the Seth-Lehman stage-date
question) and make the dashboard legible without a guided tour. Squarely on the
north star (*be a weapon with the data* — a weapon you understand).

**Where (code):**
- New reusable `HelpButton` + a right-side **drawer** component (reuse the modal
  CSS patterns in `src/styles.css`; the drawer slides from the right rather than
  centering like `ExploreModal`).
- Article content keyed by a stable `helpId`. Start as local **Markdown/MDX** under
  e.g. `src/help/<helpId>.md` (bundled, versioned with the code) — a `help_articles`
  table is overkill for v1 and means another write path. Render with a tiny MD
  component.
- Wire a `helpId` into the existing card chrome: `ChartCard` header actions in
  `MetricsView.tsx` (next to Export CSV / Explore), the Journeys stage rail +
  stat tiles, Pay-staff cards, the capacity card, etc.

**Acceptance criteria / notes:**
- Every card/metric exposes a "?"; clicking opens a side drawer **without leaving
  the page or losing chart state**; Esc / click-away / a close button dismiss it.
- Each article covers **definition + logic + source tables/columns** (and any
  exclusions/edge cases, e.g. group-session handling, `is_excluded`).
- Keyboard-accessible (focus trap in the drawer, `aria-label` on the button).
- Content is authored per feature — ship the framework + a few seed articles, then
  fill in. Keep articles close to the code they describe so they don't rot.

---

## 3. Journeys — exclude a mentee (test/placeholder) from the list + metrics

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

## 4. Discovery → conversion chart — click a column to explore that month's calls

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

## 5. Sticky range/preset bar — "freeze" the period + mode controls to the top

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
