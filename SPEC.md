# HJG Data Hub — Phase 1 Spec (Revised)

> Budget-governed, **read-only** API layer that pulls mentoring metrics from
> CoachAccountable (CA) and exposes them as JSON for the HJG board scorecard
> dashboard.
>
> Audience: a coding agent (Claude Code) that will scaffold the project, push it
> to GitHub, and deploy it to Vercel via the GitHub integration.
>
> **What changed from the original handoff spec.** The original used a pure
> pull-on-demand model with CDN caching. That cannot *guarantee* a hard API-usage
> ceiling: serverless functions are stateless, so there is no shared counter, and
> CDN caching only *reduces* calls (worst case is traffic-dependent and unbounded
> across regions / cache evictions). This revision adds a **shared-state budget
> circuit breaker** plus a **stored snapshot** so that daily CoachAccountable
> usage is *provably* capped — defaulting to **5% of the daily limit** — and the
> cap is **adjustable at runtime from the dashboard UI**. Everything remains
> strictly read-only toward CoachAccountable.

---

## 0. Non-negotiable safety guarantees

These are the reasons this project exists in this shape. If a design choice
conflicts with one of these, the guarantee wins.

1. **Never exceed the daily CA call cap.** Default cap = **5%** of the plan's
   daily limit. A hard circuit breaker refuses any CA call that would cross the
   cap. There is no code path that calls CA without first decrementing budget.
2. **Never get close.** 5% leaves a 20× margin. Even pathological traffic,
   clock-boundary misalignment, or a redeploy storm cannot approach CA's real
   limit (see §5.4 for the margin math).
3. **Read-only toward CoachAccountable.** No `set`/`create`/`update`/`delete`
   CA functions are ever called. The only writes anywhere are to *our own*
   Vercel KV store (call counter, cap value, cached snapshot).
4. **Credentials never leak.** `CA_API_ID` / `CA_API_KEY` are server-side only
   and never appear in any response body, log line, or error detail.
5. **Fail safe, not open.** When the budget is exhausted or CA is unreachable,
   serve the last-good snapshot (marked stale). Never error in a way that tempts
   a retry storm against CA.

---

## 1. Project context

Henry Jude Group (HJG) is a faith-based mentoring nonprofit. Mentees progress
through tiered meeting cadences (4x → 2x → 1x → Graduated) with a founding mentor
(Arthur) and three co-mentors. Operational tooling currently spans:

- **CoachAccountable (CA):** scheduling and appointment data. System of record
  for mentee activity.
- **Notion:** inherited organizational database.
- **Squarespace:** public-facing website.
- **Excel:** manually maintained board scorecard.

The data operations person (Derrick) currently exports a CSV from CoachAccountable
each month, filters out non-mentee appointment types and cohort placeholders by
hand, computes monthly metrics, and reports to the board. Phase 1 replaces the
manual filtering and computation with an automated, usage-capped API.

## 2. Phase 1 goal

Build a small, deployable, **budget-governed** API layer that:

1. Authenticates to CoachAccountable using server-side credentials.
2. Pulls appointments, coaches, and clients for a given year — **only when a
   stored snapshot is stale and only when daily budget remains.**
3. Applies HJG's filtering rules (categorize appointments, exclude cohort
   placeholders).
4. Computes monthly metrics and returns them as JSON in the exact shape the
   existing dashboard expects.
5. Enforces a **hard daily cap on CoachAccountable calls** (default 5% of the
   plan limit), adjustable at runtime from the dashboard UI.
6. Is hostable on Vercel under a custom domain or `.vercel.app` subdomain,
   deployed via the GitHub integration.

**Phase 1 is read-only toward CoachAccountable.** No writes to CA. No mentor
portal. No webhooks. No multi-tenant support. Those are later phases. (Phase 1
*does* use a small KV store for its own budget counter, cap value, and snapshot
cache — see §18 for why this is not the "no database" item from the original
out-of-scope list.)

## 3. Existing dashboard data shape (Phase 0, already built)

