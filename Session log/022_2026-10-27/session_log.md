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

## Directional decisions
- The export replaces the 6-row summary for §005 (the on-screen table already shows that).
- A person in two tiers appears once per tier, matching the tiles. "Total in pipeline" is the
  count of distinct Client IDs in the file.

## Open / next
- User: export on the live app and confirm the row counts match the tiles (17 / 29 / 16 / 4).
- No migration this session. Next migration number is still `9960`.
