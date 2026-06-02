# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-06-01 (session 002).

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously**. See
> `CLAUDE.md` for standing goals, `new_session_instructions.md` for standing
> orders (session logs, prompt history), and `CSHARP_PORT.md` for the C# track.

## Resume here (live state — 2026-06-01, session 002)

Picking this up cold — start here.

**Repo state:** on branch **`claude/admiring-cray-nZJgk`** (working tree clean
after the final handoff commit), **13 commits ahead of `main`**, all pushed.
**Not yet merged to `main`.** `main` is still default + production.

**Shipped this session (see `Session log/002_2026-06-01/session_log.md` for the
full list + hashes):**
- **Discovery → conversion ChartCard** (converted bars + rate line + table).
- **Journeys tab** (new): per-mentee pipeline timeline + board-level aggregate.
- **Engagement sync** (read-only) → new `ca_engagements` mirror.
- **Real engagement-based pipeline stages** — `Discovery → JumpStart → 4x → 2x →
  1x → Graduation` with real per-stage dates (the headline feature).
- **Raw data: "Export all" → multi-sheet `.xlsx`** (one table per sheet).
- **Interactive data map** at `public/data-map.html` → hosted at
  `/data-map.html`, linked from the Raw data tab.

**▶ Immediate next steps:**
1. **Pick a fix for the mentor-capacity inflation** (see Open items). Diagnosed
   this session, not yet built — the user needs to choose the approach.
2. **Verify in a real browser / Vercel preview** (container is headless): the
   Journeys tab, `/data-map.html`, and the Export-all `.xlsx`.
3. **Apply migrations** in the Supabase SQL Editor if not done: `9995_mentee_
   outcomes.sql` (needed for the status override) and `9994_ca_engagements.sql`
   (engagements already synced, so likely applied — confirm).
4. Consider widening `SYNC_YEARS` so pre-window JumpStart engagements aren't
   missing a start date on the timeline.
5. **Merge to `main`** when verified.

**Verification status:** `npm run typecheck`, `npm run verify` (6 sections),
`npm run build` all pass. UI not browser-tested this session.

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
  capacity utilization (⚠ inflation bug — see Open items).
- **Discovery** — discovery calls; auto outcome + manual override.
- **Journeys** (NEW) — per-mentee pipeline timeline `Discovery → JumpStart → 4x
  → 2x → 1x → Graduation` from engagement stage dates, current tier, observed
  meeting-rhythm chart, and a status override (active/graduated/quit/fired).
  Top card = **board-level aggregate** leg durations (avg/median/n) as graph +
  table. Mentee search/list on the left.
- **Raw data** — browse `ca_*`/HJG tables; per-table CSV export; **Export all
  → `.xlsx`** (one table per sheet); **Data map ↗** link.
- **Admin** — Sync now, run history, settings, Manual metrics, Mentor capacity.

## Key files

| Path | Role |
|---|---|
| `lib/ca.ts` | CA API client (read-only). `getEngagements()` = Engagement.getAll. **CA payload under `return`, not `result`.** |
| `lib/config.ts` | Categorization, exclusions, conversion knobs (`CONVERSION_OFFERING_IDS=[42840]`), **`engagementTier()` + `PIPELINE_TIERS`** (engagement-name → tier), CA function names. |
| `lib/conversion.ts` | Pure discovery→conversion resolver. Verify §5. |
| `lib/sync.ts` | Sync orchestration; offerings/submissions + **engagements** are best-effort (warnings accumulate). |
| `src/db.ts` | Browser data access. **`fetchMenteeJourneys`** (engagement-based stages) + **`aggregateJourneyDurations`**; mentee_outcomes read/write; `fetchAllRows`. |
| `src/views/JourneysView.tsx` | The Journeys tab (timeline + aggregate). |
| `src/views/MetricsView.tsx` | Metrics dashboard (ChartCards, conversion, capacity). |
| `src/xlsx.ts` | Multi-sheet `.xlsx` workbook export. |
| `public/data-map.html` | Static interactive data-relationship graph (snapshot). |
| `scripts/verify-metrics.ts` | Pure-logic checks; **§6 = engagement tier mapping**. |

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
- Group "In Depth" sessions inflate the per-mentor mentee count (Arthur Nisly
  case) — **bug, not yet fixed.**

## Database schema (Supabase)

Mirror (sync-written, all-authenticated read): `ca_coaches`, `ca_clients`,
`ca_appointments`, `ca_offerings`, `ca_offering_submissions`, **`ca_engagements`
(migration 9994)**. Ops: `sync_runs`, `app_settings`. HJG-owned (staff RLS):
`discovery_outcomes`, **`mentee_outcomes` (9995)**, `coach_settings` (9996),
`manual_metrics` (9997), plus dormant `graduations`/`cadence_status_log`.

## Environment variables

(unchanged — set in Vercel, documented in `.env.example`) `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`CA_API_ID`, `CA_API_KEY`, `CA_PLAN_DAILY_LIMIT`, `HJG_DAILY_CAP_PCT`,
`BUDGET_TZ`, `SYNC_YEARS`, `HJG_CORS_ALLOWED_ORIGINS`, `SYNC_CRON_SECRET`.

## Conventions / gotchas

- **Migrations DESCENDING** (newest = lowest). Applied = `9994`…`9999`. **Next
  new one is `9993_…`.** Run by copy-paste into the Supabase SQL Editor; make
  re-runnable (`drop … if exists`).
- **Vercel functions are native ESM** → every relative import in `lib/`/`api/`/
  `scripts/` MUST end in `.js`. Frontend `src/` (Vite) does not.
- `public/*` is copied to the build root → served at `/<file>`; the SPA rewrite
  in `vercel.json` only applies when no real file matches.
- Env var changes need a redeploy; after a schema migration, re-sync.
- Verify locally: `npm install && npm run typecheck && npm run verify && npm run build`.

## Open items / TODO

- **Mentor capacity inflation (Arthur Nisly) — DIAGNOSED, NOT FIXED.** Group
  "In Depth"/"Tracking Together" sessions + multi-client weekly slots count as
  individual mentees. Options offered: (a) categorize group sessions separately
  (config + re-sync), (b) exclude multi-client slots from capacity, (c) exclude
  known group names. **User to pick.**
- **Data map is a static snapshot** — wire to live Supabase if wanted.
- **Stage rail** has no explicit quit/fired exit marker (status pill covers it).
- **`MENTOR_COACH_ID_WHITELIST`** in `lib/config.ts` is dead (empty); remove in
  a cleanup pass.
- **Client vs server metric divergence** (`/api/reports/funnel` unused by UI).
- Bundle > 500 kB (recharts + write-excel-file) — cosmetic.
- **C# rebuild** — separate track, not started (`CSHARP_PORT.md`).