A React scorecard dashboard exists separately. It currently has data hardcoded in
an `INITIAL_DATA` object. The Phase 1 API must return data in exactly this shape
so swapping `INITIAL_DATA` for a `fetch()` call is trivial:

```typescript
{
  year: number;                  // e.g. 2026
  months: string[];              // ["January", ..., "December"] — always length 12
  shortMonths: string[];         // ["Jan", ..., "Dec"]          — always length 12
  discoveryPhone: number[];      // count per month, length 12 (zeros for months > endMonth)
  discoveryZoom: number[];       // length 12
  menteeMeetings: number[];      // total mentoring appointments per month, length 12
  activeMentees: number[];       // unique mentee count per month, length 12
  activeMentors: number[];       // unique mentor count per month, length 12
  meta?: {
    appointmentsConsidered: number;
    excludedClients: string[];           // deduped
    uncategorizedAppointmentNames: string[]; // deduped
    computedAt: string;                  // ISO timestamp of the snapshot
    dateRange: { from: string; to: string };
    endMonth: number;                    // 1-indexed, inclusive (see §9)
    // budget / freshness observability:
    stale: boolean;                      // true if served past snapshot TTL because budget was exhausted
    snapshotAgeSeconds: number;
    budget: { capDaily: number; usedToday: number; remainingToday: number };
  };
}
```

**Array length is always 12.** Months beyond `endMonth` are zero-filled rather
than truncated, so the dashboard's array-index assumptions never break. (This
resolves an ambiguity in the original spec.)

## 4. Known-good values for verification

Cross-checked from a real appointment CSV export. For year 2026:

| Month | activeMentees | menteeMeetings | discoveryPhone | discoveryZoom |
|---|---|---|---|---|
| January | 24 | 77 | 1 | 2 |
| February | 27 | 74 | 5 | 2 |
| March | 29 | 79 | 1 | 3 |
| April | 32 | 99 | 1 | 3 |

If the implementation produces these numbers against HJG's real CA data, the
categorization logic is correct. A standalone verification script using synthetic
CA-shaped data reproduces these numbers and is part of the deliverable.

> **Note on `activeMentors`.** The table has no known-good column for it, so it
> cannot be asserted by the verify script. Treat `activeMentors` as
> **computed-but-unverified** in Phase 1. Definition (per §20.3): a coach who held
> ≥1 *mentoring* appointment (not training, not discovery) in that month. Confirm
> with the board whether that matches their intended meaning before relying on it
> for reporting.

> **Note on the verify script's scope.** Because the synthetic data is authored to
> reproduce the table, the script proves the *counting* logic is internally
> consistent — it does **not** prove the categorization rules match HJG's real
> appointment names. The real config check is `/api/appointment-types` returning an
> empty `other` bucket against live data (§17 step 7). Expect one config iteration
> after first connect.

## 5. Architecture decision

**Stack: Vercel serverless functions + TypeScript + Vercel KV. No framework.**

Rationale:
- Vercel functions are the simplest deploy target for a pure API.
- TypeScript catches CA API field-shape drift at build time.
- Vercel KV (Upstash Redis under the hood; free Hobby tier is ample) provides the
  shared state needed for a *real* budget guarantee. `@upstash/redis` directly is
  an acceptable equivalent.
- No Next.js (overkill for an API-only project). No Express (extra hosting
  complexity vs Vercel functions). No Softr (later-phase portal concern).

### 5.1 Request model: snapshot-first, on-demand-within-cap

Every data request follows this flow (implemented once in a shared helper):

```
request → is there a snapshot for this key?
  ├─ yes, and age < SNAPSHOT_TTL          → serve snapshot (0 CA calls)
  ├─ yes, but stale, AND budget remaining → refresh from CA, store, serve fresh
  ├─ yes, but stale, AND budget exhausted → serve stale snapshot (meta.stale=true)
  └─ no snapshot at all:
        ├─ budget remaining → refresh from CA, store, serve fresh
        └─ budget exhausted → 503 + Retry-After (only possible before first
                              successful fill; afterwards a stale snapshot exists)
```

