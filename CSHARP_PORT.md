# Porting HJG Data Hub to C# — Plan & Workflow

A pick-up-later guide for rebuilding this app in C# as a learning project. The
existing TypeScript app stays as the **reference implementation** — build the C#
version in a **separate repo** and diff behavior against this one.

## Goal

Learn C# by re-implementing a real app you already understand. The work splits
cleanly into pure logic (great practice, no frameworks) and then I/O + UI. Port
**logic first** so you get fast green/red feedback from tests before touching
databases or the web.

## What the app does (so the C# version has a target)

Mirrors CoachAccountable (CA) data into Postgres, then shows mentoring /
discovery-funnel metrics. Notable logic to reproduce:
- Categorize CA appointments (mentoring / discovery phone+zoom / excluded).
- **Discovery → conversion automation:** a discovery call is "converted" when
  the client buys the supervised *JumpStart Your Freedom (Waiting List)* offering
  (`OfferingID 42840`) on/after the call; else "pending" for 30 days, then "not
  converted". A manual override always wins.
- A daily CA-API call budget (circuit breaker).
- Manual board metrics (counts staff key in per month).

## Recommended C# stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **.NET 8 (LTS)** | `dotnet` CLI for everything |
| Pure logic | **Class library** (`Hjg.Core`) | config, categorization, conversion, budget, metrics, funnel |
| Tests | **xUnit** | port `scripts/verify-metrics.ts` assertions |
| CA client | **`HttpClient`** + `System.Text.Json` | mirrors `lib/ca.ts` |
| Database | **Npgsql** + **Dapper** (simple) or **EF Core** (ORM) | keep Postgres; or `supabase-csharp` to stay on Supabase |
| API | **ASP.NET Core minimal APIs** | or Azure Functions for serverless parity with Vercel |
| UI | **Blazor** (Server is simplest to start) | "C# all the way"; or keep the React UI and only do the C# backend |
| Charts + tables | **MudBlazor** or **Radzen** | both ship a charting component *and* a DataGrid — ideal for the graphs-and-tables goal |
| Auth | ASP.NET Core Identity, or Supabase Auth via `supabase-csharp` | |

## Solution structure

```
HjgDataHub.sln
  src/Hjg.Core/          # pure logic: Config, Categorization, Conversion, Budget, Metrics, Funnel
  src/Hjg.Data/          # Postgres access, CA HttpClient, sync orchestration
  src/Hjg.Web/           # Blazor app (or ASP.NET Core API)
  tests/Hjg.Core.Tests/  # xUnit — port verify-metrics.ts
```

## Port order (logic first)

1. **Core + tests** (no I/O — do all of this before databases):
   - Config constants: categorization substrings, client-name exclusions,
     `ConversionOfferingIds = [42840]`, `DiscoveryDecisionWindowDays = 30`.
   - `CategorizeAppointmentName` ← `lib/config.ts`.
   - `ResolveDiscoveryOutcome` ← `lib/conversion.ts` (and port the 9 assertions
     from `verify-metrics.ts` §5 — boundary at 30/31 days, override-wins, etc.).
   - `BudgetTracker` ← `lib/budget.ts`.
   - `ComputeMonthlyMetrics` / `ComputeFunnelReport` ← `lib/metrics.ts`,
     `lib/funnel.ts` (use the SPEC §4 targets as tests).
2. **CA client** (`HttpClient`). Carry over: CA returns payloads under the
   `return` key (not `result`); call `spend()` on the budget before each request.
3. **Sync** into Postgres (upsert mirror tables, write a `sync_runs` row).
4. **API** endpoints — or skip straight to Blazor data services.
5. **Dashboard UI** in Blazor: every metric as a graph **and** a table.

## File mapping (TS → C#)

| TypeScript | C# home |
|---|---|
| `lib/config.ts` | `Hjg.Core/Config.cs` |
| `lib/conversion.ts` | `Hjg.Core/Conversion.cs` |
| `lib/budget.ts` | `Hjg.Core/BudgetTracker.cs` |
| `lib/metrics.ts`, `lib/funnel.ts` | `Hjg.Core/Metrics.cs`, `Funnel.cs` |
| `lib/types.ts` | `Hjg.Core/Models/*.cs` (records) |
| `lib/ca.ts` | `Hjg.Data/CoachAccountableClient.cs` |
| `lib/sync.ts` | `Hjg.Data/SyncService.cs` |
| `src/db.ts` | `Hjg.Data/*Repository.cs` |
| `src/views/*.tsx` | `Hjg.Web/Pages/*.razor` |
| `scripts/verify-metrics.ts` | `tests/Hjg.Core.Tests/*.cs` |

## First-session checklist

```bash
# install the .NET 8 SDK first (dotnet --version)
dotnet new sln -n HjgDataHub
dotnet new classlib -o src/Hjg.Core
dotnet new xunit   -o tests/Hjg.Core.Tests
dotnet sln add src/Hjg.Core tests/Hjg.Core.Tests
dotnet add tests/Hjg.Core.Tests reference src/Hjg.Core
# then: port Config + Conversion, port the §5 assertions, and:
dotnet test            # get it green before anything else
```

## Gotchas worth carrying over

- CA returns data under **`return`**, not `result`.
- **Discovery calls are counted by signup date** (`date_added`); mentee
  meetings / active mentees / mentors by the **scheduled** date.
- Conversion = offering **42840** on/after the call; 30-day window; **manual
  override wins**. The self-paced `32326` and test `42841` do *not* auto-convert.
- Account-local date bucketing (a `BUDGET_TZ` equivalent) so month boundaries
  don't drift by timezone.

## What to skip (at least at first)

- Vercel/serverless specifics.
- The duplicate client-side vs server-side metric paths — pick one in C#.
