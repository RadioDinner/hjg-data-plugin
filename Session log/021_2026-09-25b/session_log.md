# Session 021b — 2026-09-25 — Save fix (v0.11.1) + hourly work on mentor payouts & Margins cost card (v0.12.0)

A **second session on 2026-09-25**, run in parallel with session 021 (email pay stubs,
v0.11.0 — see `Session log/021_2026-09-25/`). Both started from `main` @ `2cb5865`. Session 021
reached `main` first, so this one uses the `b` suffix (standing orders §1). Its work was
**rebased onto 021's `main`**, giving linear history with no merge commit. `main` was then
**fast-forwarded**, and branch `claude/determined-einstein-uudngk` was **deleted**, both on
the user's "merge your changes to main when you're finished and delete the branch". The chip
must read **`v0.12.0`**.

## What shipped (on `main`)

- `8d2dc50`: **Build payout save fix (v0.11.1).** A save with piece work blamed migration 9964
  for a missing `split_override` column. Save hints now come from a column→migration map
  (`lib/schemaFallback.ts`), and the builds load with `select("*")`. verify §31 (+43).
- `84d9aae`: **Hourly work on mentor payouts + Margins "Mentor pay cost by month" (v0.12.0).**
  Migration `9961_payout_build_hours.sql`. verify §32 (+50) and §33 (+34). **1,068 checks
  total.**
- This commit: the session wrap (HANDOFF, backlog, this log).

The pre-rebase commits `e78d4f5`, `596fbf4` and `b6f3788` on the deleted branch are
superseded by the two above. `596fbf4`'s docs are rewritten here.

Gates on the head: `typecheck` ✓ · `verify` 1,068 ✓ · `lint` 0 errors / 14 pre-existing
warnings ✓ · `build` ✓ · `prettier --check` ✓.

Render checks used a headless Chromium harness with a stubbed `../db`, deleted afterwards:
- Build payout, Hourly staff and Margins, light + dark, zero page or console errors.
- Edits recompute correctly: 6 h → 8 h gives $442.50; the rate change gives $497.50.
- The standing rate pre-fills $30 into a new month.
- The mentor pay stub HTML renders, and the emailed PDF was rasterized with pdf.js and
  inspected.
- Phone width (390 px): 0 overflow on Build payout and Margins.

## Turn 1: the save failure

The user hit *"Could not find the 'split_override' column of 'payout_builds' in the schema
cache — if this mentions piece_items, apply migration 9964"*. They had applied 9964 twice.

- **Root cause.** `split_override` comes from **9971**, and 9971 was never listed as a user
  action after it shipped (session 014 has no session log). The hint was hard-coded: any
  failed save with piece items blamed 9964.
- **Why it only surfaced now.** Saves without piece work silently dropped the column and
  succeeded. The old read ladder also fell back to the base columns whenever 9971 alone was
  missing, which hid "Payment sent" marks.
- **Proof that 9964 did apply.** PostgREST reports the alphabetically first missing payload
  column (`Plan.hs` `S.toList iColumns` + `traverse`, same code in v14.9 and v16.4), and
  `piece_items` sorts before `split_override`.
- **Resolution.** The user re-applied 9971 and reported "it is working" (turn 2).

## Turn 2: hourly work on mentor payouts + Margins cost

The user's answers:
- Hours are **hand-entered** for now; "eventually they'll clock in and out".
- Hourly is **paid 100%** to the mentor, like the other hourly staff.
- It goes on the **same stub**.
- It **counts as a cost on Margins**.

AskUserQuestion answers: a **new monthly card**, and **piece work counts too**.

**Build payout §204: "Hourly work" card (§212).**
- Components: `HourlyWorkCard` over a new shared `TimesheetTable`. Hourly staff (§206) now
  uses the same table.
- Default rate: pre-filled by `standingHourlyRate`, the mentor's latest other build with a
  rate, preferring earlier months.
- Totals: `summarizeBuild(…, hours, hourlyRate)` adds labor to `builtTotal`, never to
  `computedTotal`. The Split % never applies.