This makes data "fresh on demand" (your chosen freshness model) while the daily
cap is the hard backstop. Because each refresh costs several CA calls (see §5.3)
and the cap is small, in practice the data refreshes a few times per day and then
serves stale until the next budget day — which is exactly the safe behavior you
asked for.

### 5.2 The budget circuit breaker

A single chokepoint wraps **every** CA HTTP call (`lib/ca.ts` calls
`lib/budget.ts`):

```
spendOne():
  cap   = getCap()              // from KV, falls back to env default
  used  = getUsedToday()        // from KV counter
  if used >= cap: throw BudgetExhausted   // caller serves stale / 503
  incr counter (atomic) with TTL
  proceed with the CA call
```

- The counter is an **atomic `INCR`** in KV so concurrent invocations cannot race
  past the cap.
- A refresh that needs N calls checks budget **per call**, not once up front, so a
  partial refresh can't blow the cap. If a refresh aborts mid-way on
  `BudgetExhausted`, the previous snapshot is left intact.
- There is no CA call anywhere that bypasses `spendOne()`.

### 5.3 Cost accounting (why pagination matters here)

A full-year metrics refresh costs:

```
Coach.getAll              → 1 call
Client.getAll             → 1..P_c calls   (P_c = client pages)
Appointment.getAll(year)  → 1..P_a calls   (P_a = appointment pages)
```

CA list endpoints **may paginate** (the original spec never addressed this — it is
a real correctness risk: a single un-paged call would silently undercount). The
client **must** loop until all pages are retrieved, and **each page is one
budgeted call.** With ~1,000 appointments/year a refresh may cost roughly 5–15
calls depending on page size. Budget math in §8 assumes a conservative ~15
calls/refresh.

### 5.4 Margin math (why 5% means "never close")

| Plan | Daily limit | 5% cap | Refreshes/day @ ~15 calls | CA limit used |
|---|---|---|---|---|
| Level 3 (default) | 600 | **30** | ~2 | 5% |
| Level 3.5 | 900 | 45 | ~3 | 5% |
| Level 4 | 1,200 | 60 | ~4 | 5% |

Even if our "budget day" boundary is misaligned with CA's reset (a known unknown,
§20), the worst case across a boundary is ~2× the cap = ~10% of CA's limit — still
a 10× safety margin. **The smallness of the cap is what makes boundary alignment a
non-issue.** The per-minute CA limit (100/min) is never approached: a single
refresh is well under 100 calls and requests are naturally serialized by the
snapshot lock.

## 6. CoachAccountable API basics

- Endpoint: `POST https://www.coachaccountable.com/API/`
- Auth: form-encoded body with `APIID` and `APIKey` on every request.
- Function-based: the `a` parameter names the function (e.g. `a=Appointment.getAll`).
- Returns JSON with `{ status, result, return, error, message, timezone }`.
- `error === 0` means success; anything else is an API-level failure.
- Full reference: https://www.coachaccountable.com/APIDocs

**API credentials must live server-side only.** Never expose them to the browser.
They come from Vercel environment variables.

## 7. CoachAccountable functions to use (all read-only)

| Function | Purpose | Required params |
|---|---|---|
| `Coach.getAll` | List all coaches | `includeInactive` (boolean) |
| `Client.getAll` | List all clients (mentees) | `includeInactive` (boolean), optional `CoachID` |
| `Appointment.getAll` | Appointments for a date range | `dateFrom`, `dateTo` (`YYYY-MM-DD`), optional `CoachID`/`ClientID`, `includeCanceled`, `includePending` |
| `Appointment.getTypes` | Appointment types per coach | `CoachID` (required) |

Appointment records include: `ID`, `CoachID`, `ClientID`, `EngagementID`, `name`,
`startDate`, `endDate`, `status` (`A`=Active, `C`=Canceled, `P`=Pending,
`D`=Declined), and others. **Filter to `status === "A"` for metrics.**

