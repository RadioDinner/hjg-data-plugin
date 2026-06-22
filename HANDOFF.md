# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-06-22 (session 006).

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously**. See
> `CLAUDE.md` for standing goals, `new_session_instructions.md` for standing
> orders (session logs, prompt history), and `CSHARP_PORT.md` for the C# track.

## Resume here (live state — 2026-06-22, session 006)

Picking this up cold — start here.

**Repo state:** session 006 is **committed to `main`** (the user asked for all
work on `main` this session; `main` now also carries everything from sessions
003–005b). Verified before push: `typecheck`, `verify` (now **10 sections**),
`build` all pass.

**Migrations: ALL APPLIED.** The user confirmed `9999`–`9991` are applied in
Supabase. The remaining gate for the **Pay staff** tab + capacity/group reclass +
delivery signal is a **re-sync** (Admin → Sync now) — the schema is ready, the
data just needs to land. After the re-sync, do the eyeball checks under
"Immediate next steps".

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

**▶ Immediate next steps (prioritized):**
1. **Apply `9993_ca_invoices.sql` in the Supabase SQL Editor, then re-sync**
   (Admin → Sync now). This one re-sync does double duty: it **populates the Pay
   staff tab** AND finally reclassifies appointments into the `"group"` category
   for the session-003 **capacity fix** (which also needed a re-sync). After it,
   eyeball Arthur Nisly's capacity row to confirm the inflation is gone.
2. **Export `ca_invoices` and send it to verify the Pay staff revenue source** —
   confirm CA invoices actually carry the monthly subscription charges
   ($425 = 4x, etc.). If not, point the engine at a tier→price config (no engine
   change). The tab shows an empty-state banner until invoices land.
3. **Ramp basis — RESOLVED (session 005b): per-MENTOR.** The 35/50/60 ramp tracks
   the **mentor's** tenure and applies to ALL their mentees that month (Clayton's
   per-mentee reset was wrong). Already how `lib/pay.ts` worked; now locked by
   verify §8 tests + decoded in `docs/legacy-pay-calculator.md`. The **mentor-start
   override** is now SHIPPED (`coach_settings.pay_start_month`, migration **9991**,
   editable in Admin → Mentor capacity → "Pay start"). **Apply `9991` before this
   deploys** — `fetchPayData`/`fetchCoachesWithSettings` now select the column.
4. **Browser / Vercel-preview verify** (container is headless): the **Pay staff**
   tab, the capacity card (now with the Pay-start column), Journeys, the Export-all.
5. **Delete the three stale remote branches** via the GitHub UI (proxy blocked
   `git push --delete`): `admiring-lovelace-3tb4iy`, `magical-gauss-ELOiz`,
   `practical-meitner-toynll` — all fully captured in `main`.
6. Later: widen `SYNC_YEARS` so pre-window JumpStart engagements aren't missing a
   start date (the Pay-start override now covers the worst case manually).

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

- **Migrations DESCENDING** (newest = lowest). Present = `9990`…`9999`. **Next
  new one is `9989_…`.** Run by copy-paste into the Supabase SQL Editor; make
  re-runnable (`drop … if exists` / `add column if not exists`). User reports
  9999–9991 applied; **`9990_company_options.sql` is new this session and MUST be
  applied** — it seeds the `journeys_stage_basis` key. The Company-options toggle
  works in-session without it, but **won't persist** until the key exists (staff
  can UPDATE `app_settings` but not INSERT, so the key must be seeded by migration).
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

- **`FEATURE_BACKLOG.md` planned list is now CLEAR** — both items shipped in
  session 006 (Metrics **Compare mode**, and the Pay-staff Explore **coach
  dropdown** scoping). Add new ideas there (newest on top) when they come up.

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
