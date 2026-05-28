# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-05-28.

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously**. ✅
> That core layout shift just shipped (see "Resume here" below). See `CLAUDE.md`
> for the standing goals, and `CSHARP_PORT.md` for the separate C# learning-rebuild
> track.
>
> **Shipped since last handoff:** automated discovery→conversion, manual board
> metrics, Resource-engagement card, and now the **inline graph+table panels on
> every ChartCard** with a Graph/Table/Both toggle (replaces the Explore modal).

## Resume here (live session state — 2026-05-28)

Picking this up cold — start with this section.

**Repo state:** on branch `claude/affectionate-pasteur-UaBv4` (working tree
clean), one commit ahead of `main`. The graphs-AND-tables north-star change is
on this branch and ready to merge.

**This session's commits (newest first, on top of `main` at `05cf717`):**
- (this session) — graphs+tables: inline table panel on every ChartCard with
  Graph/Table/Both toggle (default Both, persisted per card), side-by-side at
  ≥960px and stacked below; removes `ExploreModal`
- `1be071b` — handoff: live session-resume state

**▶ Next step on the north star — pick what to lock in next:**
The v1 split is in. Natural follow-ons, in rough order:
1. **Sortable / filterable tables** (sort by column, free-text filter per card).
2. **CSV export** per table (one-line download of the per-month rows).
3. Apply the same graph+table treatment to the **Discovery → conversion** panel
   (today it's stat-row only — could add a per-month conversion-rate series with
   a matching table).
4. **"Calls held" toggle** for discovery (vs signup date) — long-standing.

**Verification status (this session):** `npm run typecheck`, `npm run verify`,
and `npm run build` all pass. **The UI was NOT exercised in a real browser**
this session — the remote container is headless and the app is Supabase-auth-
gated, so a quick manual pass on a real machine is wanted before merging:
- on each Metrics card, the Graph/Table/Both toggle flips the panel and the
  choice survives a reload (stored in `localStorage` under
  `hjg.chartcard.view:<title>`);
- at wide widths (≥960px) the table sits to the right of the chart; at narrower
  widths it stacks below;
- the Mentee-meetings card's Total/Compare toggle and type filter still drive
  both the chart and the new inline table.

**Other offered-but-not-done (pick up if wanted):**
- A **`Stop` hook** in `settings.json` to *auto-enforce* "update HANDOFF.md each
  session" (today it's only a soft `CLAUDE.md` instruction). Can be set up via the
  config skill.

**Separate track — C# rebuild:** see `CSHARP_PORT.md`. Not started; begin with the
pure-logic port (`Config`, `Conversion`) + xUnit tests, keeping this app as the
reference.

**Orient on the new device:** `npm install && npm run typecheck && npm run verify
&& npm run build`, then read `CLAUDE.md` (conventions + north star), this file,
and `CSHARP_PORT.md`. To actually *run* the app you need the Supabase + CA env
vars (see "Environment variables" below).

## What this is

A dashboard for Henry Jude Group (a faith-based mentoring nonprofit) that
**mirrors CoachAccountable (CA) data into Supabase Postgres** and presents
mentoring / discovery-funnel metrics for board reporting. Staff log in, the data
is synced from CA on demand, and the dashboard reads from the mirror.

> The project started as a budget-governed read-only API over CA (see
> `SPEC.md`). It was re-architected mid-stream into the Supabase-mirror model
> described here. `SPEC.md` is still useful for CA API details and the
> categorization rules, but the KV/on-demand parts are superseded.

## Stack

- **Frontend:** React 18 + Vite + TypeScript + `recharts`. Supabase Auth
  (email/password) gates the whole app.
- **Backend:** Vercel serverless functions (TypeScript, **ESM**) under `api/`.
- **Data:** Supabase Postgres. CA is pulled in via `POST /api/sync`.
- **Hosting:** Vercel, connected to GitHub repo `radiodinner/hjg-data-plugin`.
  Deploys on push (feature branches deploy as **Preview**).

## Data flow

```
CoachAccountable ──(read-only, budget-guarded)──▶ /api/sync ──▶ ca_* mirror tables (Supabase)
                                                                      │
Browser dashboard ──(supabase-js, RLS)────────────────────────────────┘
   • reads the mirror directly and computes metrics client-side over a date range
   • writes discovery_outcomes directly (RLS: signed-in staff)
```

Server endpoints (`lib/http.ts` `withApi`, Supabase-JWT auth):
- `POST /api/sync` — pull CA → upsert mirror, writes a `sync_runs` row. Auth: a
  signed-in user, or `x-sync-secret` == `SYNC_CRON_SECRET` (for a future cron).
- `GET /api/health` — no auth; reports whether env is configured + last sync.
- `GET /api/budget` — CA-call cap + recent runs.
- `GET /api/reports/funnel` — server-side monthly metrics (reuses
  `lib/metrics.ts`/`lib/funnel.ts`). **Currently unused by the UI** (the
  dashboard computes client-side); kept as a reporting foundation + it's what
  `scripts/verify-metrics.ts` exercises.

