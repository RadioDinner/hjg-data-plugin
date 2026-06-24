# Feature backlog

Planned features to build **later** — captured here so they aren't lost. Each
entry has enough context (what, why, where in code, acceptance criteria) to pick
up cold. When one ships, move it to "Shipped" at the bottom (or delete it and note
it in `HANDOFF.md`). Newest ideas on top.

> Orientation: read `HANDOFF.md`, `new_session_instructions.md`, and the north
> star in `CLAUDE.md` first. North star = *every metric viewable as a graph AND a
> table at the same time.*

---

### Unique 3-digit identifier on every card / modal / screen — requested session 008, 2026-06-24

**What.** Give **every self-contained section of data** — each ChartCard, each tab/screen,
each pop-out modal, each editor card, each table panel — a **stable, unique 3-digit number**
(e.g. `042`) shown unobtrusively (a small muted badge in the corner/header). So the user can
say "fix screen 118" or "the number on card 207 is wrong" and we both know exactly which
element. Do it **comprehensively** — every identifiable UI unit gets one.

**Why.** The dashboard has grown to many cards/tabs/modals; referring to them in conversation
is ambiguous ("the conversion card", "that pay table"). A durable numeric ID per element makes
support, bug reports, and design discussion precise and fast.

**Where in code / approach.**
- Build a **central registry** (e.g. `src/uiRegistry.ts`) mapping a stable string key →
  3-digit number, so numbers are assigned once and never shift. A tiny **`<SectionId id="042" />`**
  badge component renders the number (absolute-positioned, muted, `title="Section 042"`); add it
  to a shared wrapper so it's consistent.
- Wrap the existing shells: `ChartCard` (Metrics), `card`/`card--inset` panels, the top-nav tab
  screens (`App.tsx` tab views), `modal`/`HelpDrawer`/`PayExploreModal`/`Explore` pop-outs, the
  editor cards (Mentee record, graduation editor), the Raw-data table panels, etc.
- **Numbering scheme:** allocate by area so ranges are mnemonic — e.g. 0xx Metrics, 1xx Journeys,
  2xx Pay/Build, 3xx Raw data, 4xx Company options/Admin, 9xx modals/drawers. Keep an index
  (a table in this file or a `UI_INDEX.md`) listing number → element so the map is browsable.
