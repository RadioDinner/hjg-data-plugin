# Session 018 — 2026-09-16

Branch: `claude/peaceful-noether-543uzn`. Read-only investigation; **no app code
changed**, version stays 0.7.0.

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