- CSV: `extraPayCsvRows` adds piece and hourly rows, so the rows add up to the TOTAL.
- Persistence: `payout_builds.hour_items`, `hourly_rate` and `hours_pay_total`, registered
  in `PAYOUT_BUILD_COLUMN_MIGRATIONS`.

**Stub (`lib/payStub.ts` HTML + `lib/payStubPdf.ts` PDF).**
- Hourly rows in the summary table.
- Both extras share one "Piece work + hourly" card, so the row stays at four cards; five
  collided at print width.
- The hero card breaks the total into Revenue share / Piece work / Hourly work.
- **`totals.delta` changed meaning:** it now covers review changes to the revenue share only
  (`linePayout − enginePayout`). Before, piece work showed up as "Review adjustments". Plain
  stubs read exactly as before.

**Margins §608 "Mentor pay cost by month" (+ §609 per-mentor inset).**
- Math: `computeMentorPayCost` runs `computeMenteeMargin` for **every** mentoring client
  (fetched by `fetchMarginMembers("all")`, including mentees who have left) and sums by month.
- Cost: approved piece work + hourly from `payout_builds`. Drafts are listed but not
  counted.
- HJG share uses the tab's mentor-share **assumption**; the extras are **actual**.
- Ranges 6 / 12 / 24 months / All, every calendar month shown. Totals add up to the monthly
  columns.

**Integration with session 021 (after `main` moved).**
- Migration **renumbered 9962 → 9961**, because 021 took 9962 for the pay-stub email work.
- The **email path** (`emailStub`) now builds its model with the hours. The server re-checks
  the stub total against `payout_builds.built_total`, so without them an approved build with
  hourly work could never be emailed.
- `mentorStubPdfDoc` renders hourly rows, the shared card, the hero breakdown and the fine
  print. verify §32 renders a real PDF.
- Test sections renumbered: 021's email tests are §30, then this session's §31, §32 and §33.

**CSS.**
- `.collapsible__head` / `.collapsible__extras` wrap at ≤760 px; before, card-header actions
  pushed the page sideways.
- `.builder` uses `minmax(0, 1fr)` at ≤900 px, so wide tables scroll inside their box.

## Directional decisions

- A monthly lens for the cost, not an allocation into the per-tier margins.
- Piece work counts as a cost alongside hourly.
- Approved builds only; drafts are listed, not counted.
- The standing rate lives on the builds (pre-fill from the latest one). No new
  coach-settings column or UI was added.
- Linear history: rebased onto 021's `main`, no merge commit, same as prior sessions.

## Open questions / next step

1. **User: apply `9961_payout_build_hours.sql`**, then do one real hourly build: approve,
   print, and **email** a stub to themselves, and confirm the PDF shows the hourly lines. Then
   look at Margins §608.
2. Time clock → hourly import. The backlog entry has three open questions: submitted-only,
   locking, double-import guard.
3. A mentor with hourly work but **no revenue lines** that month can't be built: the month
   list and Save both need engine lines. Use Hourly staff for that, or extend the builder.
4. §608's HJG share is assumption-based. A "true net" using the actual approved revenue-share
   payouts could follow.
5. Should the other hourly staff (`staff_pay_builds`) count in Margins too, as overhead?
6. Cosmetic, from 021: on Hourly staff, the "New staff" input row overflows at 390 px.
7. **Next migration number is `9960`.**

## Prevalent for future-me

- **Parallel sessions happen.** Always `git fetch origin main` before merging. When `main`
  has moved:
  - rebuild with cherry-picks onto it;
  - renumber any colliding migration;
  - use a `b` session-log folder;
  - re-run every gate on the result.
- Every migration a session adds must stay listed as a user action in START HERE until the
  user confirms it's applied.
- New optional `payout_builds` columns go in `PAYOUT_BUILD_COLUMN_MIGRATIONS`. Don't
  hand-write "if this mentions X" hints.
- Anything added to the mentor stub model must also go into **`mentorStubPdfDoc`** and the
  **`emailStub`** model, because the server checks the emailed total against `built_total`.
- The pdfmake fonts in Node come from the setup in verify §30 (`setFonts` with Roboto from
  `node_modules/pdfmake/fonts`). There's no rasterizer in the container: pdf.js 3.11 from a
  scratchpad `npm install` plus Chromium works.
