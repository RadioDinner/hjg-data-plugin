# Session 018 — 2026-09-16

Branch: `claude/peaceful-noether-543uzn`, fast-forwarded onto `main`.
Investigation (turns 1–2), the classification fix (turn 3, **v0.7.1**), then
the canceled-appointment sync fix (turn 4, **v0.7.2**).

## Ask

User sees "events or meetings that are considered discovery calls that
shouldn't be" on Metrics (001) → *Discovery calls → conversion* card (003).
Asked how the card builds its data.

## How card 003 builds its data (traced end to end)

1. **Sync** (`lib/sync.ts:194-245`): one `Appointment.getAll` for the 3-year
   window (`syncYears()`), by START date, **without `includeCanceled`**.
   Each row's `name` → `categorizeAppointmentName()` (`lib/config.ts:40-49`,
   case-insensitive SUBSTRING match: "discovery call appointment (phone call)"
   → discoveryPhone, "... (zoom)" / bare "discovery call appointment" →
   discoveryZoom). `status` stored as returned. Upsert on `id` only — nothing
   is ever deleted or marked stale; `synced_at` is NOT refreshed on upsert.
2. **Browser fetch** (`src/db.ts` `pageDiscovery` ~661 + `fetchRangeAppointments`
   ~702): `category in (discoveryPhone, discoveryZoom)`, `status = 'A'`, range
   applied to **`date_added` (booking date)**, fallback `start_date` when null.
   Drops clients with `ca_clients.is_excluded` or `mentees.is_test`. Rows with
   null `client_id` pass through as prospect "Unknown".
3. **Outcome resolution** (`MetricsView.tsx:488-491` → `fetchResolvedOutcomes`
   → `lib/conversion.ts`): manual override > JumpStart WL purchase (offering
   42840) on/after `callDate` > pending ≤30 days > not_converted. **The card
   passes `date_added` as `callDate`**; the Discovery tab passes `start_date`.
4. **Card** (`MetricsView.tsx:675, 894-1020`): `discovery = appts.filter(c !==
   "mentoring")` — safe today because only the two discovery categories are
   fetched, but fragile. Counts appointments (not unique prospects), bucketed
   by `date`. Explore modal shows Signup date / Prospect / Type / Outcome /
   Reason only — **no appointment name, scheduled date, coach, or status**.

## Findings (ranked)

1. **Canceled calls never leave the mirror — confirmed in code.** Sync omits
   `includeCanceled` (docs: defaults false, `docs/coachaccountable-api.md`
   ~2332). A call synced while active and later canceled/deleted in CA is
   never returned again, so its row keeps `status='A'` forever and the card
   keeps counting it. If CA reschedules as cancel+rebook, the prospect shows
   twice. No stale-row cleanup exists and `synced_at` is not refreshed, so the
   mirror can't even detect these today.
2. **Substring classification on the label.** `name` is the effective label
   (`Appointment.add` `alternateLabel` overrides the type name), so anything
   whose label contains "discovery call appointment" counts; no type-ID or
   coach/prospect check. Snapshot in `public/data-map.html`: 84 discoveryZoom
   + 35 discoveryPhone of 3802 rows; 734 "other" rows are NOT counted.
3. **Booking-date basis, and the outcome clock runs from booking.** Counting
   by `date_added` is documented/deliberate; feeding `date_added` to the
   30-day pending window and the "purchase on/after the call" test looks
   unintended and makes the card disagree with the Discovery tab.
4. **Appointments ≠ prospects.** Two bookings by one person = 2 calls here;
   the funnel (`lib/funnel.ts:104`) counts unique clients.
5. **The audit view hides the evidence.** Explore can't show why a row is
   there. Workaround: Raw data tab → `ca_appointments` → column-filter
   `category`; or run `discovery_card_audit.sql` (this folder) in the
   Supabase SQL editor.

Could not verify against live data: no Supabase credentials in this container
(only `.env.example`).

## Directional decisions

None yet — assessment delivered, awaiting the user's read of the audit query.

## Next step (proposed, not done)