**Pagination:** on first real connection, confirm whether these list functions
paginate and what the page parameter/limit is. Implement a fetch-until-exhausted
loop. Until confirmed, log the returned count and compare against the known-good
totals (§4) as a sanity check that nothing was truncated.

## 8. Rate limits and the budget

CoachAccountable applies two limits simultaneously:

- **Per-minute:** 100 calls/minute (all paid plans).
- **Per-day:** `200 + (20 × client plan size)`:
  - Level 3 (20 clients): **600/day**
  - Level 3.5 (35 clients): 900/day
  - Level 4 (50 clients): 1,200/day

**Our self-imposed cap (the thing this project enforces):**

```
dailyLimit = CA_PLAN_DAILY_LIMIT            (env; default 600 = safest/Level 3)
capPct     = HJG_DAILY_CAP_PCT              (env; default 5)
capDaily   = override from KV if set        (UI-adjustable at runtime)
             else floor(dailyLimit * capPct / 100)   → default 30
```

The **UI-adjustable** value lives in KV under a known key and always wins over the
env-derived default. The dashboard reads/writes it via `/api/settings` (§9). HJG's
actual plan tier is currently **unconfirmed**, so we default to the safest
assumption (Level 3 → cap 30) and let Derrick raise it from the UI once confirmed
from the CA billing page.

## 9. Endpoints to build

All data endpoints serve from the stored snapshot and only call CA via the budget
guard (§5). All endpoints except `/api/health` require auth (§11). Every endpoint
handles `OPTIONS` preflight (§12) and is wrapped in the uniform try/catch (§14).

### `GET /api/health`
Sanity check. No CA call, no auth.
```json
{
  "ok": true,
  "service": "hjg-data-hub",
  "env": { "hasCAApiId": true, "hasCAApiKey": true, "authEnabled": true, "hasKV": true },
  "budget": { "capDaily": 30, "usedToday": 6, "remainingToday": 24 },
  "timestamp": "2026-05-22T20:00:00.000Z"
}
```

### `GET /api/budget`
Observability for the cap. No CA call. Returns the live cap, today's usage, the
plan limit it derives from, and the snapshot's age/freshness. Powers the
dashboard's usage gauge.
```json
{
  "capDaily": 30, "usedToday": 6, "remainingToday": 24,
  "planDailyLimit": 600, "capPct": 5, "capSource": "default",
  "snapshots": [ { "key": "metrics:2026", "computedAt": "...", "ageSeconds": 412, "stale": false } ]
}
```