## Key files

| Path | Role |
|---|---|
| `lib/ca.ts` | CA API client (`CAClient`), read-only, `spend()` budget hook. **CA returns data under `return`, not `result`.** |
| `lib/config.ts` | Categorization rules (mentoring / discovery / excluded), client-name exclusions, CA function names, **conversion knobs** (`CONVERSION_OFFERING_IDS=[42840]`, `DISCOVERY_DECISION_WINDOW_DAYS=30`). The file to edit when an appointment type isn't recognized or the conversion rule changes. |
| `lib/conversion.ts` | **Pure** discovery→conversion resolver (manual wins → JumpStart purchase on/after the call = converted → pending ≤30d → not_converted). Covered by `verify-metrics.ts` §5. |
| `lib/sync.ts` | Sync orchestration: pull CA, categorize, upsert `ca_*`, write `sync_runs`. Offerings/submissions are best-effort. |
| `lib/budget.ts` | Postgres-backed daily CA-call cap (`BudgetTracker`), config from `app_settings`. |
| `lib/supabase-admin.ts` | Service-role Supabase client (server only). |
| `lib/http.ts` | `withApi` wrapper: CORS, Supabase session auth, error mapping. |
| `lib/metrics.ts`, `lib/funnel.ts` | Pure metric computation (server + verify). |
| `lib/types.ts` | CA entity types + DB row types. |
| `src/auth.tsx` | Supabase session provider + sign in/out. |
| `src/db.ts` | **Browser** data access (reads mirror, writes outcomes, range fetch). |
| `src/api.ts` | `triggerSync()` (calls `/api/sync` with the session token). |
| `src/views/MetricsView.tsx` | The dashboard (range picker, KPIs, charts, Explore). |
| `src/views/DiscoveryView.tsx` | Lists discovery calls; record an outcome per call. |
| `src/views/RawDataView.tsx` | Browse `ca_*` / `sync_runs` tables. |
| `src/views/AdminView.tsx` | "Sync now", run history, budget/sync settings. |
| `supabase/migrations/*.sql` | DB schema. **Descending numbering** (see below). |
| `scripts/verify-metrics.ts` | Validates categorization/metric logic vs SPEC §4. |

## App tabs

- **Metrics** — date-range picker (presets: this/last month, this/last quarter,
  this year, last 12 mo, all; plus custom From/To). KPI cards + charts:
  Discovery calls (stacked phone/zoom + total in tooltip), Mentee meetings (with
  a meeting-type checkbox filter and a **Total / Compare types** toggle), Active
  mentees (line), Mentors (bar), and a Discovery→conversion panel. **Every
  ChartCard has an inline Graph / Table / Both toggle** (default Both, choice
  persisted per card in `localStorage`) so the chart and the exact per-month
  numbers are visible together — side-by-side at ≥960px, stacked below on
  narrower screens. There's also a **Resource engagement** card (totals +
  per-month bars for the manual board metrics). A "Data as of <last sync>" line
  shows freshness.
- **Discovery** — discovery-call appointments. Outcome is now **computed
  automatically** (see "Conversion automation" below): a **Status** column shows
  the resolved outcome + an Auto/Manual tag + a plain reason. Staff can still
  **Override** per call (e.g. a no-show) — the override wins — or **Clear** it to
  revert to automatic.
- **Raw data** — browse mirror tables directly (`manual_metrics` included).
- **Admin** — Sync now, recent sync runs, settings, and a **Manual metrics** card
  (pick a month, key in counts; the Metrics tab sums them over its range).

## Important domain decisions

- **Discovery calls are counted by SIGNUP date** (`date_added` / booking date),
  not the scheduled call date — that's the board-relevant top-of-funnel number
  and matches CA's Business Center → Offering Signups. Falls back to the
  scheduled date when `date_added` isn't populated yet. **Mentee meetings,
  active mentees, and mentors are counted by the scheduled date.**
- Categorization happens at **sync time**; the category is stored on
  `ca_appointments.category`. The dashboard aggregates stored categories.
- **Conversion is automated, read-time** (no stored auto-outcome, no job): a
  discovery call converts when its client bought offering **42840** (supervised
  *JumpStart Your Freedom (Waiting List)*) on/after the call; else pending for 30
  days, then not_converted. **Manual overrides in `discovery_outcomes` always
  win.** The self-paced `32326` and test `42841` deliberately do not auto-convert.
  Logic in `lib/conversion.ts`; the Metrics conversion panel and Discovery tab
  both read through it. (Known simplification: counting is per-appointment, so a
  prospect with multiple discovery calls could be counted more than once.)
- Placeholder/group "clients" are flagged `ca_clients.is_excluded` (rules in
  `lib/config.ts`) and excluded from metrics.

