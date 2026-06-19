# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-06-19 (session 005b).

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously**. See
> `CLAUDE.md` for standing goals, `new_session_instructions.md` for standing
> orders (session logs, prompt history), and `CSHARP_PORT.md` for the C# track.

## Resume here (live state — 2026-06-19, session 005b)

Picking this up cold — start here.

**Repo state:** session 005b works on branch **`claude/wonderful-wright-du8c1f`**
(not `main`) per the session's branch instruction. Verified before push:
`typecheck`, `verify` (now **9 sections**), `build` all pass.

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
in the Supabase SQL Editor, then **re-sync** (Admin → Sync now). Until then the
tab shows an empty-state banner. **Then export `ca_invoices` and confirm the
invoices actually carry the monthly subscription charges** ($425 = 4x, etc.) — if
CA bills subscriptions elsewhere, we switch the revenue source to a tier→price
config (engine unchanged). Decisions captured in `Session log/005_2026-06-19/`.

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
3. **Confirm the ramp basis (OPEN QUESTION).** The 35/50/60 ramp is implemented
   as **mentor tenure** (months since the mentor's earliest engagement, applied
   across all their mentees). The user was asked whether it should instead reset
   **per new mentee relationship** — unanswered at session end. If per-mentee,
   it's a small change in `lib/pay.ts`.
4. **Browser / Vercel-preview verify** (container is headless): the **Pay staff**
   tab, the capacity card, Journeys, `/data-map.html`, the Export-all `.xlsx`.
5. **Delete the three stale remote branches** via the GitHub UI (proxy blocked
   `git push --delete`): `admiring-lovelace-3tb4iy`, `magical-gauss-ELOiz`,
   `practical-meitner-toynll` — all fully captured in `main`.
6. Later: **mentor-start override** in `coach_settings` (see Open items); widen
   `SYNC_YEARS` so pre-window JumpStart engagements aren't missing a start date.

**Verification status:** `npm run typecheck`, `npm run verify` (**9 sections** —
added [9] staff payment timeline + ledger), `npm run build` all pass. UI not
browser-tested (headless container) — **browser-verify the by-month table +
Explore window once invoices are synced.**

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
  50/60 by tenure) of **collected** mentee revenue, by invoice **service month**,
  prorated by active days. **By-month**: payout-by-month graph + all-months
  expandable table (expand → per-mentor breakdown). **Explore source data**
  window: sortable/filterable compiled ledger + raw invoice/engagement inputs
  (filter by month/coach/tier/text, CSV per view). Empty until `ca_invoices` is
  synced.
- **Raw data** — browse `ca_*`/HJG tables (incl. **`ca_invoices`**); per-table
  CSV export; **Export all → `.xlsx`** (one table per sheet); **Data map ↗** link.
- **Admin** — Sync now, run history, settings, Manual metrics, Mentor capacity.

## Key files

| Path | Role |
|---|---|
| `lib/ca.ts` | CA API client (read-only). `getEngagements()`, **`getInvoices()` = Invoice.getAll**. **CA payload under `return`, not `result`.** |
| `lib/config.ts` | Categorization (incl. **`GROUP_SESSION_CONTAINS`** → `"group"`), exclusions, conversion knobs (`CONVERSION_OFFERING_IDS=[42840]`), **`engagementTier()` + `PIPELINE_TIERS`**, CA function names (incl. **`invoiceGetAll`**). |
| `lib/conversion.ts` | Pure discovery→conversion resolver. Verify §5. |
| `lib/pay.ts` | **Pure staff-payment engine** (`computePayReport`): ramp 35/50/60 by tenure, daily proration, pay-on-collected. Verify §8. |
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
`ca_appointments`, `ca_offerings`, `ca_offering_submissions`, `ca_engagements`
(9994), **`ca_invoices` (9993 — apply + re-sync to populate)**. Ops: `sync_runs`,
`app_settings`. HJG-owned (staff RLS): `discovery_outcomes`, `mentee_outcomes`
(9995), `coach_settings` (9996), `manual_metrics` (9997), plus dormant
`graduations`/`cadence_status_log`.

## Environment variables

(unchanged — set in Vercel, documented in `.env.example`) `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`CA_API_ID`, `CA_API_KEY`, `CA_PLAN_DAILY_LIMIT`, `HJG_DAILY_CAP_PCT`,
`BUDGET_TZ`, `SYNC_YEARS`, `HJG_CORS_ALLOWED_ORIGINS`, `SYNC_CRON_SECRET`.

## Conventions / gotchas

- **Migrations DESCENDING** (newest = lowest). Present = `9993`…`9999`. **Next
  new one is `9992_…`.** Run by copy-paste into the Supabase SQL Editor; make
  re-runnable (`drop … if exists`). `9993_ca_invoices.sql` still needs applying.
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

- **Pay staff — verify the revenue source.** The payout engine reads `ca_invoices`
  (collected, by service month). After applying `9993` + re-syncing, **export
  `ca_invoices` and confirm invoices carry the monthly subscription charges**
  ($425 = 4x, etc.). If CA doesn't invoice the subscriptions, swap the revenue
  source to a `tier → price` config (engine + UI unchanged).
- **Pay staff — mentor-start override.** Tenure (for the 35/50/60 ramp) is
  currently derived from a coach's earliest engagement. A veteran whose first
  engagement is *within the synced window but who actually started earlier* could
  look "new". Add a per-coach `pay_start_month` (+ optional split override) to
  `coach_settings` and an editor once the derived dates are eyeballed.
- **Pay staff — multi-coach month.** A mentee with a mid-month hand-off is
  attributed 100% to the majority-day coach (not split). Revisit if it matters.
- **Mentor capacity inflation (Arthur Nisly) — FIXED (session 003), pending
  re-sync + browser verify.** Group sessions get a separate `"group"` category,
  scoped to capacity via `isGroup`. **Still open:** the *multi-client weekly slot*
  case (unnamed slots w/ several clients) is NOT handled — only named group
  formats. Revisit with a time-slot heuristic if those still inflate.
- **Data map is a static snapshot** — wire to live Supabase if wanted.
- **Stage rail** has no explicit quit/fired exit marker (status pill covers it).
- **`MENTOR_COACH_ID_WHITELIST`** in `lib/config.ts` is dead (empty); remove in
  a cleanup pass.
- **Client vs server metric divergence** (`/api/reports/funnel` unused by UI).
- Bundle > 500 kB (recharts + write-excel-file) — cosmetic.
- **C# rebuild** — separate track, not started (`CSHARP_PORT.md`).