### `GET` / `PUT /api/settings`
Reads and updates the **runtime-adjustable cap** (this is what "change it from the
UI" means). `PUT` requires auth.
- `GET` → `{ "capDaily": 30, "source": "default" | "override", "planDailyLimit": 600, "capPct": 5 }`
- `PUT  { "capDaily": 45 }` → validates (`1 ≤ capDaily ≤ planDailyLimit`,
  integer), writes the override to KV, returns the new effective value. Writing
  `null`/omitting reverts to the env-derived default. This writes only to KV; it
  never touches CoachAccountable.

### `GET /api/coaches`
Lists all coaches (to discover Coach IDs for config).
- Query: `?includeInactive=true` (optional). Snapshot key varies by this flag.

### `GET /api/clients`
Lists all clients (mentees).
- Query: `?includeInactive=false` (optional, default true), `?coachId=<id>` (optional).

### `GET /api/appointment-types`
Every appointment type across active coaches, bucketed per the config. **Critical
first-deploy check:** anything in `other` means the config doesn't recognize a type
and metrics will be wrong.
```json
{
  "count": 12,
  "bucketed": {
    "mentoring":      ["* SINGLE MEN ZOOM 60 Minute Weekly Mentoring Call"],
    "discoveryPhone": ["Discovery Call Appointment (Phone Call)"],
    "discoveryZoom":  ["Discovery Call Appointment (Zoom)"],
    "excluded":       ["Mentor Training Extra Teaching, Q & A, and Checkup"],
    "other":          []
  },
  "types": [ ... ]
}
```
This endpoint may cost up to `1 (Coach.getAll) + N (one getTypes per active
coach)` CA calls on refresh — all budgeted.

### `GET /api/appointments`
Raw appointments in a date range, each tagged by category.
- Query (required): `from=YYYY-MM-DD`, `to=YYYY-MM-DD`
- Query (optional): `coachId`, `clientId`, `includeCanceled=true`

### `GET /api/metrics/monthly`
**The headline endpoint.** Monthly metrics in the dashboard's expected shape (§3).
- Query (optional): `year` (default current year), `endMonth` (see below).
- `endMonth` semantics (resolving the original ambiguity): **1-indexed and
  inclusive.** Default = current month if `year` is the current year, else `12`.
  Months `> endMonth` are zero-filled. The current in-progress month **is
  included** and its partial data is flagged via `meta.computedAt`; the dashboard
  may choose to render the latest month differently. (If the board wants
  completed-months-only, set `endMonth = currentMonth - 1`; document this in the
  README.)

**Computation steps (per cache miss / refresh):**
1. Fetch (in parallel where possible, each call budgeted, each list paginated to
   exhaustion): `Appointment.getAll(dateFrom=YYYY-01-01, dateTo=YYYY-12-31)`,
   `Coach.getAll`, `Client.getAll(includeInactive=true)`.
2. Build a `Map<ClientID, ClientRecord>` for name lookups.
3. For each appointment:
   - Skip if `status !== "A"`.
   - Parse `startDate` **timezone-aware** (see §20.2 — do *not* rely on naive
     `new Date()` in UTC). Skip if its year ≠ requested year. Skip if its
     1-indexed month `> endMonth`.
   - Look up the client. If not found, record the appointment in
     `meta.uncategorizedAppointmentNames`-adjacent diagnostics and skip (define a
     `meta.unmatchedClientIds` count). If the client's name matches
     `EXCLUDE_CLIENT_NAMES` (§10), skip and record in `meta.excludedClients`.
   - Categorize the name (§10). `excluded` → skip. `other` → skip and record in
     `meta.uncategorizedAppointmentNames`.
   - Increment for the month (0-indexed array, month-1):
     - `discoveryPhone` → `discoveryPhone[m]++`
     - `discoveryZoom`  → `discoveryZoom[m]++`
     - `mentoring`      → `menteeMeetings[m]++`, add `ClientID` to month's mentee
       set, add `CoachID` to month's mentor set (subject to optional mentor
       whitelist, §10).
4. Convert per-month sets to counts for `activeMentees[]` / `activeMentors[]`.
5. Dedupe `meta.excludedClients` and `meta.uncategorizedAppointmentNames`.

## 10. HJG configuration (the file Derrick edits — `lib/config.ts`)

**Appointment category rules.** Case-insensitive substring matching. Precedence:
`excluded` → `discoveryPhone` → `discoveryZoom` → `mentoring`. Anything else →
`other`.

```
EXCLUDE_CONTAINS:
  - "mentor training extra teaching"
  - "get-acquainted zoom visit"
  - "gain momentum group"

DISCOVERY_PHONE_CONTAINS:
  - "discovery call appointment (phone call)"

DISCOVERY_ZOOM_CONTAINS:
  - "discovery call appointment (zoom)"

MENTORING_CONTAINS:
  - "mentoring call"
  - "in depth mentoring session"
  - "tracking together"
  - "single men"
  - "married men"
```

> Substring caution: `"single men"` is a substring of `"single men​tor"` and
> `"married men"` of `"married men​tor"`. Low risk given current type names, but if
> a future type like "Single Mentor …" appears it would match `mentoring`. Revisit
> if `/api/appointment-types` shows a surprising mentoring match.

**Client names to exclude** (cohort placeholders / group-session "clients", not
real mentees). Matching rule (tightened from the original "either component"
phrasing to remove ambiguity): **case-insensitive exact match against the client's
full name (`firstName + " " + lastName`, trimmed), OR exact match against
`firstName` alone, OR against `lastName` alone.** No substring matching here — these
must be exact to avoid excluding a real mentee.

