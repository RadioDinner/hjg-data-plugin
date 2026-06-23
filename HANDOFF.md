# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-06-22 (session 006c).

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously**. See
> `CLAUDE.md` for standing goals, `new_session_instructions.md` for standing
> orders (session logs, prompt history), and `CSHARP_PORT.md` for the C# track.

## Resume here (live state — 2026-06-22, session 006c — WRAPPED)

Picking this up cold — start here. Both session-006b migrations (`9989`, `9988`) are
**applied** (per the user). **Session 006c** (after the backlog emptied) shipped:
- **Metrics tab reorder + merge.** Folded the standalone "Discovery calls" card into the
  conversion card (now **"Discovery calls → conversion"** — adds total/Phone/Zoom tiles)
  and moved it + **Meetings to Freedom!** to the **top** of the Metrics page (above the KPI
  strip). Removed the now-dead `DiscoveryTooltip`/`TipEntry`, `cmpDiscovery`,
  `discoveryCompareTable`, `discoveryTable`. `MetricsView.tsx` only; no migration.
- **"Maps" tab** (`src/views/MapsView.tsx`, replaced `DataMapView.tsx`): one top-nav tab
  with a **Data map / Payments** toggle (iframes `public/data-map.html` + the NEW
  `public/pay-map.html`). `pay-map.html` is a self-contained, dependency-free explainer of
  the Clayton split with a **3-mentee** calculator (Alex/Bob/Chase, editable) + a combined
  monthly-paycheck view. **Shareable with mentors** — served at `/pay-map.html` *outside*
  the login gate (real static file beats the SPA rewrite), works offline if saved. **No
  migration.**
