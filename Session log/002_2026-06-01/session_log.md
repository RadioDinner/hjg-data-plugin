# Session 002 — 2026-06-01

Branch: `claude/admiring-cray-nZJgk` (13 commits, pushed; not yet merged to `main`).

## What shipped (newest first)

- `3986131` — **Journeys: real engagement-based pipeline stages.** `engagementTier()`
  in `config.ts` maps engagement names → JumpStart/4x/2x/1x/graduated (handles
  modern `(Nx Month)` + legacy naming). Journeys derive real per-mentee stage
  dates from `ca_engagements`; aggregate rolls up DC→JumpStart→4x→2x→1x→grad.
  Verify §6 (13 cases).
- `c9cd1bc` — **Host data map on Vercel + clickable bubbles.** Moved to
  `public/data-map.html` (served at `/data-map.html`); click a bubble → detail
  drawer (relationships, key facts, distribution incl. engagement tiers).
  "Data map ↗" link on Raw data tab.
- `fdba37a` — **Interactive data-relationship map** (Obsidian-style D3 graph),
  first version under `docs/` (later moved to `public/`).
- `edcc6c1` — **Raw data: Export all → multi-sheet `.xlsx`** (one table per
  sheet) via `write-excel-file`. Per-table CSV export kept.
- `c4b99b5` — **Sync engagements (read-only) → `ca_engagements`.** `getEngagements()`
  (Engagement.getAll, no writes), migration `9994`, best-effort sync step,
  `CAEngagement`/`CaEngagementRow` types. Warnings now accumulate.
- `aa6dc81` — **Journeys: board-level pipeline stage-duration summary**
  (`aggregateJourneyDurations`, avg+median+n, bar chart + table).
- `149fc1d` — **Journeys tab: per-mentee timeline.** Migration `9995`
  (`mentee_outcomes`: active/graduated/quit/fired override), stage rail,
  observed meeting-rhythm chart, status override. Also fixed `config.ts` to
  classify generic "Discovery Call Appointment" as discovery (was `other`).
- `ed0d889` — **Discovery → conversion ChartCard** (converted bars + rate line,
  per-month series + table; replaced the stat-only panel).
- Log commits: `f57377d`, `bf33026`, `e2d33fa`, `e535c94`, `5b4d084`.

## Directional decisions

- **Mentor capacity inflation (Arthur Nisly "33 mentees") diagnosed, not fixed.**
  Cause: `capacityRows` counts distinct clients on any `mentoring` appointment
  for a coach, with no group-vs-1:1 split. Arthur (coach_id 9315) runs group
  "In Depth" sessions (up to 11 clients/slot) + multi-client weekly slots.
  Offered three fixes (categorize group sessions separately / exclude
  multi-client slots / exclude known group names) — **awaiting the user's pick.**
- **Pipeline tiers ARE in the data — via engagements, not appointments.** Earlier
  in the session we concluded appointment cadence couldn't reveal 4x/2x/1x
  (weekly throughout). The engagement sync proved the tiers live in
  `ca_engagements.name` (`MN Subscription | (Nx Month) …` + legacy variants).
  This let us build the real timeline.
- **Exit model:** mentee status inferred from activity (active if a meeting/open
  engagement within 45d, else inactive) + an "After Graduation Care" engagement
  ⇒ graduated; manual `mentee_outcomes` override (graduated/quit/fired + date)
  always wins. Quit/fired can land at any stage.
- **Data map = static snapshot** (2026-06-01 xlsx), table-level only (no PII).
  Could be wired to live Supabase later. The timeline itself reads live data.
- **All-tables export is `.xlsx`** (real sheets), per the user — a `.csv` can't
  hold multiple sheets.

## Verification status

`npm run typecheck`, `npm run verify` (6 sections, all pass), `npm run build` all
green at session end. **UI never exercised in a real browser** (headless,
Supabase-auth-gated container) — a preview pass is wanted.

## Open questions / next steps

1. **Mentor capacity inflation fix** — user to pick an approach (see above).
2. **Verify in preview:** Journeys tab (stage rail, current tier, aggregate),
   `/data-map.html` hosting + clickable bubbles, Export all `.xlsx`.
3. **JumpStart "—" risk:** mentees whose JumpStart engagement predates the
   3-year sync window show no JumpStart date. Consider widening `SYNC_YEARS`.
4. **Migrations to apply (Supabase SQL Editor):** `9995_mentee_outcomes.sql`,
   `9994_ca_engagements.sql` (engagements already synced, so 9994 is applied;
   confirm 9995 for the status override to work).
5. **Engagement sync budget:** first run used the unfiltered `Engagement.getAll`
   and succeeded (466 rows). If a future run rejects it, switch to per-client.
6. Possible follow-ons: per-mentee record-level graph; wire the data map to live
   data; CSV/quit-fire markers on the stage rail; merge branch to `main`.

## Prevalent notes for future-me

- `docs/coachaccountable-api.md` is the CA API source of truth — it confirmed
  the `Engagement` entity. Always check it before assuming CA behavior.
- Migrations are DESCENDING; next new one is **`9993_…`**.
- Engagement tier logic is **pure** in `config.ts` + verify-tested — extend the
  cases there if new engagement names appear.