```
EXCLUDE_CLIENT_NAMES:
  - "Sept 2025 - Season 9"
  - "2025 May Group; Season 8"
  - "Gain Momentum Group 1"
  - "Gain Momentum Group 2"
```

**Optional mentor whitelist.** If set, only these CoachIDs count toward
`activeMentors`. Empty = include all active coaches. Useful if admin-only Coach
accounts exist that shouldn't count operationally.

**Budget knobs** (env-driven defaults; cap is overridable at runtime via
`/api/settings`):
```
CA_PLAN_DAILY_LIMIT   default 600   # safest (Level 3) until tier confirmed
HJG_DAILY_CAP_PCT     default 5     # → default capDaily = 30
SNAPSHOT_TTL_SECONDS  default 3600  # soft freshness window before a request may refresh
```

## 11. Authentication

Static bearer token via env var.
- Header `x-hjg-token: <token>` (preferred), or query `?token=<token>`.
- Required on all endpoints except `/api/health`. `PUT /api/settings` also
  requires it.
- 401 when missing or wrong.
- If `HJG_API_TOKEN` is unset, auth is skipped (local dev convenience). **Fail-safe
  for production:** if `VERCEL_ENV === "production"` and no token is set, refuse
  protected endpoints with 500 and a clear message (so a forgotten token never
  silently opens the API). `/api/health` reports `authEnabled`.
- Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

> The token ships in the dashboard's client code, so it is not a true secret. It
> deters casual access and, combined with a locked CORS origin (§12), is adequate
> for Phase 1. Per-user auth is Phase 2+.

## 12. CORS

Configurable via `HJG_CORS_ALLOWED_ORIGINS` (comma-separated). Default `*` for
local dev; **production must be locked to the dashboard's actual origin.** Handle
`OPTIONS` preflight on every endpoint.

## 13. Environment variables

```
CA_API_ID                    # CoachAccountable API ID (Settings > API in CA)
CA_API_KEY                   # CoachAccountable API Key
HJG_API_TOKEN                # 32-byte random hex; required in production
HJG_CORS_ALLOWED_ORIGINS     # e.g. "https://hjg-board.vercel.app"
CA_PLAN_DAILY_LIMIT          # default 600 (safest); set to 900/1200 once tier confirmed
HJG_DAILY_CAP_PCT            # default 5
SNAPSHOT_TTL_SECONDS         # default 3600
KV_REST_API_URL              # provided by Vercel KV / Upstash
KV_REST_API_TOKEN            # provided by Vercel KV / Upstash
```

`.env.example` documents all of these. Real `.env` is never committed. The KV vars
are injected automatically when you attach a Vercel KV store to the project.

## 14. Error handling

Map CoachAccountable errors to HTTP statuses:
- CA codes 100–199 (auth) → HTTP 502 (upstream misconfiguration)
- CA codes 300–499 (param errors) → HTTP 400
- All other CA errors → HTTP 502
- `BudgetExhausted` with **no** snapshot to fall back on → HTTP 503 +
  `Retry-After`. (With a snapshot present, serve it stale instead of erroring.)
- Other thrown errors → HTTP 500

Error response shape:
```json
{ "error": true, "status": 502, "message": "CoachAccountable API error", "detail": {} }
```

**Never** include `CA_API_ID` / `CA_API_KEY` in messages, logs, or bodies. Wrap
every endpoint in a uniform try/catch helper (`lib/http.ts`) that enforces this.

## 15. Caching (two layers)

1. **Snapshot (origin, in KV):** the source of truth for "is a refresh allowed."
   Governed by `SNAPSHOT_TTL_SECONDS` and the budget guard (§5).
2. **CDN (edge):** belt-and-suspenders to keep even snapshot reads cheap. On
   successful responses set:
   ```
   Cache-Control: s-maxage=<endpoint-ttl>, stale-while-revalidate=<2×ttl>
   ```
   Suggested `s-maxage`: 300 for `/metrics/monthly` and `/appointments`, 600 for
   `/coaches`, `/clients`, `/appointment-types`, `/budget`. `/settings` and any
   error response: `Cache-Control: no-store`.