## Database schema (Supabase)

Mirror (written by sync / service role, read by all authenticated):
`ca_coaches`, `ca_clients`, `ca_appointments`, `ca_offerings`,
`ca_offering_submissions`. Ops: `sync_runs`, `app_settings`.
HJG-owned (staff read/write via RLS): `graduations`, `discovery_outcomes`,
`cadence_status_log` (Graduations and Cadence UI were removed — only
`discovery_outcomes` is wired up), and **`manual_metrics`** (migration `9997`,
generic metric-key + month + value; powers the Manual metrics card and the
Resource engagement card).

## Environment variables

Set in Vercel (Settings → Environment Variables) **and** documented in
`.env.example`. Scope them to **Preview** (feature branches deploy as preview)
or All Environments, or the functions/build won't see them.

```
SUPABASE_URL                 # project URL
SUPABASE_SERVICE_ROLE_KEY    # secret key (sb_secret_… or legacy service_role JWT). SERVER ONLY.
VITE_SUPABASE_URL            # same project URL (browser; baked in at build)
VITE_SUPABASE_ANON_KEY       # publishable / anon key (browser-safe)
CA_API_ID, CA_API_KEY        # CoachAccountable API creds
CA_PLAN_DAILY_LIMIT=600      # CA daily call limit (also in app_settings)
HJG_DAILY_CAP_PCT=5          # self-imposed cap %
BUDGET_TZ=America/Chicago     # day boundary + appointment-month bucketing
SYNC_YEARS=                  # default: current and prior two years
HJG_CORS_ALLOWED_ORIGINS=*   # lock to the dashboard origin in prod
SYNC_CRON_SECRET=            # optional; for the (dormant) scheduled sync
```

## Conventions / gotchas

- **Migrations are numbered DESCENDING** (newest = lowest): `9999_init` →
  `9998_appointment_booking_date` → `9997_manual_metrics`. **Next new one is
  `9996_…`.** Run by copy-paste into the Supabase **SQL Editor** (not `supabase db
  push`), so make new ones re-runnable (`drop ... if exists` before triggers and
  policies). See `CLAUDE.md`.
- **Vercel runs functions as native ESM** → every relative import in `lib/`,
  `api/`, and `scripts/` MUST end in `.js` (e.g. `import { x } from "./foo.js"`)
  even though the source is `.ts`. Missing extensions = `ERR_MODULE_NOT_FOUND`
  crashes. Frontend `src/` is bundled by Vite and does NOT need `.js`.
- **Env var changes require a redeploy** (VITE_ vars bake in at build time).
- After a schema migration, **re-sync** (Admin → Sync now) to backfill.
- Verify locally: `npm install && npm run typecheck && npm run verify && npm run build`.

## Current branch / deploy

- Active branch: **`claude/affectionate-pasteur-UaBv4`** (one commit ahead of
  `main` — the graphs-AND-tables work). Deploys as a Vercel **Preview**. Merge
  to `main` to ship to production.
- `main` is still the default + production branch. Pushes to `main` deploy to
  Vercel production.

## Immediate next step

See **"Resume here"** at the top — the graphs-AND-tables layout is in. Next:
sortable/filterable tables and CSV export, or extend the treatment to the
Discovery → conversion panel.

Operational (not code): confirm migration `9997_manual_metrics.sql` is fully
applied in Supabase (it was run once — the re-runnable version drops/recreates the
trigger + policies cleanly), then staff can enter manual metrics on the Admin tab.

## Open items / TODO

- **Mentors count likely inflated.** `Coach.getAll` returns ~35 "coaches"; the
  Mentors metric counts unique `coach_id` among mentoring appointments. The
  board sheet shows ~3–5. There's a `MENTOR_COACH_ID_WHITELIST` in
  `lib/config.ts` but it's only applied by the (now-unused) server endpoint —
  the client-side dashboard does NOT apply it. Decide how to restrict (whitelist
  applied client-side, or an `is_mentor` flag on `ca_coaches`).
- **Offerings/submissions — CONFIRMED working.** `Offering.getSubmissions`
  populates `ca_offering_submissions` (108 JumpStart rows, 2024-06→2026-05), which
  is what the conversion automation depends on. Still best-effort in `lib/sync.ts`
  (a failure is a warning, not a hard error).
- **"Calls held" toggle** for discovery (vs signup date) — offered, not built.
- **Raw data filters** (category / date / status) would make CA reconciliation
  easier.
- **Scheduled sync** is dormant (`app_settings.sync_interval_hours = null`).
  Could add a Vercel Cron hitting `/api/sync` with `SYNC_CRON_SECRET`.
- **Client vs server metric divergence:** the dashboard computes client-side
  while `/api/reports/funnel` computes server-side. If both are kept, watch for
  drift, or retire the endpoint.
- Bundle size > 500 kB warning (recharts) — cosmetic.