- **Stability rule:** numbers are append-only; never renumber an existing element (retire a number
  if an element is deleted, don't reuse it). A dev-only check could warn on duplicate/missing ids.

**Acceptance criteria.**
- Every card, modal, drawer, table panel, and screen shows a unique, stable 3-digit id.
- A single registry is the source of truth; a printed/committed index lists them all.
- Adding a new section is a one-liner (register a key, drop in the badge) and never disturbs
  existing numbers. Badges are unobtrusive (toggleable/devtools-style is acceptable if the user
  prefers them hidden by default).

---

### Search / sort / filter in the Raw-data tables — requested session 008, 2026-06-24

**What.** Make the **Raw data** tab tables searchable, sortable, and filterable — like the Pay
"Explore" window already is. Each `ca_*`/HJG table view should support: a **free-text search**
across columns, **click-to-sort** any column (tri-state), and **per-column filters** (at least
text contains / equals; ideally typed filters for dates and numbers).

**Why.** Raw-data tables can have thousands of rows (`ca_appointments` ~3.9k, `ca_invoices`
~1.3k). Today they're static dumps with CSV export only; finding a specific client/invoice means
exporting to Excel. In-app search/sort/filter makes the Raw-data tab actually usable for lookups.

**Where in code.** `src/views/RawDataView.tsx` renders each table. The reusable
**`src/components/SortableTable.tsx`** (built session 005b — tri-state header sort + CSV of the
sorted view) and the **`PayExploreModal`** filter pattern (month/coach/tier/text filters) are the
templates — `RawDataView` should adopt `SortableTable` and add a filter bar. Keep the existing
per-table CSV export and the **Export-all `.xlsx`** untouched.

**Acceptance criteria.**
- Every Raw-data table: free-text search, click-to-sort columns, and at least text column filters.
- CSV export reflects the current filtered + sorted view (as `SortableTable` already does).
- Performant on the largest tables (virtualize or cap+paginate if needed; note any cap per the
  "no silent truncation" rule).

---

### Combine "Pay staff" + "Build payout" into one screen — requested session 008, 2026-06-24

**What / rework.** Fold **Build payout** into the **Pay staff** tab instead of a separate top-nav
tab. Build payout should **launch from within Pay staff** (e.g. a "Build payout →" action on a
mentor/month, opening the builder inline or as a panel/modal), since it's a workflow *on top of*
the pay numbers, not a parallel destination.

**Why.** The two tabs share the same engine and data (`lib/pay.ts`, `lib/payBuild.ts`) and the
same mental model (per-mentor, per-month payout). Two separate top-nav tabs split a single flow.
A cross-link already exists ("Build payout →" button on Pay staff, added session 006) — this
finishes the consolidation so Build payout is a sub-mode of Pay staff, freeing a top-nav slot.

**Where in code.** `src/App.tsx` (remove the standalone "Build payout" tab), `src/views/
PayStaffView.tsx` + the Build-payout view/component — host the builder inside Pay staff (a
month/mentor → "Build payout" opens it scoped to that selection). Engine and `payout_builds`
persistence (migration 9989) are unchanged; this is UI/navigation only.

**Acceptance criteria.**
- No separate "Build payout" top-nav tab; it launches from Pay staff scoped to the chosen
  mentor/month.
- All current Build-payout capability preserved (draft/approve/reopen/discard, overrides, CSV).
- Pay staff remains the single home for everything payout.

---

### "Mentees" table — internal source-of-truth for each person — ✅ SHIPPED session 008 (2026-06-24) — requested session 008, 2026-06-24

**What.** A single **`Mentees`** table that is HJG's internal *source of truth* for
managing each person, assembled from data we already mirror/own. One row per mentee.
Its originating row comes from **`ca_clients`** (the CA-synced person record), then we
**fold in that person's discovery call and its outcome (`discovery_outcomes`) and their
pipeline outcome (`mentee_outcomes`)** so the whole arc — *who they are → their discovery
call result → where they ended up* — lives in one place. The user's framing: "every one
of our mentees will have a discovery call and a subsequent outcome," so those two facts
belong on the mentee record, not scattered across three tables.

**Why.** Today a mentee's identity (`ca_clients`), their discovery result
(`discovery_outcomes`), and their journey outcome (`mentee_outcomes`) are three separate
tables joined on `client_id` at read time (see `fetchMenteeJourneys`, the Discovery tab,
`MenteeStatusEditor`). There's no one object that says "this is the mentee, here's their
discovery outcome, here's their current status." A consolidated `Mentees` view/table makes
internal management, board reporting, and future write-back far simpler, and gives every
downstream view (Journeys, Metrics, Pay) one canonical mentee object to read.

**Where in code / data.** Join key is **`client_id` = `ca_clients.id`** across all three:
- `ca_clients` (sync-written, `9999_init.sql`): `id` (CA Client.ID, PK), `name`,
  `first_name`, `last_name`, `email`, `is_active`, `is_excluded`, `synced_at`.
- `discovery_outcomes` (HJG-owned, staff RLS, `9999_init.sql`): `client_id`,
  `appointment_id` (soft ref `ca_appointments.id`; null = manually logged), `outcome`
  ∈ {`converted`,`not_converted`,`pending`,`no_show`}, `follow_up_on`, `notes`, audit cols.
  **Unique per `appointment_id`, NOT per client** — a person can have more than one
  discovery call / outcome row.
- `mentee_outcomes` (HJG-owned, staff RLS, `9995_mentee_outcomes.sql`): **unique per
  `client_id`** (one row per mentee), `status` ∈ {`active`,`graduated`,`quit`,`fired`},
  `status_date`, `notes`, audit cols. Override that already "wins" over inferred status.
- Read paths to reuse/replace: `src/db.ts` (`fetchMenteeJourneys`, discovery/outcome
  fetchers, `mentee_outcomes` read/write), `mentee_exclusions` (`9988`) as a sibling
  staff-owned table, and the registry/RLS shape of the other HJG tables.

**⚠ Reality check on the premise (verified against the schema/code, session 008).**
The data does *not* guarantee "every mentee has a discovery call and a subsequent
outcome," so the table can't assume it:
- The discovery **call** event lives in **`ca_appointments`** (category
  `discoveryPhone`/`discoveryZoom`), *not* in `discovery_outcomes`. `discovery_outcomes`
  only stores the **staff override** of the auto-computed outcome — if staff never
  override, there is **no row** and the outcome is derived at read time
  (`resolveDiscoveryOutcome`). So a converted mentee can have **zero** `discovery_outcomes`
  rows. The originating discovery date/outcome may need to come from `ca_appointments`
  + the read-time resolver, with `discovery_outcomes` layered on only where present.
- `mentee_outcomes` is likewise **optional** — most mentees have no row and get an
  *inferred* status (active/inactive/graduated); a row exists only on staff override.
- `ca_clients` also holds prospects who never converted and excluded placeholder/group
  "clients" (`is_excluded`). The reliable per-mentee **spine is `ca_clients`**; the two
  outcome tables are **sparse override layers** soft-joined on `client_id` (no FK).

**Design decisions to make (capture before building):**
- **View vs materialized table vs synced table.** Cleanest first cut is likely a
  **SQL view** (`mentees`) that LEFT JOINs `ca_clients` ← `mentee_outcomes` ← a
  *picked* `discovery_outcomes` row — zero new write surface, always fresh, read-only
  (consistent with "read-only toward CA"). A real table only if we need to *edit* fields
  that don't already live in an HJG-owned table. **Recommend the view first.**
- **Which discovery outcome?** Since `discovery_outcomes` is per-appointment, decide the
  rule for the single value folded onto the mentee: latest by date, the *converting* one
  if present, or expose both a `discovery_outcome_latest` and a count. (Most mentees have
  one; some have re-books / no-shows then a later convert.)
- **Who is a "mentee"?** All `ca_clients` minus `is_excluded` and `mentee_exclusions`?
  Or only those with ≥1 discovery call / ≥1 mentoring engagement? The user says every
  mentee has a discovery call — but the *data* may have clients with no logged
  `discovery_outcomes` row; decide whether those still appear (with nulls) or are filtered.
- **Surface.** Add to the **Raw data** tab viewer at minimum; consider a dedicated
  **Mentees** tab (searchable/sortable `SortableTable`, CSV export) as the internal
  roster. North-star: also expose any rolled-up counts as graph + table.

**Acceptance criteria.**
- One row per mentee keyed on `ca_clients.id`, carrying identity (name/email/active),
  their discovery outcome (per the chosen picking rule), and their journey status
  (`mentee_outcomes`, override-aware) — joinable with zero client-side stitching.
- Re-runnable migration (descending number — **next is `9986_…`**), staff-RLS if a real
  table; a view inherits the base tables' RLS. Appears in the Raw-data viewer.
- Excluded/placeholder clients handled explicitly (filtered or flagged, documented).
- Verify coverage if any non-trivial picking/derivation logic lands in a pure `lib/` module.

---

## Shipped

### "Margins" tab — staff-hours vs delivered-hours, by program — ✅ SHIPPED (bones) session 009, 2026-06-24

New top-nav **Margins** tab (`src/views/MarginsView.tsx`) with **JumpStart Your Freedom** +
**Mentoring** sub-tabs. Each: a by-month **graph + table** (north star) comparing entered **staff
hours** (new `program_hours` table, migration `9981`, save-on-blur) against **delivered meeting
hours** (distinct coach+start-time sessions under the program's tiers) + a delivered÷staff ratio.
Pure merge in `lib/margins.ts` (verify §17). **Dollars deferred** — hours bones only, per request.

Follow-up (done same session): **real per-meeting durations** — CA's `Appointment.endDate` is now
synced to `ca_appointments.end_raw` (migration `9980`); delivered hours use the actual
`end − start` per session, falling back to `PROGRAM_MEETING_HOURS` (1 h) only when no end is
recorded. **Still open: the money layer** (staff cost + program revenue → real margins).

### Pipeline-timing card — mentee filters (Journeys) — ✅ SHIPPED session 009, 2026-06-24

A composable filter bar on the Journeys "Pipeline timing" card (`PipelineSummary` in
`src/views/JourneysView.tsx`): **Active within** (last 3/6/12/24 months, by most-recent
activity), **Status** (active/graduated/exited), **Current tier**, **Owner** (primary coach),
and an **Overridden graduation date** checkbox. The cohort feeds the graph, table, and tiles;
"Showing N of M" + Clear filters; filters are ephemeral local state. Roster/excluded scoping
still applies on top.

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