Because the CDN layer can't call CA (only the origin can, behind the guard), CDN
behavior can never threaten the cap; it only reduces origin invocations.

## 16. Recommended project structure

```
hjg-data-hub/
├── README.md                   # Setup, deploy, configuration, budget walkthrough
├── package.json
├── tsconfig.json               # ES2022, strict; lib: ["ES2022"] (fetch via @types/node)
├── vercel.json                 # function maxDuration: 30
├── .env.example
├── .gitignore                  # node_modules, .env*, .vercel
├── lib/
│   ├── ca.ts                   # CA client + typed entities + paginated helpers (calls budget.spendOne)
│   ├── budget.ts               # KV counter, cap resolution, circuit breaker
│   ├── store.ts                # KV wrapper (snapshot get/set, counter, settings)
│   ├── snapshot.ts             # snapshot-first refresh-within-cap orchestration
│   ├── config.ts               # HJG categorization rules + budget defaults (Derrick's file)
│   ├── metrics.ts              # Monthly metrics computation (pure; unit-testable)
│   └── http.ts                 # CORS, auth, error handling, cache headers
├── api/
│   ├── health.ts
│   ├── budget.ts
│   ├── settings.ts             # GET/PUT runtime cap
│   ├── coaches.ts
│   ├── clients.ts
│   ├── appointments.ts
│   ├── appointment-types.ts
│   └── metrics/
│       └── monthly.ts
└── scripts/
    └── verify-metrics.ts       # Synthetic CA-shaped data → metrics.ts → assert §4
```

Dependencies: `@vercel/node`, `@vercel/kv` (or `@upstash/redis`), `@types/node`,
`typescript`, `tsx` (dev only).

> `tsconfig` uses `lib: ["ES2022"]` (not DOM). Node 18+ provides global `fetch`
> with `@types/node`; pulling in DOM would add browser globals that don't exist at
> runtime and could mask bugs (fix vs. the original spec).

## 17. Verification path

Before declaring Phase 1 done:

1. `npm install && npx tsc --noEmit` → clean typecheck, zero errors.
2. `npx tsx scripts/verify-metrics.ts` → prints **"All checks passed."** Builds
   synthetic CA-shaped data reproducing §4, runs it through `lib/metrics.ts`,
   asserts the output. Includes at least one **month-boundary / timezone** case
   (an appointment near midnight) to prove bucketing is timezone-correct.
3. **Budget unit checks** (in the verify script or a sibling): with a stubbed KV,
   assert that `spendOne()` throws `BudgetExhausted` exactly at the cap, that
   `INCR` is atomic across simulated concurrent calls, and that a refresh aborting
   mid-way leaves the prior snapshot intact.
4. `vercel dev` → server starts locally.
5. `curl /api/health` → `ok: true`, `hasCAApiId`/`hasCAApiKey` true (after `.env`),
   `budget` block present.
6. `curl /api/coaches` → sane coach list.
7. `curl /api/appointment-types` → `bucketed.other` is **empty**. If not, add the
   missing patterns to `lib/config.ts` until it is.
