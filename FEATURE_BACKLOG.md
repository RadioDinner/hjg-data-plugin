# Feature backlog

Planned features to build **later** — captured here so they aren't lost. Each
entry has enough context (what, why, where in code, acceptance criteria) to pick
up cold. When one ships, move it to "Shipped" at the bottom (or delete it and note
it in `HANDOFF.md`). Newest ideas on top.

> Orientation: read `HANDOFF.md`, `new_session_instructions.md`, and the north
> star in `CLAUDE.md` first. North star = *every metric viewable as a graph AND a
> table at the same time.*

---

_No planned items right now — the session-006/006b backlog is fully shipped (see
below). Add new ideas here, newest on top._

---

## Shipped

### Maps tab — Data map + Payments visual — session 006c, 2026-06-22

Consolidated the "Data map" tab into a single **"Maps"** top-nav tab with a Data map /
Payments segmented toggle (`src/views/MapsView.tsx`, replacing `DataMapView.tsx`). Added
a self-contained, dependency-free **payments explainer** at **`public/pay-map.html`** that
teaches the Clayton two-month split — the rule + the formulas. **Shareable with mentors:**
it's a real static file served at `/pay-map.html` *outside* the app's login gate (Vercel
serves files before the SPA rewrite), and works offline if saved.

Expanded the calculator to a **3-mentee** model (defaults **Alex Arnold** $425 d12, **Bob
Boyd** $265 d5, **Chase Chester** $145 d22 — names/amounts/days editable): one mentor-rate
selector (35/50/60), a per-mentee split bar (paid-this-month vs rolls-next + full share),
and a combined **"monthly paycheck"** view — stacked-by-mentee bars over 4 months (first
partial → two steady-full → tail partial) + a table, all computed live so it reconciles
(steady = Σ full; first + tail = one full month). No migration. ⚠ Not browser-verified.

### Pay engine — rewritten to match Clayton's two-month split — session 006c, 2026-06-22

After the user reconstructed the former admin's (Clayton's) method, `lib/pay.ts` was
rewritten from the old active-days-in-service-month model to **Clayton's two-month
split**: an invoice dated on day D of its month is split by `elapsed = D/30` (**fixed
30-day** month, user's choice) — the **remaining** part `(1−elapsed)` pays in the
invoice's month, the **elapsed** part rolls into the **next** month. A payout month =
this month's invoices × (1−elapsed) + last month's invoices × their elapsed, all ×
the mentor's rate. Each invoice's two slices add back to its full share (made whole,
no catch-up). **Kept** (the one deliberate divergence from Clayton, per 2026-06-19):
the 35/50/60 ramp is by **MENTOR** tenure. Proration keys off the invoice **`date_of`
day** (now loaded; was month-only). `PayMenteeLine`/`PayLedgerRow` gained
`invoiceDay` / `recognizedThis` / `rolloverPrev`; payout months now include the
**rollover tail** (a final invoice still pays its elapsed slice the next month).
Wired through Pay staff, the Explore window, and Build payout; **verify §8/§9**
rewritten and locked to Clayton's Alex-Arnold walkthrough; `docs/legacy-pay-calculator.md`
§7 updated. **No migration** (invoice dates already mirrored — re-sync only if
`date_of` is stale). ⚠ Not browser-verified.

### Metrics — "Meetings to Freedom!" card — session 006c, 2026-06-22

User-requested new metric card on the **Metrics** tab: per **graduated** mentee, the
number of **1-on-1 mentoring sessions** (4x / 2x / 1x) between the **completion of
JumpStart Your Freedom** and **graduation** (group sessions excluded). Window start =
the JumpStart engagement's **end date** (user's choice), falling back to first
ongoing-tier entry if no end date; window end = graduation (After-Graduation-Care
engagement or a manual "graduated" override). Shows avg / median / n / range tiles +
per-mentee bars + a table (graph AND table, north star); graduates missing an endpoint
are reported as "omitted". **All-time** (not range-scoped). Pure math in
**`lib/freedom.ts`** (`computeMeetingsToFreedom`), re-exported via `src/db.ts`, locked
by **verify §14**. Needed plumbing: `ca_engagements.end_date` threaded through the
journeys layer → new `MenteeJourney.jumpstartEndDate`. **No migration** (end_date
already mirrored). Has a "?" help article (`metrics.freedom`). ⚠ Not browser-verified.

### Contextual help — expanded coverage (capacity, resource, Discovery, Raw data, Company options) — session 006c, 2026-06-22

Followed up the session-006b help framework by wiring the "?" drawer into the cards/
tabs it didn't cover yet, with new articles in `src/help/articles.ts`: **Mentor
capacity utilization** (`metrics.capacity` — the group-session/Arthur-Nisly fix),
**Resource engagement** (`metrics.resource`), the **Discovery tab** (`discovery.tab`),
the **Raw data tab** (`raw.data`), and the **Company options tab** (`company.options`).
Each covers definition + logic + source tables. Additive (same `HelpButton`); no
migration. ⚠ Not browser-verified.

### Journeys — exclude a mentee (test/placeholder), dashboard-wide — session 006b, 2026-06-22

A reversible, persisted way to hide a test/placeholder mentee (e.g. Arthur Nisly)
from the dashboard. New HJG-owned **`mentee_exclusions`** table (**migration
`9988_…`**, staff RLS, one row per `client_id`) — a staff-owned sibling of the
compile-time `ca_clients.is_excluded` flag, so excluding is a click, not a code
change or a re-sync risk. **Dashboard-wide:** an excluded client is dropped from
`fetchRangeAppointments` (Metrics) and from the Journeys pipeline-timing aggregates
(`aggregateJourneyDurations` + the active/graduated counts). In the **Journeys** tab
the mentee stays in the list **greyed + struck-through with an "excluded" badge**,
and the detail panel gains an **"Exclude from metrics" / "Include in metrics"**
toggle, so it's fully reversible. The pipeline-timing card notes how many mentees are
excluded. `mentee_exclusions` added to the Raw-data viewer. `src/db.ts`
(`fetchExcludedClientIds` / `addMenteeExclusion` / `removeMenteeExclusion`),
`src/views/JourneysView.tsx`. ⚠ Needs **9988 applied**; not browser-verified.

### Metrics — sticky range/preset bar — session 006b, 2026-06-22

The range presets + date inputs + **Compare** toggle now **freeze to the top** of the
Metrics page while you scroll (the top nav isn't fixed, so the `.range` block is
`position: sticky; top: 0`). Solid page background + `z-index: 20` + a bottom border
so charts don't bleed through. Pure CSS in `src/styles.css` (`.range`); no markup
change. Applies to the Metrics tab (the only place `.range` is used). ⚠ Not
browser-verified.

### Metrics — Discovery→conversion drill-down (click a bar) — session 006b, 2026-06-22

Clicking a **bar** in the Discovery → conversion chart opens the existing **Explore**
modal **pre-filtered to that month's** discovery calls (signup date, prospect, type,
outcome + source — sortable, CSV), titled e.g. "Discovery calls — Jun 2026". The
month key is threaded through the chart row (`_key`) so the click maps the label back
to `YYYY-MM`, and the drill-down is built from the exact rows that made the bar (it
always reconciles). Single-period only — inert in **compare mode** (the chart shows
the index-aligned A/B overlay there). `src/views/MetricsView.tsx`
(`exploreConversionMonth`). ⚠ Not browser-verified.

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
