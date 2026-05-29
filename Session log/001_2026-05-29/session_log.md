# Session 001 — 2026-05-29

## What shipped

Commits made on `main` this session (newest first):

- `(pending)` — Mentor capacity editor + CSV export across the app
- `38c0b47` — Standing-orders framework + CA API source of truth
- `a4cbe88` — Stack tables under graphs; bring back Explore for raw audit data
- `4ff9b55` — Restore chart sizing and drop split breakpoint to 760px
- `79a66db` — Show every metric as graph AND table at once

(The first three reached production via the Vercel main alias once promoted
— see "Vercel production-pin bug" below.)

## Directional decisions

### Graphs + tables layout
- v1 of the north-star "graph AND table at once": started with side-by-side
  on every ChartCard (`Graph / Table / Both` toggle, default Both, persisted
  per card under `hjg.chartcard.view:<title>` in localStorage).
- Within this session the user revised it: **tables stacked below the graphs
  always** — side-by-side was too cramped inside the 1100px app shell. Final
  layout: flex column, no media query.
- Inline tables **do not scroll internally**. Cards grow with the data; page
  scrolls instead. This is a dashboard, not a data-grid.

### Explore button: separate from the inline tables
- Initial v1 deleted `ExploreModal` because the inline table replaced it.
- User asked for it back, but populated with **raw appointment-level audit
  data** (not the per-month aggregation the inline table already shows).
  Each ChartCard now has both: the inline aggregated table AND an Explore
  button that opens a modal with the raw underlying rows so numbers can be
  audited against CoachAccountable directly.
- Per-card raw data builders (`exploreDiscoveryRaw`, `exploreMeetingsRaw`,
  `exploreMenteesRaw`, `exploreMentorsRaw`, `exploreManualRaw`) in
  `src/views/MetricsView.tsx`.

### Recharts sizing
- A subtle regression: moving the chart container's dimensions from inline
  style to a CSS class caused `ResponsiveContainer` to measure -1×-1 before
  the stylesheet applied (5x warning in production console). Restored
  inline `width: 100%; height: 240` on the chart wrapper and passed explicit
  `width="100%" height="100%"` to `ResponsiveContainer`. Deterministic now.

### Vercel production-pin bug (debug story worth remembering)
- The Vercel "Production Deployment" alias was pinned to commit `d40ecf9`
  from `claude/magical-pasteur-bwdWx` (a deleted branch), which predated
  the JumpStart auto-conversion automation. Every "regression" symptom
  (Discovery→conversion stuck at zero, "Not yet recorded" labels, no Status
  column on Discovery tab) was actually that **old build** still serving —
  not a code regression.
- Confirmed by grepping production UI strings against git history:
  `"Not yet recorded"` and `"Based on the outcomes recorded on the Discovery
  tab"` only exist in commits BEFORE `46f6072`.
- Resolution: user promoted the latest `main` deployment to Production in
  the Vercel Deployments tab. Changing Production Branch in Settings is
  not enough — the alias has to be re-pointed at a specific build (or a
  new push triggers one).
- **Standing rule for future sessions**: when a "regression" appears,
  check whether Vercel's production alias is actually pointing at the
  latest `main` commit before assuming code is at fault.

### Standing-orders framework (this session, mid)
- Established `new_session_instructions.md` at repo root as the user's
  living standing-orders contract.
- `CLAUDE.md` updated to reference it + the CA docs source of truth.
- `Session log/` folder created with this session as `001_2026-05-29/`.
- `docs/coachaccountable-api.md` is the only source of truth for
  CoachAccountable API behavior going forward.

### Mentor capacity model + editor
- New HJG-owned table `coach_settings` (migration `9996_coach_settings.sql`)
  keyed by `coach_id`: `is_mentor` (bool), `capacity` (int nullable),
  `notes` (text). Same RLS pattern as `manual_metrics`.
- Editor lives on **Admin → Mentor capacity** card with All / Mentors-only
  filter, per-row dirty tracking, and bulk Save changes button. Saves
  upsert by `coach_id` so re-edits don't duplicate.
- **Behavior knob on Metrics**: when *any* `coach_settings.is_mentor=true`
  rows exist, the Mentors metric (KPI + per-month bar + aggregated table)
  is restricted to that whitelist client-side. Empty roster = no filter
  (current behavior preserved), so the editor activates incrementally.
- New **Mentor capacity utilization** card on Metrics: stat row
  (mentors flagged, mentees in range, total capacity, overall utilization)
  + per-mentor table sorted by utilization desc. Has its own Explore +
  Export CSV buttons.
- `exploreMentorsRaw` now keys by `coachId` (not name) and adds a
  "Flagged is_mentor?" column so staff can audit which coaches to flag.

### CSV export
- New `src/csv.ts`: RFC4180 quoting + UTF-8 BOM (Excel-friendly) + filename
  slugify with today's date. Exposes `toCsv` + `downloadCsv`.
- Export CSV button added in three places:
  - Every **ChartCard** header — downloads the per-month aggregated table.
  - **Explore modal** header — downloads the raw audit rows currently shown.
  - **Raw data tab** header — `fetchAllRows()` pages through the selected
    `ca_*` / `discovery_outcomes` / `coach_settings` / etc. table and exports
    every row. The on-screen view still shows the first 100 for speed.
- `RAW_TABLES` now includes `coach_settings`.

## Open questions / next step

- **Apply migration `9996_coach_settings.sql`** in the Supabase SQL Editor
  before the Admin → Mentor capacity card or the new dashboard utilization
  card will work (they'll just error / show empty until the table exists).
- Vercel env vars: should double-check that all required vars (SUPABASE_*,
  CA_API_*, etc.) are scoped to **Production** (not just Preview), now
  that production actually deploys from `main`. The handoff calls this
  out and it bit us once already.
- Bundle warning still cosmetic (recharts > 500 kB) — no action needed yet.
- Follow-ons offered but not done: sortable / filterable inline tables,
  "Calls held" toggle for discovery (vs signup date), retire the unused
  `MENTOR_COACH_ID_WHITELIST` from `lib/config.ts`.

## Files touched this session

- `src/views/MetricsView.tsx` — ChartCard refactor; per-card tables; raw
  Explore builders; mentor filter; Mentor capacity utilization card;
  Export CSV button on every ChartCard.
- `src/views/AdminView.tsx` — Mentor capacity editor card with
  All/Mentors-only filter, per-row dirty tracking, bulk save.
- `src/views/RawDataView.tsx` — Export CSV button that pages through
  the full table; `coach_settings` in the table picker.
- `src/components/ExploreModal.tsx` — deleted in v1, restored for raw
  data, now with Export CSV button.
- `src/csv.ts` — new RFC4180 CSV utility + download helper.
- `src/db.ts` — `fetchCoachesWithSettings`, `fetchMentorCoachIds`,
  `upsertCoachSettings`, `fetchAllRows` for export; `coach_settings`
  added to `RAW_TABLES`.
- `src/styles.css` — chart-card__split layout; modal styles back; no
  internal table scroll.
- `supabase/migrations/9996_coach_settings.sql` — new HJG-owned table
  with re-runnable RLS + trigger.
- `HANDOFF.md` — refreshed (graphs+tables shipped; mentor inflation
  marked addressed by `coach_settings`).
- `CLAUDE.md` — references new standing-orders file + CA docs.
- `new_session_instructions.md` — created (root).
- `docs/coachaccountable-api.md` — created (4949 lines, full CA API docs).
- `Session log/001_2026-05-29/` — created (this file + `prompt_history.txt`).