- Fix #1: sync with `includeCanceled: true` (same single API call; rows then
  carry status `C` and the existing `status='A'` filters drop them), AND set
  `synced_at = now()` on upsert so rows CA stops returning can be spotted.
- Add Name / Scheduled date / Coach / Status columns to the card's Explore
  modal (and the per-month drill-down).
- Decide whether the card's outcome `callDate` should be `start_date`.
- Optionally tighten classification to exact CA appointment-type names.

## Turn 2 — CONFIRMED against the user's Raw-data export (4,410 rows)

User uploaded a `ca_appointments` CSV export (2026-09-16) and asked whether
the 19 discovery calls on the dashboard include Mentor Training meetings.
**Yes.** Reproduced the card from the CSV (`reproduce_card_from_csv.py`):

- **`MT Discovery Call Appointment (Zoom)`** — 11 rows, category
  `discoveryZoom`. All 11 booked at the same second
  (`2026-08-25T12:59:29-05:00`), all for the same slot
  (`2026-09-12 08:00`), coach 9315, and all 11 client IDs also attend
  `Mentor Training Group Meeting`. That is ONE mentor-training session with
  11 attendees, counted as 11 discovery calls. Cause: the substring rule in
  `lib/config.ts` (`"discovery call appointment (zoom)"`) matches the label;
  `EXCLUDE_CONTAINS` only knows `"mentor training extra teaching"`.
- **The 19 = the August 2026 bucket** (booked-date basis): 11 MT + 5 Zoom +
  3 Phone. "Last month" preset reads 19; the true number is **8**.
  Full-year 2026 = 71 rows, of which 11 are MT.
- **Second classification bug:** `Discovery Call Appointment (Phone)` (9 rows
  since 2026-06-23, coach 29074 — the new booking type name) is filed as
  `discoveryZoom` because `DISCOVERY_PHONE_CONTAINS` only matches
  `"(phone call)"` and the generic rule defaults to Zoom. The card's
  Phone/Zoom split is wrong for those 9.
- **Corroborates finding #1 (canceled calls never leave the mirror):** every
  one of the 4,410 rows is `status = 'A'`; not a single `C`. And `synced_at`
  is the first-insert time (3,769 rows still stamped 2026-05-26), so the
  mirror cannot tell which rows CA stopped returning.
- Older bare `Discovery Call Appointment` rows (47) are 2024–2025 only.

## Proposed fix (awaiting go-ahead)

1. `lib/config.ts`: add `"mt discovery call"` to `EXCLUDE_CONTAINS`; add
   `"discovery call appointment (phone)"` to `DISCOVERY_PHONE_CONTAINS`.
   Add both cases to verify §7. Categorization runs at sync time → deploy,
   then **re-sync** (Admin) to reclassify existing rows.
2. Show Name / Scheduled / Coach in the card's Explore modal so this is a
   ten-second diagnosis next time.
3. Separately decide on `includeCanceled: true` in the sync.

## Turn 3 — SHIPPED (user: "lets merge the fix into main")

**What shipped**
- `2bfca7b` — `lib/config.ts`: `"mt discovery call"` added to
  `EXCLUDE_CONTAINS`; `"discovery call appointment (phone)"` added to
  `DISCOVERY_PHONE_CONTAINS`. `scripts/verify-metrics.ts` §7: +5
  classification cases. `package.json` 0.7.0 → **0.7.1**.
- Gates: `typecheck` green; `verify` **682/682**; `lint` 0 errors / 14
  pre-existing warnings; `build` green; Prettier clean on changed files.
- Replay of the user's export with the new classifier: 11 MT rows →
  `excluded`, 9 `(Phone)` rows → `discoveryPhone`; 2026 total 71 → 60;
  August 19 → 8. Post-fix monthly (Phone/Zoom): Jan 4/6, Feb 4/2, Mar 2/8,
  Apr 2/2, May 4/2, Jun 8/1, Jul 1/2, Aug 3/5, Sep 1/3.
- Merged to `main` by fast-forward; both branches pushed.