- **Pay engine rewritten to Clayton's two-month split** (`lib/pay.ts`). An invoice
  dated day D splits by `elapsed = D/30` (**fixed 30-day**): `(1−elapsed)` pays in the
  invoice's month, `elapsed` rolls to the next. Payout month = this month's invoices ×
  (1−elapsed) + last month's × their elapsed, × the **per-MENTOR** ramp (35/50/60 —
  kept from 2026-06-19). Proration keys off the invoice **`date_of` day** (now loaded).
  `PayMenteeLine`/`PayLedgerRow` gained `invoiceDay`/`recognizedThis`/`rolloverPrev`;
  payout months include the **rollover tail**. Pay staff + Explore + Build payout all
  use it; **verify §8/§9** rewritten to Clayton's Alex example; legacy doc §7 updated.
  **No migration** — but **re-sync if `ca_invoices.date_of` lacks the day** (else every
  invoice prorates as day-1). Decisions: per-mentor ramp, `date_of` date, fixed-30
  (the user's March 38.7% implies actual-days, but they chose 30 — Mar 12 → 40%).
- **"Meetings to Freedom!" metric card** (user request) on the **Metrics** tab — per
  graduated mentee, 1-on-1 mentoring sessions (4x/2x/1x) from JumpStart completion
  (the JumpStart engagement **end date**, fallback first ongoing-tier entry) to
  graduation; group sessions excluded. Avg/median/n/range tiles + per-mentee bars +
  table; all-time (not range-scoped). Pure `lib/freedom.ts` (`computeMeetingsToFreedom`,
  **verify §14**); threaded `ca_engagements.end_date` → `MenteeJourney.jumpstartEndDate`.
  **No migration.** Has a "?" article.
- **Expanded contextual-help "?" coverage** to Mentor capacity, Resource engagement,
  the Discovery / Raw data / Company options tabs (new articles in `src/help/articles.ts`).
- **Conversion bars color-coded by outcome + channel.** The Discovery→conversion bars are
  stacked by outcome (soft palette: sea-green/gold/coral/slate) AND split by channel —
  **Zoom = solid, Phone = grid pattern** (SVG `<defs>`); `convData` carries per-outcome
  phone/zoom counts (`OUTCOME_COLORS`/`OUTCOME_ORDER`).
- **★ Full visual redesign — professional, crisp, light + dark (the last 006c item).**
  New **`src/theme.tsx`** `ThemeProvider` writes `<html data-theme>` (persisted to
  localStorage `hjg.theme`, falls back to OS pref); a **toggle** sits in the topbar and
  `index.html` sets the theme **pre-paint** (no flash). `styles.css` was rebuilt around a
  **light (default) + dark** token set with a crisp business feel: **small radii** (6px
  cards / 4px controls + pills), 1px borders, restrained shadows, a refined **blue accent**;
  pills/badges/notices use shared semantic **tone tokens** so both modes read well. Charts
  are theme-aware via **`useChartTokens()`** (axis/grid/tooltip/accent/cmp per theme) —
  `MetricsView` / `PayStaffView` / `JourneysView` derive them per render (recharts can't
  read CSS vars). The embedded **Maps follow the theme**: `MapsView` passes `?theme=`, and
  both `public/data-map.html` + `public/pay-map.html` gained a light palette + a pre-paint
  bootstrap. **No migration.**

All 006c work is **no migration, no schema change** (except the pay-engine re-sync caveat
below). `typecheck` + `verify` (**14 sections**) + `build` all pass. **UI NOT browser-tested**
(headless) — eyeball both themes + the charts on a Vercel preview. **`FEATURE_BACKLOG.md`
has no planned items.**

**▶ Next-session checklist:**
1. **Browser-verify both themes** (toggle in the topbar) across every tab — especially the
   recharts cards (axis/grid/tooltip), the color-coded conversion bars, and the two Maps.
2. **Re-sync if needed** so `ca_invoices.date_of` carries the day (else Clayton proration
   treats every invoice as day-1). Quick check: Raw data → `ca_invoices` → `date_of` shows
   real days, not `-01`.
3. Optional polish: the Pay-staff "Billed" reference bar is still a fixed `#334155`;
   per-mentee colors in `pay-map.html` are CSS-var driven now but the Period-B/`CMP` and a
   few series colors are fixed mid-tones (read on both, not theme-perfect).

---

## Resume here (live state — 2026-06-22, session 006b — WRAPPED)

Picking this up cold — start here. **Session 006b shipped 6 features straight to
`main`** (per the user) and **emptied `FEATURE_BACKLOG.md`** (everything moved to its
"Shipped" section). Working tree clean, all pushed. Before push each commit passed
`typecheck` + `verify` (now **13 sections**) + `build`. **UI not browser-tested**
(headless container) — eyeball the 6 features on a Vercel preview.

**⚠ TWO new migrations this session — both MUST be applied** (Supabase SQL Editor):
`9989_payout_builds.sql` (Build payout) and `9988_mentee_exclusions.sql` (Journeys
exclude). Until each is applied its writes error (Save/Approve/Discard; Exclude/
Include). Both staff-RLS, one row per key, re-runnable.

**Shipped this session (006b):**
- **Build payout — interactive review/builder (backlog #1).** A full top-nav tab
  ("Build payout") that layers human review over the payroll engine: pick a mentor +
  month → every engine line is listed with an include/exclude checkbox, a per-line
  **override + note**, and a live **running-total** side panel (built vs engine total,
  delta, counts). **Persists** to `payout_builds` (migration 9989): **Save draft →
  Approve → Reopen**, **Discard**, **CSV export**; month dropdown badges saved
  months. Engine numbers are never mutated (overrides live only in the review record;
  read-only toward CA). Pure math in **`lib/payBuild.ts`** (re-exported via `db.ts`),
  locked by **verify §13**. Cross-linked from the Pay-staff tab via a "Build payout →"
  button. New tab in `src/App.tsx`; `payout_builds` added to the Raw-data viewer.
  ⚠ **Not browser-verified** (headless container) — browser/Vercel-preview check the
  tab, the save/approve/reopen/discard round-trip (after 9989), overrides, CSV.
- **Data map → its own in-app tab (backlog #1, the old #2).** The data-relationship
  map is now a **top-nav tab** ("Data map", between Raw data and Admin) instead of a
  button opening `/data-map.html` in a new browser tab. `src/views/DataMapView.tsx`
  embeds the static D3 page in an **iframe** (fast/faithful; native-React + live
  Supabase is the later upgrade) with a "Full screen ↗" link; the old Raw-data button
  is removed. **No migration.** ⚠ Not browser-verified.
- **Contextual help — "?" drawer framework + seed articles (backlog, the old #3).** A
  reusable **`HelpButton`** opens a right-side **slide-in drawer** with a short
  explainer (definition + logic + source tables). Articles are Markdown strings in
  **`src/help/articles.ts`** (keyed by `helpId`); tiny renderer + drawer in
  **`src/components/HelpDrawer.tsx`**. Wired additively via an optional **`helpId` on
  `ChartCard`** (Metrics cards) + standalone buttons on Pay staff, Build payout, and
  Journeys pipeline-timing. **No migration.** Add a `HelpButton` + an article to cover
  more cards. ⚠ Not browser-verified.
- **Metrics — Discovery→conversion drill-down (backlog, old #5).** Clicking a bar in
  the conversion chart opens the Explore modal **pre-filtered to that month's**
  discovery calls. Month key threaded via a `_key` field on the chart row; built from
  the exact rows that made the bar. Single-period only (inert in compare mode). **No
  migration.** ⚠ Not browser-verified.
- **Metrics — sticky range/preset bar (backlog, old #6).** The presets + date inputs +
  Compare toggle freeze to the top while scrolling (`.range` is `position: sticky`).
  Pure CSS, no markup change. **No migration.** ⚠ Not browser-verified.
- **Journeys — exclude a mentee (test/placeholder), dashboard-wide (backlog, old #4).**
  New HJG-owned **`mentee_exclusions`** table (**migration `9988_…`**) — a reversible,
  staff-owned sibling of `ca_clients.is_excluded`. Excluded clients drop from Metrics
  range appointments and the Journeys pipeline aggregates; the mentee stays listed
  (greyed) with an **Exclude/Include** toggle in the detail panel.
  `fetchExcludedClientIds` is honored by `fetchRangeAppointments` + flagged on
  `fetchMenteeJourneys`. Added to the Raw-data viewer. ⚠ **Needs 9988 applied**; not
  browser-verified.

**The session-006/006b FEATURE_BACKLOG is now fully shipped — no planned items left.**
Two new migrations this session that MUST be applied: **`9989_payout_builds.sql`**
(Build payout) and **`9988_mentee_exclusions.sql`** (Journeys exclude).

Everything below is the prior session-006 wrap (still current unless noted above).

---

## Resume here (live state — 2026-06-22, session 006 — WRAPPED)

Picking this up cold — start here.

**Repo state:** session 006 is **wrapped and fully on `main`** (all work this
session went straight to `main`; `main` also carries everything from sessions
003–005b). Working tree clean, everything pushed. Before push: `typecheck`,
`verify` (**12 sections**), `build` all pass. **UI not browser-tested** (headless
container) — see the browser-verify list in "Immediate next steps".

**⚠ Migrations — one NEW this session.** `9999`–`9991` are applied (per the user).
**`9990_company_options.sql` is NEW and MUST be applied** — it seeds the
`journeys_stage_basis` key; the Company-options / Journeys stage-date toggle works
in-session but **won't persist** until it exists (staff can UPDATE `app_settings`
but not INSERT). After applying, a **re-sync** (Admin → Sync now) is still the gate
that (a) populates the **Pay staff** tab, (b) takes the capacity/group reclass +
delivery signal live, and (c) feeds the **capacity weekly-slot fix** (needs
`start_raw`). Then do the eyeball checks under "Immediate next steps".

**Shipped this session (006) — Metrics "Compare" mode (period vs period):**
- **Compare toggle** on the Metrics page. On → pick **Period A vs Period B**.
  Presets **MoM / QoQ / YoY** auto-derive a **span-aligned** Period B from A
  (year-to-date stays comparable to year-to-date); plus free **custom** A/B
  ranges. Off → the view returns to the exact single-period state.
- **Board scorecard** card at the top (`ChartCard`): grouped A/B bars for the four
  headline KPIs + a **delta table** covering every metric (KPIs, conversion rate,
  manual resource metrics) with **Δ** (absolute) and **Δ%** (vs Period B);
  conversion-rate Δ is in percentage points.
- **Per-chart overlays**: every time-series card draws Period B too — a **paired
  bar** on bar charts (Discovery, Meetings[total], Mentors) and a **dashed
  reference line** on the line/composed charts (Active mentees, Discovery →
  conversion). Each card's **table gains B + Δ columns** in compare mode.
- **Pure math** in **`lib/compare.ts`** (`shiftMonths`, `derivePeriodB`, `delta`,
  `COMPARE_PRESETS`), re-exported through `src/db.ts` (same pattern as the pay
  engine). New format helpers `signed`/`signedPct`/`signedPp`. Locked by
  **verify §10**. Period A computation refactored to share `reduceMonthRows` /
  `groupByMonth` with Period B so a comparison is always apples-to-apples.
- ⚠ **Not browser-verified** (headless container) — **browser/Vercel-preview
  check** the compare toggle, scorecard, overlays, and Δ tables. The B-overlay on
  the Meetings card only renders in **"Total"** mode (compare-types mode keeps its
  per-type bars; its Δ table still compares total meetings A vs B).

**Also shipped this session (006) — Pay-staff Explore coach dropdown scoped:**
- The **Coach** filter in the Pay-staff "Explore source data" window
  (`src/components/PayExploreModal.tsx`) now lists only coaches with **≥1 row in
  the active view** under the current month/tier/text filters — computed from
  everything **except** the coach filter itself (so picking a coach doesn't
  collapse the dropdown). Selecting a coach that drops out of range auto-resets to
  "All coaches". This **emptied the `FEATURE_BACKLOG.md` planned list** (both items
  now shipped). ⚠ browser-verify alongside Compare mode.

**Also shipped this session (006) — two bug fixes + a cleanup:**
- **Capacity weekly-slot fix (bug #1).** New pure **`lib/capacity.ts`**
  (`oneOnOneMenteesByCoach`, `groupSlotKeys`) drops unnamed **multi-client time
  slots** (same coach + same exact `start_raw`, 2+ distinct clients) from 1-on-1
  capacity, closing the residual Arthur-Nisly inflation the named-format fix
  missed. `RangeAppt` now carries `startRaw` (fetched from `ca_appointments.start_raw`;
  `start_date` is day-only). Capacity-only — still counts as mentoring everywhere
  else. Verify **§11**.
- **Client/server divergence fix (bug #2).** Deleted the dead `api/reports/funnel.ts`
  endpoint (only consumer of `computeFunnelReport`, never called by the UI, counted
  mentors differently). Pure funnel/metrics logic kept (verify + C# port).
- **Cleanup.** Removed the dead `MENTOR_COACH_ID_WHITELIST` from `lib/config.ts`
  and its (empty/no-op) gate in `computeMonthlyMetrics`.
- Left as requested: pay-staff revenue-basis confirmation, mid-month hand-off
  split, and mentor-start eyeballing (bugs #3–5 — they hinge on a re-sync +
  `ca_invoices` spot-check). ⚠ the capacity fix needs a re-sync + browser verify.

**Also shipped this session (006) — Company options tab + Journeys stage-date basis:**
- **NEW "Company options" tab** (`src/views/CompanyOptionsView.tsx`) — self-serve,
  **org-wide** settings as dropdowns grouped by section. Registry-driven: declare an
  option in **`src/companyOptions.ts`** (key/section/label/help/choices/default) + seed
  its key in a migration → it appears automatically. Persisted in `app_settings` (jsonb)
  via `fetchCompanyOptions`/`setCompanyOption`. **Migration `9990_company_options.sql`
  seeds `journeys_stage_basis` and MUST be applied** for changes to persist.
- **Journeys stage-date basis** — pure **`lib/journey.ts`** (`computeStageDates`,
  `highestTier`) with two bases: `engagement_start` (CA engagement start, the prior
  behavior) and `first_meeting` (first 1-on-1 mentoring meeting under that tier's
  engagement, group sessions excluded, fallback to engagement start). `db.ts`
  `fetchMenteeJourneys(basis)` + `buildClientStages` (replaces `stagesByClient`;
  `RangeAppt`/meetings now carry `isGroup`, engagements carry `id`). A segmented
  toggle on the Journeys tab flips it and persists the same org-wide setting.
  Verify **§12**. **This is the answer to the Seth-Lehman question** — see the data
  review: 7/2 is his 4x engagement's real start date; "first meeting" shows 7/3.
- **Backlog:** added **5 planned items** (Data map → own tab; contextual "?" help;
  Journeys exclude-mentee; conversion column drill-down; sticky range bar).

**Shipped this session (005b) — Pay-staff re-evaluation tooling:**
- **By-month breakdown.** The Pay-staff tab no longer shows one month at a time.
  It now leads with a **payout-by-month graph + an all-months expandable table**
  (click a month → per-mentor breakdown inline). All-time summary tiles up top.
- **"Explore source data" window** (`src/components/PayExploreModal.tsx`) — a
  modal with three views: the **compiled payout ledger** (one row per mentee per
  month: month, coach, mentee, tier, collected, active days, proration, split,
  payout) plus the **raw `Invoices` and `Engagements` engine inputs** that fed it
  (toggle between them). Every view is **sortable** (click any header) and
  **filterable** by month range, coach, tier, and free text; each exports the
  current (filtered+sorted) view to CSV.
- **Reusable `src/components/SortableTable.tsx`** (tri-state header sort + CSV) —
  available to reuse elsewhere (e.g. the Raw data tab) later.
- **Engine:** new pure **`computePayTimeline`** + flat **`PayLedgerRow`** in
  `lib/pay.ts` (a thin map over the untouched `computePayReport`, so per-month
  math is identical). Covered by **verify §9**.
- ⚠ Still gated on data: the tab is empty until **`9993_ca_invoices.sql`** is
  applied + a re-sync runs (see below). The by-month view and explorer light up
  with the same re-sync.

**Shipped this session (005) — staff payment tool + invoice sync:**
- **NEW "Pay staff" tab** (`src/views/PayStaffView.tsx`) — per-mentor monthly
  payout. Each mentor earns a **ramped share** of revenue **collected** from each
  mentee, credited to the invoice's **service month** (`date_of`) and **prorated
  by active engagement days**. Graph + table (north star), per-mentor mentee
  breakdown, CSV export, month picker.
- **Payout engine** `lib/pay.ts` (pure, tested in verify §8): ramp **35% → 50% →
  60%** by mentor tenure month (derived from earliest engagement, overridable
  later); daily proration; pay-on-collected; "unassigned" bucket for collected
  revenue with no overlapping engagement.
- **Invoice sync** (read-only) → new **`ca_invoices`** mirror (migration
  **`9993_ca_invoices.sql`**). `Invoice.getAll` → billed `amount`, collected
  `amount_paid`, `date_of` service month, line items + payments (jsonb).

**⚠ ACTION REQUIRED for Pay staff to show data:** apply **`9993_ca_invoices.sql`**
(and **`9992_appointment_counts_in_engagement.sql`**, new this session) in the
Supabase SQL Editor, then **re-sync** (Admin → Sync now). Until then the tab shows
an empty-state banner. **Then export `ca_invoices` and confirm the invoices
actually carry the monthly subscription charges** ($425 = 4x, etc.) — if CA bills
subscriptions elsewhere, we switch the revenue source to a tier→price config
(engine unchanged). Decisions captured in `Session log/005_2026-06-19/`.

**Delivery signal (session 005b):** the sync now mirrors CA's
**`countsInEngagement`** as `ca_appointments.counts_in_engagement` (1 = delivered/
credited, -1 = not counted, 0 = no judgement, null = pre-sync). After applying
`9992` + a re-sync, **export `ca_appointments` and eyeball the 1 / -1 / 0
distribution** — it's only useful for "did the paid-for sessions happen?" if the
coaches actually maintain that flag in CA. If they do, it unlocks a *pay-on-
delivered* verification layer over the collected-revenue model.

**Branch cleanup (partial):** the three feature branches
(`admiring-lovelace-3tb4iy`, `magical-gauss-ELOiz`, `practical-meitner-toynll`)
are fully captured in `main`. The local branch was deleted, but **remote
deletion was blocked by the git proxy (HTTP 403)** and there's no branch-delete
GitHub tool in this environment — **delete the three remote branches via the
GitHub UI** (Branches page) when convenient. They're redundant, not load-bearing.

**▶ Immediate next steps (prioritized, end of session 006):**
1. **Apply `9990_company_options.sql`** in the Supabase SQL Editor (seeds
   `journeys_stage_basis`) — until then the Company-options / Journeys stage-date
   toggle won't persist.
2. **Re-sync (Admin → Sync now)** — the one gate that's still pending. It (a)
   populates the **Pay staff** tab, (b) takes the **capacity/group reclass** +
   **delivery signal** live, and (c) feeds the **capacity weekly-slot fix** (needs
   `start_raw`). After it: eyeball **Arthur Nisly's** capacity row (inflation gone),
   and **export `ca_invoices`** to confirm invoices carry the subscription charges
   ($425 = 4x, etc.) — else swap the engine to a `tier→price` config (no engine
   change; tab shows an empty-state banner until invoices land).
3. **Browser / Vercel-preview verify** the session-006 UI (container is headless):
   - **Metrics Compare mode** — toggle, scorecard, per-chart overlays, Δ tables,
     MoM/QoQ/YoY/custom.
   - **Company options** tab + **Journeys stage-date toggle** (engagement start vs
     first 1-on-1 meeting) — re-check **Seth Lehman** (4x shows 7/2 on engagement
     basis, 7/3 on first-meeting basis).
   - **Pay-staff Explore** coach-dropdown scoping; the **capacity** card.
4. **Pick the next build from `FEATURE_BACKLOG.md`** (6 planned items). The user has
   flagged **#1 "Build payout" interactive review/builder** as wanted next.
5. **Delete the three stale remote branches** via the GitHub UI (proxy blocked
   `git push --delete`): `admiring-lovelace-3tb4iy`, `magical-gauss-ELOiz`,
   `practical-meitner-toynll` — all fully captured in `main`.
6. Later: widen `SYNC_YEARS` so pre-window JumpStart engagements aren't missing a
   start date.

**Verification status:** `npm run typecheck`, `npm run verify` (**12 sections** —
added [10] compare-mode period math, [11] capacity 1-on-1 vs group slots,
[12] journey stage-date basis), `npm run build` all pass. UI not browser-tested
(headless container) — **browser-verify the by-month table + Explore window once
invoices are synced, the Metrics Compare mode, the capacity card after a re-sync,
and the new Company options tab + Journeys stage-date toggle (after applying 9990).**

## What this is

A dashboard for Henry Jude Group (a faith-based mentoring nonprofit) that
**mirrors CoachAccountable (CA) data into Supabase Postgres** and presents
mentoring / discovery-funnel / **pipeline-journey** metrics for board reporting.
Staff log in, data syncs from CA on demand, the dashboard reads the mirror.

> Read-only toward CA. `SPEC.md` has CA API details + categorization rules but
> its KV/on-demand parts are superseded by the Supabase-mirror model.

## Stack

- **Frontend:** React 18 + Vite + TS + `recharts`; Supabase Auth gates the app.
  `write-excel-file` for the multi-sheet export.
- **Backend:** Vercel serverless functions (TS, **ESM**) under `api/`.
- **Data:** Supabase Postgres; CA pulled via `POST /api/sync`.
- **Hosting:** Vercel, GitHub `radiodinner/hjg-data-plugin`. Feature branches
  deploy as **Preview**; `main` → production.

## App tabs

- **Metrics** — date-range KPIs + charts; every ChartCard has Graph/Table/Both +
  Export CSV + Explore. Includes the **Discovery → conversion** ChartCard
  (converted bars + conversion-rate line), Resource engagement, and Mentor
  capacity utilization (group-session inflation fixed session 003).
- **Discovery** — discovery calls; auto outcome + manual override.
- **Journeys** — per-mentee pipeline timeline `Discovery → JumpStart → 4x
  → 2x → 1x → Graduation` from engagement stage dates, current tier, observed
  meeting-rhythm chart, and a status override (active/graduated/quit/fired).
  Top card = **board-level aggregate** leg durations (avg/median/n) as graph +
  table. Mentee search/list on the left.
- **Pay staff** (session 005; reworked 005b) — per-mentor payout: ramped % (35/
  50/60 by tenure) of **billed** mentee revenue (collected shown for reference),
  by invoice **service month**,
  prorated by active days. **By-month**: payout-by-month graph + all-months
  expandable table (expand → per-mentor breakdown). **Explore source data**
  window: sortable/filterable compiled ledger + raw invoice/engagement inputs
  (filter by month/coach/tier/text, CSV per view). Empty until `ca_invoices` is
  synced.
- **Raw data** — browse `ca_*`/HJG tables (incl. **`ca_invoices`**); per-table
  CSV export; **Export all → `.xlsx`** (one table per sheet); **Data map ↗** link.
- **Admin** — Sync now, run history, settings, Manual metrics, Mentor capacity.
- **Company options** (session 006) — self-serve, **org-wide** dashboard settings as
  dropdowns, grouped by section. Registry-driven (`src/companyOptions.ts`); persisted
  in `app_settings` (jsonb). First option: **Journeys → stage-date basis** (engagement
  start vs first 1-on-1 meeting), also togglable inline on the Journeys tab.

## Key files

| Path | Role |
|---|---|
| `lib/ca.ts` | CA API client (read-only). `getEngagements()`, **`getInvoices()` = Invoice.getAll**. **CA payload under `return`, not `result`.** |
| `lib/config.ts` | Categorization (incl. **`GROUP_SESSION_CONTAINS`** → `"group"`), exclusions, conversion knobs (`CONVERSION_OFFERING_IDS=[42840]`), **`engagementTier()` + `PIPELINE_TIERS`**, CA function names (incl. **`invoiceGetAll`**). |
| `lib/conversion.ts` | Pure discovery→conversion resolver. Verify §5. |
| `lib/pay.ts` | **Pure staff-payment engine** (`computePayReport`): ramp 35/50/60 by tenure, daily proration, **pay-on-billed** (invoice `amount`; collected carried for reference). Verify §8. |
| `lib/sync.ts` | Sync orchestration; offerings/submissions + **engagements** + **invoices** are best-effort (warnings accumulate). |
| `src/db.ts` | Browser data access. `fetchMenteeJourneys`, `aggregateJourneyDurations`, **`fetchPayData`** (+ re-exports `computePayReport`); mentee_outcomes read/write; `fetchAllRows`. |
| `src/views/JourneysView.tsx` | The Journeys tab (timeline + aggregate). |
| `src/views/PayStaffView.tsx` | **The Pay staff tab** (payout graph+table, per-mentor breakdown). |
| `src/views/MetricsView.tsx` | Metrics dashboard (ChartCards, conversion, capacity). |
| `src/xlsx.ts` | Multi-sheet `.xlsx` workbook export. |
| `public/data-map.html` | Static interactive data-relationship graph (snapshot). |
| `lib/pay.ts` | …also **`computePayTimeline` + `PayLedgerRow`** (multi-month + flat ledger; verify §9). |
| `src/components/SortableTable.tsx` | **Reusable** click-to-sort table + CSV export of the sorted view. |
| `src/components/PayExploreModal.tsx` | **Pay-staff "Explore source data"** window (ledger / invoices / engagements; sort + filter). |
| `scripts/verify-metrics.ts` | Pure-logic checks; **§6 tier mapping, §7 group categorization, §8 staff payment, §9 pay timeline/ledger**. |

## Important domain decisions

- **Pipeline tiers live in `ca_engagements.name`** (`MN Subscription | (Nx
  Month) …`; legacy `Every N Appointments` / `ONE|TWO appointment per month` /
  `WEEKLY appointments`). `engagementTier()` maps them; the word "weekly" is
  ignored as a signal (legacy names always say "60 min weekly Zoom call").
  Snapshot funnel: JumpStart→4x→2x→1x→graduated ≈ 102→149→55→18→10.
- **Graduation** = an "After Graduation Care" engagement (auto), or a manual
  `mentee_outcomes` override. Override always wins; quit/fired can be any stage.
- **Mentee activity:** active if a meeting OR open engagement within 45 days.
- Discovery counted by **signup date**; mentee meetings/mentees/mentors by
  **scheduled date**. Conversion is automated read-time (offering 42840).
- Group "In Depth" / "Tracking Together" sessions are categorized **`"group"`**
  (not `"mentoring"`) so they don't inflate per-mentor capacity (Arthur Nisly).
  They still count as mentoring meetings everywhere else via the `isGroup` flag.
  **Fixed session 003 — needs a re-sync to take effect.**

## Database schema (Supabase)

Mirror (sync-written, all-authenticated read): `ca_coaches`, `ca_clients`,
`ca_appointments` (+ **`counts_in_engagement`**, 9992 — apply + re-sync),
`ca_offerings`, `ca_offering_submissions`, `ca_engagements`
(9994), **`ca_invoices` (9993 — apply + re-sync to populate)**. Ops: `sync_runs`,
`app_settings` (budget/sync knobs + **Company options** like `journeys_stage_basis`,
9990 — string jsonb values; staff UPDATE-only, keys seeded by migration). HJG-owned
(staff RLS): `discovery_outcomes`, `mentee_outcomes`
(9995), `coach_settings` (9996), `manual_metrics` (9997), plus dormant
`graduations`/`cadence_status_log`.

## Environment variables

(unchanged — set in Vercel, documented in `.env.example`) `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`CA_API_ID`, `CA_API_KEY`, `CA_PLAN_DAILY_LIMIT`, `HJG_DAILY_CAP_PCT`,
`BUDGET_TZ`, `SYNC_YEARS`, `HJG_CORS_ALLOWED_ORIGINS`, `SYNC_CRON_SECRET`.

## Conventions / gotchas

- **Migrations DESCENDING** (newest = lowest). Present = `9988`…`9999`. **Next
  new one is `9987_…`.** Run by copy-paste into the Supabase SQL Editor; make
  re-runnable (`drop … if exists` / `add column if not exists`). User reports
  9999–9990 applied (start of 006b). **Two NEW this session (006b) — both MUST be
  applied:** `9989_payout_builds.sql` (Build payout — Save/Approve/Discard error
  until it exists) and `9988_mentee_exclusions.sql` (Journeys exclude — Exclude/
  Include errors until it exists). Both are staff-RLS, one row per key, re-runnable.
- **Vercel functions are native ESM** → relative imports in `api/` (+ `lib/` it
  pulls in, e.g. `ca.ts`/`sync.ts`) MUST end in `.js`. **BUT** pure `lib/` modules
  consumed by the frontend (`config.ts`, `conversion.ts`, **`pay.ts`**) use
  **extensionless** imports — under Vite's "Bundler" resolution a `.js` specifier
  leaves the module untyped (everything `any`). Match the file's neighbors.
  Frontend (`src/`) imports lib via `src/db.ts`; note `src/lib/` also exists, so
  from `src/views/` the repo-root lib is `../../lib` — re-export through `db.ts`.
- `public/*` is copied to the build root → served at `/<file>`; the SPA rewrite
  in `vercel.json` only applies when no real file matches.
- Env var changes need a redeploy; after a schema migration, re-sync.
- Verify locally: `npm install && npm run typecheck && npm run verify && npm run build`.

## Open items / TODO

- **`FEATURE_BACKLOG.md` has 6 planned items** (added late in session 006). Newest
  first: **#1 "Build payout"** interactive review/builder (Pay staff — the user
  wants this next), #2 Data map → own tab, #3 contextual "?" help, #4 Journeys
  exclude-mentee, #5 conversion column drill-down, #6 sticky range bar. Two items
  already **shipped** this session (Compare mode, Pay-staff coach-dropdown scoping)
  are in that file's "Shipped" section.

- **Pay staff — revenue basis = BILLED (decided session 005b).** The engine now
  pays on the invoice's billed `amount` (what's owed for the service month "in a
  perfect world"), credited to `date_of`; `amount_paid` is carried only for
  reference (shown alongside, never drives payout). Still to confirm after `9993`
  + re-sync: **export `ca_invoices` and verify invoices carry the monthly
  subscription charges** ($425 = 4x, etc.). If CA doesn't invoice the
  subscriptions, swap the revenue source to a `tier → price` config (engine + UI
  unchanged).
- **Pay staff — mentor-start override — SHIPPED (session 005b).** Tenure for the
  35/50/60 ramp defaults to the coach's earliest engagement, but can be pinned via
  `coach_settings.pay_start_month` ('YYYY-MM', migration 9991), edited in Admin →
  Mentor capacity → "Pay start". Threaded through `fetchPayData.startMonthOverride`
  → `computePayTimeline`. **Eyeball the derived dates and set overrides for any
  veteran who looks "new".** (A per-coach split-table override is still possible
  later if the 35/50/60 values ever vary by mentor.)
- **Pay staff — multi-coach month.** A mentee with a mid-month hand-off is
  attributed 100% to the majority-day coach (not split). Revisit if it matters.
- **Mentor capacity inflation (Arthur Nisly) — FIXED.** Named group formats get a
  separate `"group"` category scoped to capacity via `isGroup` (session 003), AND
  the residual **multi-client weekly-slot** case is now handled too (session 006):
  `lib/capacity.ts` treats any (coach, exact `start_raw`) slot with 2+ distinct
  clients as a group and drops it from 1-on-1 capacity. Both still need a **re-sync
  + browser verify** to confirm on live data. (Slot detection keys on `start_raw`;
  a slot with no time is treated as a 1-on-1.)
- **Data map is a static snapshot** — wire to live Supabase if wanted.
- **Stage rail** has no explicit quit/fired exit marker (status pill covers it).
- **`MENTOR_COACH_ID_WHITELIST` — REMOVED (session 006).** Was dead/empty;
  `computeMonthlyMetrics` no longer references it (behavior identical).
- **Client vs server metric divergence — RESOLVED (session 006)** by deleting the
  dead `api/reports/funnel.ts` endpoint (the only consumer of `computeFunnelReport`,
  never called by the UI; it counted mentors differently than the UI). The pure
  `lib/funnel.ts` / `lib/metrics.ts` stay (verify §1/§3, needed for the C# port).
- Bundle > 500 kB (recharts + write-excel-file) — cosmetic.
- **C# rebuild** — separate track, not started (`CSHARP_PORT.md`).
