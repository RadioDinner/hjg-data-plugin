# Session 021 — 2026-09-25 — Build payout save fix: wrong migration hint (v0.10.1)

Branch: `claude/determined-einstein-uudngk` (from `main` @ `2cb5865`, v0.10.0). Version bumped
0.10.0 → **0.10.1** (patch: a fix). **Not merged to `main`:** the user hasn't said to merge.

## What shipped

- `e78d4f5`: Build payout now names the migration that owns a missing column and loads any
  migration mix (v0.10.1). New `lib/schemaFallback.ts`, used by `savePayoutBuild` /
  `fetchPayoutBuilds` in `src/db.ts`. verify §30 adds 43 checks (913 total).
- (this commit): session wrap. Adds a `FEATURE_BACKLOG.md` entry (hourly wages on mentor
  payouts), the HANDOFF START HERE and this log.

Gates on the head: `typecheck` ✓ · `verify` 913 ✓ · `lint` 0 errors / 14 pre-existing
warnings ✓ · `build` ✓ · `prettier --check` ✓. The fix is not browser-tested against a live
Supabase: this container has no credentials. It is exercised through the real retry loop
against a fake PostgREST.

## The bug (user report)

> "Save failed: Error: Could not find the 'split_override' column of 'payout_builds' in the
> schema cache — if this mentions piece_items, apply migration 9964_pay_piece_work.sql"
> …"I have applied that migration twice now."

**Root cause: two defects in the code, plus one migration the user never applied.**

1. **`payout_builds.split_override` doesn't exist in the user's database.** Migration
   **`9971_payout_build_split.sql`** adds it, not 9964. It shipped on 2026-07-20 (commit
   `3fd6f02`, session 014), and **no HANDOFF or session log ever listed it as a user action**.
   Only the in-app help for Split % mentions it. Session 014 has no `session_log.md`, and the
   session-015 cutover list named five migrations (9965–9969) but not 9970 or 9971. That's
   our process miss, not the user's.
2. **The hint was hard-coded.** `savePayoutBuild` blamed 9964 for any failed save that had
   piece items, whatever column PostgREST actually named. Re-running 9964 could never help.
3. **The fallbacks depended on the order migrations were applied.** Saves without piece work
   silently dropped `split_override` and succeeded, which is why the problem only showed up
   once piece work was added. Reads went through a fixed ladder that fell back to the base
   columns whenever 9971 alone was missing. That hides saved piece work and
   "Payment sent" marks (9969) on reload.

**Evidence that 9964 did apply.** PostgREST resolves the payload keys as a
`Data.Set` (`S.toList iColumns`, so ascending order) and reports the **first** missing one
(`resolveOrError … traverse`). The same code appears in v14.9 and v16.4, in `Plan.hs`
`typedColumnsOrError`, `ApiRequest/Payload.hs` `payKeys` and `Error.hs` `ColumnNotFound`.
`piece_items` and `pieces_total` sort before `split_override`, so if they had been missing,
the error would have named them. The old logic was replayed against a fake PostgREST (9964
on, 9971 off) and reproduced the user's message character for character.

## The fix

- `lib/schemaFallback.ts` (pure):
  - `missingColumnFromError` reads PGRST204 and both Postgres 42703 forms.
  - `PAYOUT_BUILD_COLUMN_MIGRATIONS` maps `split_override` to 9971 and
    `piece_items` / `pieces_total` to 9964.
  - `saveFallback` / `saveWithFallback` drop a missing column only while it holds its default
    (no split override, no piece work). Otherwise they stop and name the migration for **that**
    column. Any other error (RLS, network) passes through unchanged. Each retry drops a key the
    row still has, so the loop terminates, and it works on a copy of the row.
- `fetchPayoutBuilds` reads `select("*")`: any subset of 9964 / 9969 / 9971 loads.
- The `staff_pay_builds` path was left alone. It has one optional group (9964), so its
  fallbacks can't misfire the same way.

## Directional decisions

- **Hourly wages on mentor payouts** (the user: "Long term, …"): **scoped only, not built**,
  per CLAUDE.md's plan-first rule. Full entry at the top of `FEATURE_BACKLOG.md`: proposed
  shape, migration `9962`, `coach_settings.hourly_rate` and four decisions for the user.
  Workaround today: add the mentor as a person under Hourly staff (§206). That gives a
  separate payout and a separate stub.
- Version bumped on the branch (0.10.1) as in prior sessions; `package-lock.json`'s version
  field was already stale (0.7.0) and was left alone, as before.

## Open questions / next step

1. **User action: apply `9971_payout_build_split.sql`** (Supabase SQL Editor, re-runnable).
   That alone fixes the save on the currently deployed code. Then confirm the columns with:
   `select column_name from information_schema.columns where table_schema = 'public' and
   table_name = 'payout_builds' order by ordinal_position;`. Expect `split_override`,
   `payment_sent_at`, `payment_ref`, `piece_items` and `pieces_total`. If `payment_*` are
   missing, apply `9969` too. If 9971 is applied and the error persists, run
   `NOTIFY pgrst, 'reload schema';`.
2. Merge v0.10.1 to `main` when the user says so.
3. User to answer the four hourly-wage questions (backlog entry) before any build.
4. Carried over from session 020: Margins lenses testing, 9963 + re-sync, persisting the
   Margins assumptions.

## Prevalent for future sessions

- **Every migration a session adds must be listed as a user action in HANDOFF START HERE**
  until the user confirms it's applied. 9971 slipped for two months because it wasn't.
- New optional columns on a table saved from the browser: register them in a
  column→migration map (`lib/schemaFallback.ts`) and read with `select("*")` (or a
  per-column fallback). Don't hand-write "if this mentions X" hints, and don't build
  fixed-order retry ladders.