**User action required:** re-sync from Admin once the `main` deploy is live
(categorization runs at sync time; existing rows keep the old category until
then).

**Directional decisions**
- MT practice discovery calls are `excluded` (same bucket as "Mentor Training
  Extra Teaching"), not `other` — it's a known, deliberate non-count.
- The exclusion entry is the specific `"mt discovery call"`, not a broad
  `"mt "` prefix rule, to avoid false positives on unrelated labels.

**Open (carried in HANDOFF):** `includeCanceled` in the sync + `synced_at`
refresh; Explore-modal columns; outcome-date basis; substring-classifier
fragility.

## Turn 4 — "fix the cancelled bug" — SHIPPED as v0.7.2

**What shipped** (`lib/sync.ts`, `src/db.ts`, `lib/types.ts`, verify §27):
- `getAppointments({ includeCanceled: true })` — CA now returns "C" rows in
  the same single call; every reader filters `status='A'`, so they drop out.
- `toAppointmentRow(a, syncedAt)` extracted (pure, tested); every upserted
  row is stamped with the run's `synced_at`. Before, the DB default only
  fired on insert, so the stamp was frozen at first sight (export: 3,769 rows
  still stamped 2026-05-26).
- `markAppointmentsGone`: after the upsert, rows with `start_date` in the
  fetched window and `synced_at < run stamp` were not in CA's response →
  `status = 'X'` (`MIRROR_STATUS_GONE`, mirror-only, documented in
  `lib/types.ts`). Marked, not deleted (audit trail + `discovery_outcomes`
  FK-free but attached). Guarded against an empty CA response. Count goes to
  the run note.
- Mentee materialize (sync) + browser `rebuildMenteesFromCa` now select
  `status='A'` only — both had NO status filter and would otherwise have
  started ingesting the "C"/"X" rows.
- Gates: typecheck ✓, lint 0 errors, Prettier ✓, build ✓, verify **692/692**.
- Version 0.7.1 → **0.7.2**. Fast-forwarded to `main`.

**Mid-turn user report:** after running Admin → Sync the card still showed
71 / 20 Phone / 51 Zoom, Aug 19 — the exact pre-fix numbers, so that sync
ran the old classifier (deploy not live yet, or Metrics not reloaded). Left
UNRESOLVED; verification steps + fallback `reclassify_now.sql` are in
HANDOFF. This container cannot reach the site (proxy 403) to check the
deployed version.

**Directional decisions**
- Rows CA stops returning are MARKED (`X`), never deleted.
- Pending requests (`P`) are still not fetched — not part of the bug.
- `dateCanceled` not mirrored (would need a migration); revisit if audit
  needs it.

## Turn 5 — user confirmed: "fixed now"

After the v0.7.2 production deploy went live and a fresh Admin → Sync, the
user confirmed card 003 reads correctly. The earlier "still 71" sync had run
against the old deploy. Session closed; HANDOFF updated to RESOLVED.

## Turn 6 — topbar notifications icon: emoji → SVG bell (v0.7.3, ON BRANCH)

`src/components/NotificationsBell.tsx`: the 🔔 emoji replaced by an inline
outline bell (Lucide "bell", ISC) in `currentColor`; button class `btn` →
`icon-btn`; `aria-haspopup` / `aria-expanded` added; badge kept (offset −5).
`src/styles.css`: new `.icon-btn` rule shared with `.theme-toggle` (34px
square, `--panel-2`, muted → text on hover) so the two topbar icon controls
match. Version 0.7.2 → **0.7.3**. Gates: typecheck ✓, lint 0 errors,
Prettier ✓, build ✓, verify 692 ✓. Render-checked in headless Chromium
(light + dark) via a standalone preview using the app CSS — the real app
needs a Supabase login, which the container has no credentials for.
**Pushed to `claude/peaceful-noether-543uzn`, NOT merged to `main`** —
awaiting the user's go-ahead (a merge to `main` is a production deploy).
Optional follow-up: the theme toggle still uses text glyphs (☾ / ☀), which
sit slightly lighter than the SVG bell; matching SVG sun/moon would be
consistent.
