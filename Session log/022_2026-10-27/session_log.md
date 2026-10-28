# Session 022 — 2026-10-27

## What shipped
- **§005 "JYF vs Active Mentoring" Export CSV now exports the people, not the summary table (v0.13.0).**
  - `lib/cohort.ts` `jyfVsMentoringRoster(engagements, asOf?)`: one row per cohort × person
    (JYF / 4x / 2x / 1x), same distinct-people rule as the tiles, sorted by cohort then name.
    Two open engagements in one tier collapse into one row listing both names.
  - `src/db.ts` `fetchJyfCohortInputs` now also reads `ca_clients.name/first_name/last_name`.
  - `ChartCard` gained an optional `exportCsv` override; §005 uses it.
  - CSV columns: Cohort, Client, Client ID, Open engagement(s), Engagement start, Added to CA.
    With Compare on, a leading Snapshot column; today's roster then the as-of roster.
  - Verify §15 extended (roster counts = tile counts, ordering, names, as-of roster).
  - Help article "metrics.jyfVsMentoring" documents the export.

- Merged to `main` by fast-forward on the user's "merge to main".

- **§005 cohort drill-down (v0.14.0, branch only, not merged).** Each row of the §005 table has a
  ▸ toggle that opens the list of people in that cohort (name, open engagement(s), engagement
  start). Active Mentoring and Total list each person once with a Cohort(s) column. With
  Compare on, people new since the earlier day get a green "new" tag and a "Left since …" line
  names who dropped out.
  - `lib/cohort.ts` `jyfGroupMembers` (six groups; sizes = tiles) and `diffMembers`.
  - `ChartCardTable` gained an optional `details` array; `ChartDataTable` renders expandable
    rows (zebra by data-row index; open state keyed by row label, survives compare toggles).
  - Verify §15 extended; help article updated.
  - Render-checked with a temporary headless Chromium harness and stubbed Supabase responses
    (light, dark, 390 px, compare on). The harness was deleted afterwards.

## Directional decisions
- The export replaces the 6-row summary for §005 (the on-screen table already shows that).
- A person in two tiers appears once per tier, matching the tiles. "Total in pipeline" is the
  count of distinct Client IDs in the file.

- Drill-down lives inside the table (not the Explore modal), per the north star of graph +
  table visible together.
- Compare mode shows churn behind a flat Δ (e.g. 4x Δ 0 can hide one join and one leave).

## Open / next
- User: try the drill-down on the live app once merged; say "merge to main" to ship v0.14.0.
- User: export on the live app and confirm the row counts match the tiles (17 / 29 / 16 / 4).
- No migration this session. Next migration number is still `9960`.
