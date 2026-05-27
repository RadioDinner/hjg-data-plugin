# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-05-27.

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously** (not
> just behind the Explore modal). See `CLAUDE.md` for the standing goals, and
> `CSHARP_PORT.md` for the separate C# learning-rebuild track.
>
> **Shipped since last handoff:** automated discovery→conversion (no longer
> manual-only), manual board metrics, and a Resource-engagement card. Everything
> is merged to `main`, which is now the default branch.

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
| `src/components/ExploreModal.tsx` | Generic table modal for card drill-downs. |
| `supabase/migrations/*.sql` | DB schema. **Descending numbering** (see below). |
| `scripts/verify-metrics.ts` | Validates categorization/metric logic vs SPEC §4. |

## App tabs

- **Metrics** — date-range picker (presets: this/last month, this/last quarter,
  this year, last 12 mo, all; plus custom From/To). KPI cards + charts:
  Discovery calls (stacked phone/zoom + total in tooltip), Mentee meetings (with
  a meeting-type checkbox filter and a **Total / Compare types** toggle), Active
  mentees (line), Mentors (bar), and a Discovery→conversion panel. Each card's
  **Explore** button shows that chart's per-month data as a table. There's also a
  **Resource engagement** card (totals + per-month bars for the manual board
  metrics). A "Data as of <last sync>" line shows freshness.
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

- **`main` is the default + production branch** and has everything merged. The
  old `claude/*` work branches were consolidated into `main` (a couple still
  exist on the remote and can be deleted from the GitHub UI — the sandbox lacks
  delete permission).

## Immediate next step

Top priority is the **north star**: make every metric viewable as a **graph AND
a table at the same time** (today tables are only behind the per-card *Explore*
modal). Likely approach: give each `ChartCard` an inline graph/table toggle or a
twin table panel, generalize the Explore data builders into a reusable shape, and
keep it consistent across all cards. Confirm the exact interaction with the user
before building.

Also pending (operational, not code): apply migration `9997_manual_metrics.sql`
in Supabase if it isn't already (it was made re-runnable), then staff can enter
manual metrics.

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
