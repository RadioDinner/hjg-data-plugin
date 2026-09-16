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