8. `curl '/api/metrics/monthly?year=2026'` → numbers match §4.
9. **Cap behavior:** set the cap low (e.g. `PUT /api/settings {"capDaily":1}`),
   force two refreshes, confirm the second serves a **stale** snapshot
   (`meta.stale=true`) and made **no** CA call (usage didn't increase). Confirm
   `/api/budget` reflects usage. Restore the cap.

Then deploy **via GitHub** (your chosen workflow):

1. Push the repo to GitHub on the working branch / merge to main.
2. In Vercel: **New Project → Import** the GitHub repo (enables auto-deploy on
   push).
3. **Storage → Create / Connect a KV store** to the project (injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
4. **Settings → Environment Variables:** add `CA_API_ID`, `CA_API_KEY`,
   `HJG_API_TOKEN`, `HJG_CORS_ALLOWED_ORIGINS`, and optionally
   `CA_PLAN_DAILY_LIMIT` / `HJG_DAILY_CAP_PCT` / `SNAPSHOT_TTL_SECONDS`.
5. Trigger a deploy (push or "Redeploy"). Re-run checks 5–9 against the deployed
   URL.

(The Vercel CLI flow — `vercel`, `vercel env add`, `vercel --prod` — also works if
you prefer it, but the GitHub integration matches your stated workflow and gives
push-to-deploy.)

## 18. Explicitly out of scope for Phase 1

Belongs in later phases — do not build now:
- Mentor portal (login, role-based views, mentor-specific data)
- Webhook handling (CA → Data Hub push events)
- **Any write operation to CoachAccountable** (creating appointments, marking
  actions done) — strictly forbidden in Phase 1
- Multi-tenant support (HJG only, not a sellable SaaS)
- Per-user authentication (Clerk, NextAuth, etc.)
- Email/Slack/notification triggers
- Graceful-degradation UI (stale-data banners live in the dashboard, though the
  API *flags* staleness via `meta.stale`)
- Retention/churn/graduation metrics (need engagement analysis — Phase 2)
- Scheduled cron pre-warming (deferred; the on-demand-within-cap model was chosen
  instead — easy to add later if freshness needs change)

> **Why the KV store is *not* the forbidden "persistent storage."** The original
> spec's out-of-scope item meant "no database of mentee/business records as a
> system of record." Our KV holds only ephemeral operational state — a daily call
> counter, the adjustable cap value, and a short-lived computed snapshot — none of
> which is authoritative business data and all of which can be wiped without loss
> (it just triggers a fresh pull within budget). This directly serves the
> non-negotiable cap guarantee, which takes precedence.

## 19. Sources

- CoachAccountable API Reference: https://www.coachaccountable.com/APIDocs
- CoachAccountable pricing / rate-limit math: https://www.coachaccountable.com/pricing
- CoachAccountable Webhooks (future-phase context only):
  https://blog.coachaccountable.com/2026/01/webhooks-now-available/

## 20. Known unknowns and risks

1. **Date format from CA.** Docs don't specify `startDate`'s exact format. Likely
   `YYYY-MM-DD HH:MM:SS` in the account timezone. Verify on the first real call.
2. **Timezone behavior (and a correction to the original advice).** Appointments
   near midnight can bucket into the wrong month. The original spec said "parse
   into a JS Date; don't string-slice" — but on Vercel functions run in **UTC**, so
   naive `new Date("2026-01-31 23:00:00")` is interpreted as UTC and can shift the
   day/month. Use the account timezone (CA returns a `timezone` field) to derive
   the local calendar month — e.g. `Intl.DateTimeFormat` with the account TZ, or
   parse the `YYYY-MM` prefix directly if CA already returns account-local strings.
   The verify script must include a midnight-boundary case (§17.2).
3. **`activeMentors` definition & unverifiability.** No known-good column (§4).
   Defined as "coach with ≥1 mentoring appointment that month." Confirm with the
   board.
4. **HJG's exact CA plan tier — currently unconfirmed.** We default to the safest
   (Level 3 → cap 30). Confirm from the CA billing page, then raise
   `CA_PLAN_DAILY_LIMIT` (and/or the runtime cap) accordingly. Until then the
   dashboard may refresh fewer times/day than ideal — by design.
5. **Edge appointment types.** Rules come from one CSV export. `/api/appointment-types`
   exists to surface unknowns; iterate `lib/config.ts` until `other` is empty.
6. **Pagination of CA list endpoints — unconfirmed and load-bearing.** If they
   paginate and we don't loop, metrics silently undercount. Implement
   fetch-until-exhausted; verify returned counts against §4 on first connect (§7).
7. **CA daily-reset boundary.** Unknown whether CA resets at account-midnight or on
   a rolling 24h window. We key the counter by calendar day in a configured TZ; the
   5% cap's 20× margin makes any misalignment harmless (§5.4). Confirm if/when the
   cap is raised toward higher percentages.
```
