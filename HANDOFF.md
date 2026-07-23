# HJG Data Hub — Handoff

Working notes for resuming this project in a future session. Last updated
2026-07-22 (session 015 — pay payment-tracking, permissions bones, Update Mentee /
Time clock / financial-event tabs, Margins save fix).

## ▶ START HERE (2026-07-22, session 015 — WRAPPED, MERGED TO `main`, v0.5.0)

**Session WRAPPED, everything MERGED TO `main`** (fast-forward from
`claude/pay-staff-screen-updates-sagejz`; commits `c0715ec` features + `ac49ced`
adversarial-review fixes + wrap + `0.5.1` pay-stub font change). **Version 0.5.1**
(chip must read `v0.5.1`). `typecheck` + `verify` (**622 checks**, 3 new sections)
+ `build` green. Pay-stub layout render-checked with headless Chromium; other UI
NOT browser-tested. Full detail in `Session log/015_2026-07-22/session_log.md`.

**0.5.1 — pay-stub fonts modernized.** `lib/payStub.ts` `STUB_CSS` (shared by the
mentor AND hourly stubs) swapped Georgia/Times serif + Arial accents for a
self-contained system-UI **sans** stack (`--sans`), +line-height/smoothing, h1
retuned to 600/−0.5px. Purely cosmetic; verify/build green.

**0.6.0 — collapsible cards on EVERY screen + expand/collapse-all, persisted.**
New `src/components/Collapsible.tsx`: `CollapseProvider` (one per tab, `App.tsx`
`key={tab}`) persists the collapsed set to `localStorage["hjg.collapse.<tab>"]` so
a user's expand/collapse choices survive reload; `CollapsibleCard` (accessible
accordion, rotating chevron, keeps the SectionId badge + header action buttons);
`CollapseControls` (Expand all / Collapse all, hidden until ≥2 sections). Every
view's cards were converted (Metrics via making `ChartCard` collapsible +
PipelineTiming/Funnel/capacity; Admin, Company options, Pay staff, Time clock,
Financial event, Update Mentee, Discovery, Margins, Raw data, Maps, Mentees
roster+detail). Default = all expanded (no behavior change until a user collapses).
Body is unmounted while collapsed (chart-safe; transient unsaved input in a card is
lost if collapsed — noted in the component). Also a pay-stub copy tweak ("does NOT"
→ "does not reduce your pay"). typecheck ×2 + verify (622) + build green;
render-checked in headless Chromium. **No migration.**

**⚠⚠ CUTOVER — TWO USER ACTIONS:**
1. **Apply FIVE migrations** (Supabase SQL Editor, any order, re-runnable):
   **`9969_payout_payment_sent.sql`** (Payment-sent columns), **`9968_app_users.sql`**
   (permissions), **`9967_mentee_transition_options.sql`** (Transition-to seed),
   **`9966_time_entries.sql`** (time clock), **`9965_financial_events.sql`**
   (financial events + notifications + receipts bucket). If `9965` prints a NOTICE
   about storage privileges, create the private **`receipts`** bucket + authenticated
   SELECT/INSERT policies in the dashboard by hand. Until applied, each feature
   degrades with an explicit on-screen error (nothing else breaks).
2. **Company options → Payment groups → tick the real mentors in the "Mentors"
   group's COACH row.** The Build-payout (§203) mentor dropdown only filters once
   ≥1 coach is assigned — **that's what removes Neal Zimmerman** (he's no longer a
   mentor). With no coaches assigned it falls back to all coaches with pay lines.

**What shipped (session 015):**
- **Pay staff §203/§204** — mentor list from the Mentors Payment-group; service
  month defaults to the **last paid month** (else previous month → June on
  2026-07-22); **Payment sent** button + Melio-reference dialog (§906); `paid ✓`
  pills / `— paid ✓` dropdown markers / **Reprint pay stub** / per-month
  **Payments completed** strip. Pure logic in `lib/paySchedule.ts` (verify §13h).
- **User permissions bones** — `app_users` (email-matched) + `lib/permissions.ts`
  (verify §25) + **Admin → User permissions (§405)** card; App.tsx nav renders
  from `APP_TABS` filtered per user. **No row = all tabs**; admins always all;
  mentor role defaults to none (future mentor logins get a `coach_id` link).
- **Update Mentee tab (§551/§552)** — Transition Mentee form: load a mentee →
  from-state (CA details, our status, current engagement) → **Transition to…**
  dropdown from Company options (new `"list"` control; §26 verify). Apply is a
  disabled "coming soon" (bones by request).
- **Time clock tab (§208/§209)** — clock in/out (DB-backed), notes, delete
  unsubmitted, **Submit for payroll** (locks), week/month tiles, all-staff month
  table. One-open-entry guarded by a partial unique index.
- **Report financial event tab (§651/§652)** — date/vendor/description/method +
  receipt upload (private bucket, signed URLs); submit alerts staff via the new
  **topbar notifications bell (§907)** (60s poll, unread badge, mark-all-read,
  atomic `mark_notification_read` RPC).
- **Margins §601 save bug FIXED** (user report: entered numbers didn't save or
  chart). The logic was sound — failures were SILENT (missing table/RLS swallowed;
  failed saves left the typed number showing). Now: prominent storage banner,
  row-verified writes, failed saves revert the cell, success flashes ✓. If saving
  still fails for the user, the banner now states the exact cause (likely `9981`
  never actually applied).
- **Adversarial review pass** — 61-agent workflow (7 area reviewers + 2 refuters
  per finding): 27 raw → **25 confirmed, all fixed** in `ac49ced` (highlights: a
  pre-scoped Build→ month was wiped on mount; `ilike` email matching could resolve
  the WRONG user's permissions via `_`/`%` wildcards; UTC month attribution in time
  totals; concurrent notification dismissals lost; storage DDL rollback risk in
  9965; `setCompanyOption` false "Saved ✓" on unseeded keys — that last one now
  guards EVERY company option).

**Conventions locked this session:** verify writes with `.select()` and surface
errors (no more silent Supabase no-ops); `APP_TABS` (`lib/permissions.ts`) is the
single source of truth for top-nav tabs; time-entry/app-user emails are stored
lowercased. **Next new migration is `9964_…`.**

**Next session:** browser-verify the five new surfaces + cutover; then the teed-up
phases — wire **Apply transition** (record it), notification **targeting** (org
support group vs everyone), time-clock → payroll (Hourly staff §206) integration,
admin-only enforcement of §405.

---

## ▶ Prior session START HERE (2026-07-09, session 013 — WRAPPED, MERGED TO `main`)

**Session WRAPPED.** Two things shipped and are **both MERGED TO `main`** (fast-forwarded from
`claude/payout-calculation-csv-export-mez3a9`; `main` = branch = `30d0723` at wrap, then this
handoff commit on top): (A) payout invoice transparency (drill-down + "data used to build the
payout" CSV), and (B) a **Payment-groups** feature — an admin grid picking which engagement
templates count for which staff group. `typecheck` + `verify` + `build` all green.
**UI NOT browser-tested** (headless container — no live Supabase creds). Full detail in
`Session log/013_2026-07-09b/session_log.md`.

**▶ THE ONE PENDING ACTION — cutover for (B) (see next paragraph).** Everything else is done.

**⚠ CUTOVER for (B): apply `9972_pay_engagement_groups.sql`** in the Supabase SQL Editor, then click
**Company options → Payment groups → Refresh templates** (or run Admin → Sync) to populate
`ca_engagement_templates`, then **check the mentoring templates for the "Mentors" group** (the
(4×/2×/1× Month) MN Subscriptions) and leave JumpStart/JYF/(0x)/groups/MT unchecked. **Until a group
has any templates checked, payouts use the legacy 4×/2×/1× auto-detection** (unchanged), so applying
the migration is safe on its own. **Next new migration is `9971_…`.**

**⚠ DIAGNOSIS CORRECTION — Ty Miller's $430.83.** An earlier note here claimed the excess over $425
was a legit *rollover / second 4× invoice*. **That was wrong** (stated without seeing the invoice
line items). The real cause: **JumpStart Your Freedom "Supervised Progress" (non-MN-Subscription)
revenue is swept into the mentoring basis** because the engine pays on the invoice's **total
`amount`** and gates only by whether a 4×/2×/1× engagement covers the invoice DATE — it never
inspects the invoice's own line items. The user's rule: **only MN Subscription mentoring counts.**
The Payment-groups grid (B) is the durable fix (uncheck JYF). **STILL OPEN** (user deferred the exact
invoice breakdown): whether the pay basis must ALSO be filtered at the **line-item** level — i.e. if
a JYF charge is a line item on the SAME invoice as an MN Subscription charge, the grid gates by
engagement template but the engine still sums the invoice TOTAL. Confirm the invoice structure, then
decide if line-item filtering is also needed.

**(A) Payout transparency — shipped + merged to `main` (commits `5b37c31`, `505d38f`).** Engine
(`lib/pay.ts`) `PayMenteeLine`/`PayLedgerRow` carry `sources: PayLineSource[]` (the invoices — with
payment dates + line items — whose two-month slices built the line; math unchanged, additive).
`fetchAllPayInvoices` now loads `id/invoice_number/line_items/payments` (already in `ca_invoices` 9993).
`payoutDetailCsvRows()` → §204 Export CSV is now **one row per contributing invoice** with payment
dates. §204 **mentee name → `PayoutLineDetailModal` (§905)** (invoices + payment dates/methods + line
items + the earned→payout math). Pay Explore Invoices (§901) gained Invoice #/Payment dates/methods/
line items. verify §8/§13.

**(B) Payment groups — engine templates × staff groups (Company options §451, `options.payGroups`=452).**
- **`9972_pay_engagement_groups.sql`** — `ca_engagement_templates` mirror (RLS read) + seeds
  `app_settings` key `pay_engagement_groups` (default: one empty "Mentors" group).
- **CA/sync** — `Engagement.getTemplates` (`ca.getEngagementTemplates`); `runSync` upserts templates
  (best-effort) + standalone `syncEngagementTemplates()` (records a `sync_runs` row so the daily CA
  cap accounts for refreshes) behind **`api/sync-templates.ts`** + `refreshEngagementTemplates()`.
- **`lib/payGroups.ts`** (pure) — parse/serialize, `normalizeTemplateName`, `payEligibleForGroup`
  (predicate or **null** when a group has no templates → legacy fallback), `MENTORS_GROUP_ID`.
- **Engine** — `computePayReport`/`mentoringCoverFor` take optional `payEligible(name)`; when present
  it **replaces** the `MENTORING_PAY_TIERS` gate, else legacy. Tier label still from the name.
- **`src/db.ts`** — `fetchEngagementTemplates`/`fetchPayGroupsConfig`/`savePayGroupsConfig`;
  `fetchPayData` builds `payEligible` from the Mentors group (`?? undefined` → legacy). Threaded into
  all pay call sites. `ca_engagement_templates` in RAW_TABLES.
- **UI** — `src/components/PayGroupsCard.tsx` on §451: template×group + coach×group checkbox grids,
  add/rename/remove group, Refresh button, debounced save. Help `options.payGroups`. verify §9b.

**Review (B):** adversarial review via 3 parallel subagents — engine/payGroups/db **clean**;
sync/CA/migration found **1 low-sev** (refresh CA call didn't count against the daily budget) — **fixed**
(records a `sync_runs` row); UI found **2 minor** (sub-500ms unmount save-drop; blank rename box on
empty blur) — **both fixed** + dead `lastSavedRef` removed + coaches grid shown without templates.

**Next session:** DO THE CUTOVER (apply `9972` + Refresh + configure Mentors). Browser-verify §204
drill-down + CSV, Pay Explore Invoices columns, and the §451 grid (toggle a template → payout changes;
add/rename/remove group; coach assignment; Refresh). Resolve the OPEN line-item question once the user
sends the invoice breakdown. Optional: extend the clickable-name drill-down to §205 + Explore ledger.

**Next new migration is `9971_…`.**

## ▶ Prior session START HERE (2026-07-09, session 012)

**Mentor-payment correctness pass + a new reconciliation feature — MERGED TO `main` (session
WRAPPED 2026-07-09).** Developed on `claude/mentor-payment-verification-3asxd8`, fast-forwarded to
`main`; both refs at the same commit. `typecheck` + `build` + `verify` all green. **UI NOT
browser-tested** (headless). Full detail in `Session log/012_2026-07-09/session_log.md`.
**ALL migrations are applied** (user confirmed 2026-07-09) — including `9973` and every prior
pending one (9974–9986 etc. listed further down are historical and now moot). **No migrations
pending. Next new migration is `9972_…`.**

**The user's rules (locked via AskUserQuestion 2026-07-09):** (1) mentee pay follows the
**owner** (`ca_clients.coach_id`), so Jonathan Heinzman → Caleb even though his 4× is cut under
Arthur in CA; (2) **only 4×/2×/1× mentoring counts — JumpStart/JYF is excluded** from mentor pay;
(3) the running total spans a mentee's **full 4×/2×/1× history**; (4) **per-mentor ramps** —
default 35/50/60, but **Caleb Otto (40711) is fast-tracked to 50/60/60**. Verified against the
export: **Caleb June 2026 = $765.00**; running-through-June $2,130.67 + remaining $348.50 =
$2,479.17 billed-to-date.

**What shipped:** engine (`lib/pay.ts`) JYF exclusion (`MENTORING_PAY_TIERS`, `excludedBilled`)
+ per-mentor ramp (`rampOverride`, `splitForTenureMonth(t, ramp)`, `parseRampSpec`/`formatRampSpec`);
migration **`9973_coach_pay_ramp.sql`** (`coach_settings.pay_ramp`, seeds Caleb); `db.ts` wiring;
new **Mentor payout reconciliation** panel on Pay staff (`pay.reconcile`=205: mentor+month picker,
this-month / running / remaining / total tiles, graph+table+CSV) + an "Excluded from pay" tile;
Admin "Pay ramp" editor column; `verify-metrics` §8/§9 (Caleb $765 + running+remaining invariant).

**✅ CUTOVER DONE:** `9973_coach_pay_ramp.sql` is **applied** (HJG-owned; no re-sync needed).
Caleb's 50/60/60 ramp + March start are live. **Next new migration is `9972_…`.**

**Post-ship review (done):** an adversarial workflow (10 agents) found **5 confirmed + 1 uncertain**,
**all fixed** in a follow-up commit — chief among them the engine tier gate keying off the wrong
(latest-started, possibly non-mentoring) engagement, now fixed via **`mentoringCoverFor`** (keys off
the covering **mentoring** engagement so a later-starting graduation/JumpStart overlap can't drop a
legit 4×). Also: empty-ramp NaN guard, reconcile "Remaining" footer footing, stale docs/comment,
and the migration now `coalesce`s all columns (fill-if-unset). Still green.

**Next session:** browser-verify the reconciliation panel + Admin ramp column; note that JYF
exclusion + ramps change **every** mentor's numbers (spot-check others + signed-off Build months);
optionally surface *which* invoices were excluded per mentor (only the aggregate $ is shown today,
and the old "unassigned" banner/row are now unreachable dead paths).

---

## ▶ Prior session START HERE (2026-06-29, session 011)

**Mentees (§501) editing UX shipped on `main` and is green** (`typecheck` + `verify` +
`build`). Commits: `f935e9f` (right-dock + inline-edit) → `46d2cd3` (panel **always docked**).
**UI NOT browser-tested** (headless container — the app needs
live Supabase creds + an auth session to boot, which aren't available here). The user
confirmed **all migrations are applied** to Supabase and the session-010 cutover is done.

**Open issues check:** GitHub has **0 open issues** and **0 open PRs**. The only tracked
"open" items were the project's own deferred list (HANDOFF / FEATURE_BACKLOG). This session
closed the **"inline-edit grid"** deferred item. **Still deferred (offered, not yet built):**
a manual **"merge/link to an existing mentee"** action for ambiguous homonyms / renamed
Notion orphans (the one remaining deferred item; needs a UX decision on target-picking + how
the three zones reconcile on merge).

**What shipped (session 011) — `src/views/MenteesView.tsx` + `src/styles.css`:**
1. **Right-docked editor (always present).** The detail/edit panel is a **right-hand column**
   (`.mentee-panel` — sticky, scrolls independently) beside the roster (`.mentee-layout` /
   `.mentee-layout__main`), replacing the old full-width card *below* the table. Per the user's
   follow-up it is **always rendered** (reserves its space; shows a "Select a mentee…" empty
   state when nothing is selected) so **clicking a mentee never reflows/shrinks the grid** — the
   grid stays put and fully visible. Panel width is responsive (`clamp(360px, 30vw, 460px)`) to
   give the grid as much room as possible. Stacks below the roster under 1180px; the panel's
   `mentee-detail__grid` collapses to one column in the narrower dock. Selected row name bolded.
2. **Inline-editable roster grid.** The hand-zone fields are now editable directly in the
   grid via the `SortableTable` `format` hook (no change to SortableTable itself):
   **Status** (`<select>`, commits on change), **Coach** (free text → `coach_override`,
   commits on blur only when changed; blank reverts to Notion/CA), **Discovery** (`<input
   type=date>` → `discovery_date_override`, commits on change). New `inlineSave()` does an
   **optimistic** local patch + mirrors into the open detail draft if it's the same mentee +
   background `saveMenteeHand` (reloads on error). CA/Notion-derived columns (Stage, Notion
   status, Last meeting, Meetings) stay read-only; **Name** stays a button that opens the panel.
   New `.cell-edit` compact control styling. Coach uses a per-id `coachBuffer` so typing is
   controlled and focus-stable.

**Next session:** browser-verify on a Vercel/live preview (the right-dock layout in light+dark,
inline Status/Coach/Discovery edits persisting + surviving reload, panel stacking on mobile).
Then decide whether to build the deferred **merge/link mentee** action.

---

## ▶ Prior session START HERE (2026-06-27, session 010)

**A full mentee-management RE-WRITE shipped on `main` and is green** (`typecheck` +
`verify` (**24 sections, 35+ new checks**) + `build`). Commits: `f8de071` (rewrite) +
`dbe09b5` (15 review fixes). **UI NOT browser-tested** (headless). Plan doc:
`Session log/010_2026-06-27/rewrite_plan.md`. `main` is the trunk (the stale session-002
main was merged forward in `9af20f4`). Working tree clean, all pushed.

**The model now has THREE write zones on one `mentees` row, none ever writing another's columns:**
- **`ca_*`** — CoachAccountable facts; written only by the sync materialize step + `rebuildMenteesFromCa`.
- **`notion_*`** — the human record imported from a Notion CSV; written only by `upsertMenteeNotion` (in-app Import).
- **hand** (`*_override` / `status` / `status_stage` / `notes` / `is_test`) — staff edits; never touched by sync/import.
- App reads **effective = hand ?? notion ?? ca**; the detail panel shows all three + flags conflicts (accept-into-hand).

**New status taxonomy:** active / graduated / quit / fired / **no_mentoring** / declined / **imn** (drops `paused`).
**Funnel stages:** **pre_waiting** → discovery → jumpstart → 4x → 2x → 1x → graduated. **IMN** kept on the
roster but **excluded from the funnel**. The **funnel + exit card MOVED from Mentees → Metrics**
(`src/components/MenteeFunnelCard.tsx`, section `metrics.funnel`=12). The Mentees roster got a
**first-class Status filter** + a **Conflicts-only** toggle + an **Import Notion CSV** button.

**⚠⚠ CUTOVER — DO THIS (the new code needs it):**
1. **Apply `supabase/migrations/9974_mentees_three_zone.sql`** in the Supabase SQL Editor.
   DESTRUCTIVE: drops the old `mentees` (whether it was 9975's two-layer table or older) and
   creates the three-zone table. Re-runnable (drops only if no `notion_name` column). **Supersedes
   `9975` — apply `9974` whether or not `9975` was ever applied. Next new migration is `9973_…`.**
2. **Sync** (Admin → Sync now) or **Rebuild from CA** on the Mentees tab → fills `ca_*`.
3. **Import the Notion CSV** via the new **Import Notion CSV** button on the Mentees tab → fills
   `notion_*` (matched to existing mentees by name; ~31 Notion-only prospects insert as new rows;
   homonyms/ambiguous are skipped and reported). Re-import any time to refresh.
4. Spot-check: the 3-source detail panel, the Status filter, the funnel on **Metrics**, and
   **hand-refine the coarse Notion exits** (Notion lumps "Quit OR No Mentoring" and "Other" — split
   them to quit/no_mentoring/fired/declined on each mentee's detail).

**Carried Notion columns (7):** name, Status, coach (Mentor 1 + Mentor, reconciled; conflict flagged),
email, phone, DC Date, Offering Signup. Dropped: Associated Tasks, dd w a, MN Equivalency, Projected
Start Date, JS Lesson?, Wants PP?, MT Prayer Partner, and all 4 financial fields.

**Post-merge review — DONE.** An adversarial workflow (23 agents) found **15 verified defects, all
fixed** in `dbe09b5`: funnel attribution made consistent (`currentStage` = furthest reached; exits
never land on un-entered stages or on graduated; `pre_waiting` conversion null); importer hardened
(non-ASCII/transliterated names, bare-CR CSV, dated-with-time parsing); **`planClientIdClaims`** now
merges a Notion-only row onto its CA identity by name on sync/Rebuild (kills the prospect-before-CA
duplicate-row + re-import-ambiguity bugs); UI guards (coach-filter reset, "X of Y" count). Full list
in the session 010 log.

**Open / deferred:** match-by-name is the only key Notion gives us — `planClientIdClaims` auto-merges
a *unique* name match on sync, but a **manual "merge/link to existing mentee" action** for ambiguous
homonyms / renamed orphans is still deferred. Optional: an inline-edit grid (today editing is the
roster + the rich 3-source detail panel). The Notion "Mentor 1" vs "Mentor" columns are reconciled as
one coach and flagged when they disagree — if "Mentor" turns out to mean prayer-partner (not coach),
revisit `reconcileCoach` / `DEFAULT_NOTION_MAP` in `lib/notionCsv.ts`.

**Next session:** browser-verify the live UI after cutover (importer round-trip, 3-source panel,
Status filter, Metrics funnel); then pick up the deferred merge action if wanted.

---

## ▶ Prior session START HERE (2026-06-25, session 009b)

**Everything is on `main` and green** (`typecheck` + `verify` (22) + `build`). Newest
commits: `6feb4e2` (§005 chart fix), `090d0aa` (§005 chart), then the 4 rework phases.

**⚠ THE ONE PENDING ACTION — the mentee-management CUTOVER has NOT been confirmed done.**
The new Mentees tab + the Metrics pipeline/freedom cards need migration **`9975`** applied:
1. Apply **`9975_mentees_rebuild.sql`** in the Supabase SQL Editor (drops old
   `mentees`/`mentee_outcomes`/`mentee_exclusions`, creates the new two-layer `mentees`;
   destructive + re-runnable). **Next new migration is `9974_…`.**
2. **Re-sync** (Admin → Sync now) — the sync now materializes the CA layer — or click
   **Rebuild from CA** on the Mentees tab.
3. **Re-enter the Notion data by hand** on the Mentees tab.
   Pre-cutover the app degrades gracefully (test-exclusion + Freedom report fail open; the
   Mentees tab errors because its new columns don't exist yet). Full detail in the rework
   section below.

**Last thing shipped — Metrics §005 "JYF vs Active Mentoring" chart** (`src/views/MetricsView.tsx`):
the single "Active Mentoring" bar is now **three columns (4x · 2x · 1x)** with the **distinct
Active-Mentoring total as a faint dashed "master" backdrop BEHIND the trio**; JumpStart stays
its own column. Help (`metrics.jyfVsMentoring`) + hint updated.

> **recharts is v3.8.1 — note for future chart work.** `ReferenceArea` is unreliable here:
> it's **discarded** when its value exceeds the bar max and doesn't span a category band
> cleanly (that was the first failed attempt at the master backdrop). The working pattern for
> **overlapping bars** (one behind another, not grouped side-by-side) is a **hidden twin
> `<XAxis xAxisId={1} hide/>`** with the backdrop bar on that axis and the foreground bars on
> axis 0 — they then center in the same band and overlap. Verified via a **headless render
> harness**: serve a tiny `main.tsx`+`index.html` from a temp dir INSIDE the repo (so vite
> resolves `node_modules`) with `npx vite <dir>`, screenshot with the **global** Playwright
> (`/opt/node22/lib/node_modules/playwright`, CommonJS → `import pw from "...";const {chromium}=pw`),
> launch `args:["--no-proxy-server"]`, hit `http://127.0.0.1:<port>/`. (Harness was temporary; deleted.)

---

## ✅ MENTEE MANAGEMENT REWORK (2026-06-24, session 009b) — ALL 4 PHASES SHIPPED

A **major from-scratch rework** of the mentee/journey system — **complete and on
`main`** (commits `34b5f21` P1, `90a4cbe` P2, `0eb5112` P3, `c28a6f7` P4).
`typecheck` + `verify` (**22 sections**) + `build` all pass. **UI NOT browser-tested.**

### ⚠⚠ CUTOVER — DO THIS FIRST (the new code needs it)
1. **Apply `9975_mentees_rebuild.sql`** (Supabase SQL Editor). It **DROPS** the old
   `mentees`, `mentee_outcomes`, `mentee_exclusions` and creates the new two-layer
   `mentees`. Destructive + re-runnable (guarded). **Next new migration is `9974_…`.**
2. **Re-sync** (Admin → Sync now) to populate the CA layer (the sync now materializes it),
   **or** click **Rebuild from CA** on the Mentees tab (recomputes from the synced mirror,
   no CA calls).
3. **Re-enter the Notion data by hand** on the Mentees tab (status, corrections, notes).
   Until cutover the app degrades gracefully — test-exclusion + the Freedom report fail
   open, the Mentees tab shows an error (its new columns don't exist yet).

### What shipped (4 phases)
- **P1 — schema + CA materialization:** `9975` (two-layer `mentees`), `lib/menteeJourney.ts`
  (pure `deriveMenteeCaRecords` + `toMenteeCaUpsertRow`, verify §20), sync materialize step
  (writes ONLY `ca_*`), db.ts API (`fetchMentees`, `saveMenteeHand`, `createMentee`,
  `fetchTestClientIds`, `rebuildMenteesFromCa`).
- **P2 — Mentees management page** (`src/views/MenteesView.tsx`, rebuilt): roster table
  (status/stage/owner/dates/meetings · search/sort/filter/CSV) + per-mentee detail (effective
  stage rail · CA engagements + meetings history · editable hand-layer form) · Rebuild from CA
  · + Add mentee. `lib/menteeView.ts` (effective view-model `hand ?? ca`, verify §21). **Removed**
  JourneysView + MenteeStatusEditor + old Mentees grid; **App.tsx** drops the Journeys tab.
  MetricsView "Meetings to Freedom!" rewired to `fetchFreedomReport()`; exclusion rewired
  `mentee_exclusions` → `mentees.is_test`; RAW_TABLES updated.
- **P3 — funnel & exits** (`lib/menteeFunnel.ts`, verify §22): a graph+table card on the
  Mentees page — entered / active / exited (declined·quit·fired) / conversion per stage,
  honoring direct graduation from 4x/2x.
- **P4 — pipeline timing → Metrics** (`src/components/PipelineTimingCard.tsx`): the former
  §102 leg-duration card + the start-date **cohort-compare** tool, now a Metrics card reading
  the new table (`aggregateLegDurations` + `cohortCompare`).

### ✅ Dead-code cleanup DONE
The old journey/mentee functions were removed from `src/db.ts` (~600 lines:
`fetchMenteeJourneys`, `aggregateJourneyDurations`, `setMenteeOutcome`/`clearMenteeOutcome`,
the `mentee_exclusions` helpers, the `MenteeRecord` CRUD, `buildClientStages`,
`fetchMenteeOutcomeRows`, `dayspan`/`maxDate`/`normalizeName`, and the `MenteeJourney`/
`MenteeRecord`/etc. types). `engagementTierMap` was kept (the Margins delivered-sessions
roll-up uses it). No remaining references to dropped tables. typecheck + verify (22) + build
green. db.ts is now ~1480 lines.

### Original decisions (locked via AskUserQuestion)
- **Per-field sync split:** the new `mentees` table has a **CA layer** (`ca_*`, sync
  refreshes every run) and a **HAND layer** (status / `*_override` / Notion info /
  notes / `is_test`, staff-owned, NEVER touched by sync). App reads effective =
  `hand ?? ca`. This is the source of truth.
- **Tabs:** new **Mentees** management tab will REPLACE both the old Mentees grid AND
  the Journeys tab; the §102 leg-timing card moves into **Metrics**.
- **DB:** **drop all three** old tables (`mentees`, `mentee_outcomes`,
  `mentee_exclusions`); "excluded/test" folds into `mentees.is_test`.
- **Statuses:** active / graduated / quit / fired / paused / declined (each exit/grad
  records a stage + date).

---

## Resume here (live state — 2026-06-24, session 009b — WRAPPED)

Picking this up cold — start here. **Session 009b first committed on branch
`claude/jolly-cannon-rd1s1z`, then merged to `main` (fast-forward) at the user's
request — `main` is the live branch and the rest of the session commits straight to
`main`.** `typecheck` + `verify` (**18 sections**) + `build` all pass. **UI NOT
browser-tested** (headless).

**⚠ FOUR NEW MIGRATIONS this session — all MUST be applied** (Supabase SQL Editor,
re-runnable):
- **`9979_mentees_drop_fields.sql`** — **drops 9 columns** from `mentees` (destroys
  their data, per the user's explicit choice): `ff_amount`, `freedom_fight_paid`,
  `wants_pp`, `date_ff_paid`, `current_invoice_amount`, `js_lesson`, `mn_equivalency`,
  `dd_w_a`, `mt_prayer_partner`.
- **`9978_metrics_trend_window.sql`** — seeds the `metrics_conversion_trend_window`
  Company option (conversion-rate trend window). Until applied, the option works
  in-session but won't persist (staff can UPDATE app_settings but not INSERT).
- **`9977_mentees_hand_reviewed.sql`** — adds `hand_reviewed` (bool) + `hand_reviewed_at`
  to `mentees`. The Journeys card writes these; an unapplied column errors the save.
- **`9976_mentee_graduation_backfill.sql`** — adds `mentees.graduation_date` and
  backfills graduated mentees' grad date = **last 1x meeting + 7 days** (only the **12**
  graduates who reached 1x; the 29 who graduated from 2x/4x are left unset, per the
  user). Writes BOTH `mentees.graduation_date` and `mentee_outcomes.graduation_date`
  (the latter drives the Journeys graduation timeline). Idempotent; expected-12 list is
  in the file. **Next new migration is `9975_…`.**


No re-sync needed (all four touch HJG-owned tables). Migration 9976 reads the synced
`ca_engagements`/`ca_appointments` to compute the dates — apply it after data is synced.

**What shipped this session (009b):**

**(1) Removed 9 fields** from the **Mentee record — source of truth** *data and
screens* (the user may re-add some later). Done end-to-end:
- **Data layer** (`src/db.ts`): dropped the 9 fields from the `MenteeRecord`
  interface, from `MENTEE_SELECT`, and emptied `MENTEE_NUM_FIELDS` (all 4 numeric
  mentee cols were among the 9 — `normalizeMenteeRecord` is now a no-op but kept as
  scaffolding for re-adds).
- **Screens**: removed the 9 columns from the **Mentees** tab grid
  (`MenteesView.tsx` `COLS`) and the Journeys **Mentee record** card
  (`JourneysView.tsx` `RECORD_FIELDS` — the card's form + save are generic over that
  list, so the fields drop from edit + save too). Updated the
  `journeys.menteeRecord` help article prose (`src/help/articles.ts`).
- **Schema/data**: new `9979` drops the columns from existing DBs. The **`9986`
  seed was rewritten** (create-table DDL + the 181-row INSERT, via a quote-aware
  parser) to omit the 9 columns so it stays **re-runnable** and a fresh apply never
  creates them (then `9979` is a no-op). Verified: 181 rows × 12 values, header
  matches, embedded commas/parens/`''` escapes preserved.
- **Raw data tab**: `mentees` is in `RAW_TABLES`; after `9979` is applied the 9
  columns no longer appear there either.

**(2) Conversion-rate trend window** (new Company option). The Metrics "Discovery
calls → conversion" card's rate line is now a **trailing-window** conversion rate
(replacing the raw per-month line; the table still lists exact per-month rates). The
window is org-configurable as **N weeks or N months** under **Company options →
Metrics** (default 3 months). New **`"duration"`** Company-option control type
(number + unit). Pure math in **`lib/conversionTrend.ts`** (`rollingConversionTrend`
— months = trailing N buckets, weeks = trailing N×7 days by exact date;
`parse/serializeTrendWindow`, `trendWindowLabel`), re-exported via `db.ts`, locked by
**verify §18**. `MetricsView` fetches the option and applies the trend to Period A and
(in compare mode) Period B. Computed from in-range calls, so the earliest points warm
up. `metrics.conversion` help article updated.

**(3) Hand-reviewed flag** on the Journeys **Mentee record** card (§106). Saving an
edit marks the record **hand reviewed** (`hand_reviewed` + `hand_reviewed_at`, set in
`doSave`); a **"Hand reviewed" checkbox** sets/clears it directly (saves immediately,
along with any unsaved edits), and a green badge shows the reviewed date. Columns added
in `9977` (+ `9986` DDL for fresh installs); `MenteeRecord` + `MENTEE_SELECT` updated;
`journeys.menteeRecord` help article updated. (Not surfaced on the Mentees grid — scope
was the Journeys card per the request.)

**(4) "synced" date → confirm button** on the Journeys graduation editor (§107,
`MenteeStatusEditor`). The per-stage "synced: yyyy-mm-dd" caption is now a **button**:
clicking it copies the synced CA date into that override field (then Save persists it),
so you confirm a date without retyping. Shows "✓ synced: …" + disables once the field
already equals the synced value. No-synced fields stay a muted "synced: —". UI-only
(no migration / no verify change).

**(5) Pipeline-timing (§102) — "Only hand reviewed" filter + stage-colored columns.**
`PipelineSummary` gained an **"Only hand reviewed"** cohort checkbox (composes with the
existing filters); when checked, the graph + table + tiles only count mentees whose
source-of-truth record has `hand_reviewed = true` (set derived from the already-loaded
`records` map, passed in as `handReviewedIds`). The **leg-duration bars** (and matching
**table swatches**) are now colored by the stage each leg leads **into**, using the same
`stageColors` as the mentee rail (`journeys_stage_colors` company option; `LEG_COLOR_INDEX`
maps leg→stage index). The **Discovery → graduation** total column is painted with a
**gradient blending the other stage colors** (SVG `linearGradient #pipeline-total-grad`
for the bar + a CSS `linear-gradient` swatch in the table), not any single stage color.
`journeys.aggregate` help updated. UI-only (no migration / no verify).

**(6) Journeys basis pinned to first-meeting + editor collapsible + parked controls.**
- **Stage-date basis PINNED to `first_meeting`** in `JourneysView` (`const stageBasis`);
  the inline engagement-start/first-meeting **toggle was removed**, and the mount effect
  no longer reads `journeys_stage_basis` (still reads `journeys_stage_colors`).
- **Company option `journeys_stage_basis`** is kept but **`disabled`** (new registry flag),
  default flipped to `first_meeting`; the disabled select shows the default. New parked
  **`journeys_recalculate_dates`** action (new `"action"` control type) — a disabled
  "Recalculate" button in Company options → Journeys, to be enabled once the basis toggle
  is re-enabled and changed. **Note:** journey dates are computed LIVE on each load from
  the active basis, so recalculation is automatic today; the button is a forward hook for
  when basis-switching becomes a deliberate, materialized step.
- **"Edit graduation status" card (§107) is now collapsible** (collapsed by default; the
  header is a disclosure button showing the selected mentee's name when collapsed).
- UI-only — no migration, no verify change.

**(7) §107 edits auto-stamp hand-reviewed.** Any persisted action on the "Edit graduation
status" editor (Save/Update **or** Clear, incl. just confirming a synced date) now also
writes `mentees.hand_reviewed = true` (+ `hand_reviewed_at`) via `saveMenteeRecord`
(`markHandReviewed` in `MenteeStatusEditor`). The status/stage-date edits still live in
`mentee_outcomes` (the override layer) — only the hand-reviewed flag is mirrored to the
`mentees` source-of-truth table (user's choice: "stamp hand-reviewed only," no data
duplication). `onSaved → load()` reloads records so §106 + the "Only hand reviewed" filter
update. **Data-model note for future-me:** §106 → `mentees`; §107 → `mentee_outcomes`;
§105 Meetings is read-only (kept that way — no save affordances). UI-only.

**(8) Dates display as MM-DD-YYYY everywhere (US format).** New `src/format.ts` helpers:
`fmtDate` (YYYY-MM-DD → MM-DD-YYYY), `fmtDateTime` (ISO ts → MM-DD-YYYY h:mm AM),
`formatMaybeDate` (reformats a leading ISO date inside any string, preserving trailing
time). Applied at: the generic display tables — `SortableTable` (covers Raw data + Pay
Explore) + `ExploreModal` (auto-detect, render-only) — and bespoke sites: Journeys rail
nodes + meetings + hand-reviewed badge, `MenteeStatusEditor` synced button, Margins
sessions, Discovery call date, `freedomTable`, Pay-Explore engagement end, Metrics "Data
as of" + compare range labels, Admin sync times, Build-payout "Last saved".
**Deliberately NOT changed:** `<input type="date">` fields (browser renders the OS locale
— US already shows MM/DD/YYYY; can't restyle) and **CSV/XLSX exports stay ISO YYYY-MM-DD**
(sortable / unambiguous for machines — display formatting is render-only, exports use raw
values). If the user wants exports in MM-DD-YYYY too, change `csv.ts`/`xlsx.ts`/the `csv`
column fns. UI-only — no migration, no verify change.

**(9) Pipeline-timing (§102): drop the Discovery→graduation bar + day-count labels.**
The dc_grad total leg is no longer charted or in the leg table (`displayLegs = legs.filter
(key !== "dc_grad")`); it's still computed and surfaced via the **"Avg time to graduate"**
tile. Each bar now has a **day-count `LabelList`** ("Nd", position right; chart right margin
widened to fit). Removed the now-dead dc_grad gradient (`<defs>`/`TOTAL_GRAD_ID`/`gradStops`/
`totalGradientCss`). `journeys.aggregate` help updated. UI-only.

**(10) Pipeline-timing (§102): "Compare start-date cohorts" tool.** A new checkbox on the
Pipeline-timing filter bar splits the (already filtered) roster into **two start-date bands**
— "started between N and M months ago" — and compares them side by side (default **A = 0–3 mo
ago** vs **B = 4–6 mo ago**, both editable). A cohort's **start = system start** (discovery →
JumpStart → JYF → first meeting; the `daysInSystem` basis, now exposed as **`MenteeJourney.startDate`**).
In compare mode the card shows, per cohort: a headline A/B/Δ table (**Mentees, Avg days in
system, Avg time to graduate, % graduated**), **paired stage-leg bars** (A = accent, B = cmp
color) + a leg table with a **Δ (A − B)** column, and a **current-tier-mix** table (how far each
cohort progressed). Pure logic in **`lib/cohortCompare.ts`** (`inStartWindow`, `monthsAgoYmd`,
`summarizeCohort`, `startWindowLabel`), re-exported via `db.ts`, locked by **verify §19** (now 19
sections). Single mode is unchanged. `journeys.aggregate` help updated. **UI-only — no migration,
no schema change.**

**▶ Next-session checklist (009b):**
1. **Apply `9979` + `9978` + `9977`** (Supabase SQL Editor). No re-sync needed (all
   HJG-owned tables). `9978`/`9977` gate the trend-window persistence + the flag save.
2. **Browser-verify** (headless here): (a) Mentees grid + Journeys Mentee-record card
   no longer show the 9 removed fields; Raw data → `mentees` drops them. (b) Company
   options → Metrics → set the conversion trend window (weeks/months) and watch the
   Metrics conversion line smooth/lengthen; the table keeps per-month rates. (c) Journeys
   card: edit a field + Save → "✓ Hand reviewed" badge appears; tick/untick the checkbox
   directly persists.
3. If/when the user wants a removed field back: re-add it to `MenteeRecord` +
   `MENTEE_SELECT` (+ `MENTEE_NUM_FIELDS` if numeric), the relevant `COLS`/`RECORD_FIELDS`,
   and a new `add column if not exists` migration. Data dropped by `9979` is gone — seed
   values for it still live in git history (the pre-009b `9986`).
4. Possible follow-ups: surface `hand_reviewed` on the Mentees grid too; let the trend
   window optionally look back BEFORE the selected range (currently warms up in-range).

---

## Resume here (live state — 2026-06-24, session 009 — WRAPPED)

Picking this up cold — start here. **Session 009 committed straight to `main`** (per the
user). `typecheck` + `verify` (**17 sections** — §17 added for Margins; §8 gained owner-override
cases) + `build` all pass. **UI NOT browser-tested** (headless).

**⚠ MIGRATIONS — the user reports applying ALL of them this session** (9982/9983/9984 + the
manual exit-date SQL). **Still REQUIRED: a re-sync** (Admin → Sync now) so `ca_clients.coach_id`
(owner) populates — until then every owner-driven surface falls back to the old derived coach.
- **`9984_ca_clients_primary_coach.sql`** — `ca_clients.coach_id` (CA primary coach = OWNER). Sync
  now writes it, so it must exist before any sync (applied).
- **`9983_mentee_outcomes_no_mentoring.sql`** — widens the status CHECK for `no_mentoring`.
- **`9982_mentee_outcomes_exit_dates.sql`** — `quit_date` / `no_mentoring_date` / `fired_date`
  (captures the SQL the user ran by hand; re-runnable no-op for them).

**Also new: `9981_program_hours.sql`** — the Margins tab's staff-hours table (staff RLS). Apply it
before staff-hours entry persists; delivered hours render without it (fetch is fail-open).

**Also new: `9980_ca_appointments_end.sql`** — adds `ca_appointments.end_raw` (CA `Appointment.endDate`)
for real meeting durations. **Apply BEFORE the next sync** (the sync now writes `end_raw`; an
unapplied column errors the appointment upsert), then **re-sync** to populate it.

**Next new migration is `9979_…`.**

**Shipped this session (009), newest first:**
- **Backlog CLEARED — last 3 items shipped.** (a) **3-digit UI ids**: `src/uiRegistry.ts`
  (`UI_SECTIONS`, append-only) + `<SectionId>` badge + `UI_INDEX.md` (36 sections) — screens on nav
  tabs, ChartCards via a `sectionId` prop, all other cards/editors/modals/drawers inline; built via
  an inventory workflow + adversarial review (36/36 cross-check clean). (b) **Raw-data
  search/sort/filter**: whole-table load, free-text + per-column filters, click-to-sort, `maxRows`
  render cap. (c) **Combine Pay staff + Build payout**: Build payout is now a sub-mode of Pay staff
  (no separate tab), launchable pre-scoped. **`FEATURE_BACKLOG.md` planned list is now empty.**
- **Margins — drill-down.** Click a month's chart bar (or table row) → a modal lists the delivered
  meetings behind that month (date/time/coach/name/attendees/hours + CSV). `fetchDeliveredHoursByMonth`
  → `fetchProgramSessionsByMonth` (per-session detail) + `programMonthTotals`; `ProgramSession` type.
- **Margins — real meeting durations.** Synced CA `Appointment.endDate` → `ca_appointments.end_raw`
  (`9980`); delivered hours = actual `end − start` per session (pure `meetingHours`, verify §17),
  falling back to `PROGRAM_MEETING_HOURS` (1 h) only when no end is recorded. **Still open: money layer.**
- **Margins tab (bones)** — new top-nav tab; **JumpStart Your Freedom** + **Mentoring** sub-tabs.
  By-month **graph + table**: entered **staff hours** (new `program_hours` table, `9981`, save-on-blur)
  vs **delivered meeting hours** (distinct coach+start-time sessions) + delivered÷staff ratio.
  `lib/margins.ts` (verify §17). **Dollars deferred** (per request).
- **Pipeline-timing cohort filters** (Journeys card, from the backlog). Composable filter bar:
  **Active within** (3/6/12/24 mo by last activity), **Status** (active/graduated/exited), **Current
  tier**, **Owner**, **Overridden graduation date** checkbox. Filters the graph + table + tiles;
  "Showing N of M" + Clear; ephemeral. `PipelineSummary` in `JourneysView.tsx`; `.journey-filters` CSS.
- **Journeys scoped to the Mentees source-of-truth roster** (219 → ~181). A journey counts only if
  its mentee is in the `mentees` roster (matched by **client_id OR normalized name**;
  `fetchMenteeRosterKeys`, **fail-open** if the table's absent). `MenteeJourney.inSourceOfTruth`;
  `aggregateJourneyDurations` + count tiles drop off-roster; **"Roster only"** toggle (default on)
  hides them from the list (greyed + "off-roster" pill when shown). CA's other pipelines (IMN,
  after-grad, mentor training) are excluded from the metrics.
- **Exit-date columns** (`9982`): `setMenteeOutcome` writes `quit_date`/`no_mentoring_date`/
  `fired_date` matching the chosen exit (mirrors `status_date`). No dedicated editor field yet.
- **Backlog +2**: **Margins tab** (JYF + Mentoring sub-tabs; staff hours vs delivered JYF hours,
  money later) and **Pipeline-timing filters** (overridden-grad-date / last-year cohort cuts).
- **OWNER = CoachAccountable primary coach, EVERYWHERE incl. pay** (user chose this scope).
  Sync captures `Client.CoachID` → `ca_clients.coach_id` (`9984`); `fetchPrimaryCoachByClient()`
  (defensive, empty map if unapplied). **Pay** (`lib/pay.ts` `primaryCoachOf`): invoices credit
  the owner, tier still from engagement coverage, fallback `coverOnDate→coverInMonth`; threaded
  via `fetchPayData`→PayStaff/BuildPayout; verify §8 +4 cases. **Capacity** (MetricsView):
  1-on-1 mentees re-bucketed under their owner (group detection still on the running coach).
  **Journeys**: `MenteeJourney.ownerCoachId/Name/Source`; timeline header shows "Owner: …".
- **ALTERNATIVE journey exits — quit / fired / NO MENTORING** (new status `no_mentoring`,
  migration `9983`). The stage rail ends in a **red ✕ exit node in place of Graduation** at the
  last reached stage when a mentee exits; editor dropdown + pill + label updated.
- **Diagnosed Jonathan Heinzman** from the user's `ca_engagements` CSV: both his engagements
  (JumpStart `62514` + ongoing 4x `63543`) are under coach **9315 = Arthur**; Ty Miller's 4x was
  re-cut under **40711 = Caleb** but Jonathan's was not — so engagement-derived attribution
  correctly showed Arthur. The owner=primary-coach change is the fix (re-pair in CA + re-sync).
- **Help: "How clients are matched to coaches"** master "?" article (Pay-staff header + Journeys
  meeting list); rewritten for the owner model; pay/capacity/journeys articles updated.

**▶ Next-session checklist (session 009):**
1. **Apply `9980` + `9981` (Supabase SQL Editor), then RE-SYNC (Admin → Sync now).** `9980` must be
   applied before the sync (it writes `end_raw`). The re-sync also (re)populates `ca_clients.coach_id`
   (owner) and now `ca_appointments.end_raw` (real Margins durations). Jonathan only flips to Caleb if
   the user **re-pairs him to Caleb in CoachAccountable** first (the CSV still has him under Arthur).
2. **Browser-verify** (headless here, nothing eyeballed): Journeys roster scoping (count ≈181,
   "Roster only" toggle, off-roster pill); "Owner: …" line + the red exit node (quit/fired/
   no-mentoring); Pay-staff payouts re-attributed to owners; capacity grouped by owner; **Margins
   tab** (JYF + Mentoring sub-tabs, staff-hours entry, delivered hours — flat 1 h before the re-sync,
   real durations after — and the click-a-column drill-down modal). Also the 3 final backlog items:
   the **3-digit id badges** (on every nav tab + card/editor/modal — see `UI_INDEX.md`), **Build
   payout folded into Pay staff** (header button + per-row "Build →", Back returns), and **Raw-data
   search / sort / per-column filters** (whole-table load, render cap note, view-aware CSV).
3. **Margins money layer** (the remaining Margins follow-up): staff cost (hours × rate) + program
   revenue → real margins. Optional: surface the owner in the Journeys mentee LIST + Mentee-record card.

---

> **North star:** be a *weapon with the data* — a powerful board-grade dashboard
> where **every metric is viewable as a graph AND a table simultaneously**. See
> `CLAUDE.md` for standing goals, `new_session_instructions.md` for standing
> orders (session logs, prompt history), and `CSHARP_PORT.md` for the C# track.

## Resume here (live state — 2026-06-24, session 008 — WRAPPED)

Picking this up cold — start here. **Session 008 committed straight to `main`** (per the
user's instruction this session). `typecheck` + `verify` (**16 sections**) + `build` all
pass. **UI NOT browser-tested** (headless) — eyeball on a Vercel preview.

**⚠ TWO NEW MIGRATIONS this session — both MUST be applied** (Supabase SQL Editor):
- **`9986_mentees.sql`** creates + seeds the `mentees` source-of-truth table (**181 Notion rows**,
  all 19 columns). Powers the new **Mentees tab** + the Journeys "Mentee record" card. Re-runnable,
  insert-if-absent (won't clobber edits).
- **`9985_mentee_outcomes_stage_dates.sql`** adds six stage-date override columns to
  `mentee_outcomes` + relaxes `status` to nullable. Powers the new **pipeline-date editing** in the
  Journeys graduation editor. Re-runnable. **Code degrades gracefully if unapplied** (the Journeys
  fetch/write fall back to base columns, so the tab won't break — date edits just won't persist).

**Next new migration is `9984_…`.** (Session 007's `9987_journeys_stage_colors.sql` is still
pending too — so **three migrations are pending: 9985, 9986, 9987**.)

> ⚠ Git-state note resolved: at session start the *local* `main` was stale at the old
> session-002 commit (`88b8490`) with unrelated history, while `origin/main` was the full
> lineage (`e79b536`). Reset local `main` to `origin/main` and worked there. `main` is primary.

**Shipped this session (008), newest first:**
- **NEW "Mentees" tab — Notion-like editable grid.** A standalone top-nav tab (after Journeys)
  showing the **full Notion "Mentees Database" mirror** as an **editable grid**: every cell edits
  inline and **saves on blur** to the `mentees` table. Search, click-to-sort columns, CSV export,
  **"+ Add mentee"**, and a CA-linked indicator. Shows **all 181 rows incl. the ~29 prospects with
  no CA client**. `src/views/MenteesView.tsx`; db.ts gained `fetchAllMenteeRecords`,
  `updateMenteeRecordById` (edit by uuid PK → null-client_id rows are editable), `createMenteeRecord`.
  **Needs `9986` applied.**
- **PAY BUG FIXED — late-month tier change misattributed the new invoice.** Found via the user's
  report (June 2026, coach **Caleb Otto** showed only Joash; **Ty Miller** was missing). Ty's
  JumpStart (Arthur Nisly) ended 5/29 and his 4x (Caleb) started 5/29; `computePayReport` attributed
  every invoice to the **majority-day** coach (`coverInMonth`) — Arthur held 29/31 May days — so the
  **$425 4x invoice dated 5/30** (and its 100% day-30 rollover into June) went to Arthur, not Caleb.
  **Fix:** attribute each invoice to the coach covering its **`date_of`** (`coverOnDate`, prefers the
  most-recently-started covering engagement), falling back to month-majority only when no engagement
  covers the exact date. Now Ty earns **$425 under Caleb in June**. `lib/pay.ts`; **verify §8 gained a
  late-month-handoff case** (Clayton §8/§9 intact). **No migration.**
- **Journeys graduation editor — list-driven + edits pipeline stage dates.**
  - The **"Edit graduation status" card now follows the mentee list selection** (shared selection
    state; the dropdown and the list stay in sync). **Removed the redundant inline "Pipeline status"
    editor** that was inside the Timeline — one editor now.
  - That editor **also edits the six pipeline stage dates** (Discovery, JumpStart, 4x, 2x, 1x,
    Graduation). Each overrides the synced CA date (shown beneath the field); blank = use synced.
    Stored in `mentee_outcomes` (**migration `9985`**, six date cols + nullable status). `db.ts`:
    `MenteeJourney` gained `stageSynced`/`stageOverrides`; `fetchMenteeJourneys` applies
    `override ?? synced` and recomputes `currentTier` from the effective dates; `setMenteeOutcome`
    writes the dates. **Both read & write fall back to base columns if 9985 isn't applied** (tab
    never breaks). The rail, days-per-stage chart, durations, and current tier all reflect overrides.
- **Mentees table column scope settled (after a flip-flop): ALL 19 Notion columns** (the user first
  said all 19, then 15, then back to all 19), test row dropped → **181 rows**. The interim 15-column
  curation was reverted (`git checkout a242cf5^ -- <src>` + regenerated `9986`).
- **Journeys per-mentee detail reworked → "Time in each program stage" + meeting list** (user
  follow-up). The per-mentee **columns now show DAYS spent in each category** (Discovery→JumpStart,
  JumpStart, 4x, 2x, 1x) — one bar per stage, colored to match the rail, spanning from entering a
  stage to entering the next (current stage runs to today). The **grid below is now a list of every
  meeting** (date, name, tier swatch, coach). **This REPLACED the earlier "meeting-rhythm columns
  colored by tier" chart** built earlier this same session (the user wanted time-in-stage, not
  per-month counts). Pure-ish view logic `stageDays` in `JourneysView.tsx`. The `MenteeMeeting.tier`
  field (added earlier) now feeds the meeting-list tier swatch. **No migration.**
- **Moved "Edit graduation status" to the Journeys tab.** The standalone `MenteeStatusEditor`
  (pick any mentee → set active/graduated/quit/fired) now renders on **Journeys** (below the
  pipeline-timing summary) instead of the Metrics "Meetings to Freedom!" card. Removed the
  now-dead `reloadJourneys` + `useAuth/user` from `MetricsView`. (Journeys' Timeline still also
  has its own per-selected-mentee status editor; both write `mentee_outcomes`.)
- **Removed the stray KPI strip** (Discovery calls / Mentee meetings / Active mentees / Mentors)
  that sat below the "JYF vs Active Mentoring" card on Metrics.
- **Fixed the Journeys stage-rail white-space gap** before the first (Discovery) node — the
  first cell now sizes to its node (`flex: 0 0 auto`) so connectors absorb the slack evenly.
- **"Mentees" source-of-truth table — BUILT** (the backlog item, scoped with the user). New
  HJG-owned **`mentees`** table (migration **`9986`**, staff RLS) is HJG's internal source of
  truth, one row per person, **mirroring all 19 Notion "Mentees Database" columns** (Notion
  page-link URLs stripped; the **'Test Locked Page' test row excluded** → **181 rows**). Seeded
  ONCE from the user's Notion export (`client_id` matched to `ca_clients` by name — **152/181
  matched**; 29 unmatched are prospects not yet in CA). The
  seed is re-runnable + insert-if-absent so it **never clobbers dashboard edits**. db.ts:
  `MenteeRecord`/`MenteeRecordEdit`, `fetchMenteeRecordsByClient`, `saveMenteeRecord`
  (read-modify-write by client_id; numeric coercion since PostgREST returns numeric as strings),
  `"mentees"` added to `RAW_TABLES`. JourneysView: an **editable "Mentee record — source of
  truth" card** in the selected mentee's detail pane (keyed by clientId; "?" help article).
  Adversarially reviewed (10 findings; medium key-by-clientId bug + low-sev fixes applied).
- **Backlog entry** for the Mentees table (now built) is in `FEATURE_BACKLOG.md` with the
  schema/grain/reality-check write-up (kept for reference).

**Answered (user question):** "Export all (.xlsx)" **does** include the hand-entered tables — it
iterates `RAW_TABLES` (all 14 incl. `discovery_outcomes`, `mentee_outcomes`, etc.). But in the
user's 2026-06-23 export, **`discovery_outcomes` and `mentee_outcomes` were EMPTY** (0 data rows)
— no saved discovery/graduation overrides existed yet; `manual_metrics`(22)/`mentee_exclusions`(7)
/`coach_settings`(5) had data.

**▶ Next-session checklist (session 008):**
1. **Apply the three pending migrations** (Supabase SQL Editor): **`9986_mentees.sql`** (mentees
   table + seed), **`9985_mentee_outcomes_stage_dates.sql`** (stage-date overrides), and
   **`9987_journeys_stage_colors.sql`** (session 007, stage colors). The app degrades gracefully
   without 9985 and renders default colors without 9987, but **the Mentees tab + Mentee-record card
   are empty until 9986 is applied.**
2. **Browser-verify the new/changed surfaces** (headless here):
   - **NEW Mentees tab** — inline cell edit + save-on-blur, search, sort, CSV, "+ Add mentee".
   - **Journeys graduation editor** — picking a mentee in the list populates it; the six **pipeline
     stage-date** fields edit + persist and move the rail/days-chart/current-tier (after 9985).
   - **Pay staff → Explore June 2026 → Caleb Otto** now shows **Ty Miller (~$425)** alongside Joash.
   - The earlier session-008 items (time-in-stage bars, meeting list, stage-rail gap fix).
3. **New backlog items** (`FEATURE_BACKLOG.md`, newest on top): (a) combine Pay staff + Build payout
   (Build launches from Pay staff); (b) search/sort/filter in Raw-data tables; (c) a unique **3-digit
   id** on every card/modal/screen (comprehensive registry + index).
4. Possible follow-ups: the messy Notion columns (`js_lesson`, `dd_w_a`, `freedom_fight_paid`) are
   mirrored verbatim — clean/retype if wanted. The Journeys Timeline still has the per-selected
   editor removed; the single editor is the "Edit graduation status" card.

---

## Resume here (live state — 2026-06-23, session 007 — WRAPPED)

Picking this up cold — start here. **Session 007 shipped several changes.**
`typecheck` + `verify` (**16 sections, 187 checks**) + `build` all pass. **UI NOT
browser-tested** (headless) — eyeball on a Vercel preview.

**⚠ ONE NEW MIGRATION this session — MUST be applied** (Supabase SQL Editor):
**`9987_journeys_stage_colors.sql`** seeds the `journeys_stage_colors` key. Until it's
applied, the Company-options stage-color editor works in-session but **won't persist**
(staff can UPDATE `app_settings` but not INSERT). The Journeys timeline still renders the
curated red→green default colors regardless.

**Shipped this session (007) — UI/UX batch:**
- **Excel-like tables, app-wide.** `.table` now has full cell **gridlines**, a shaded
  header row, **zebra** striping, and a row hover (`src/styles.css`). Every table uses
  `.table`, so this is global.
- **Meetings to Freedom! — graduation/status editor on the card.** New
  `src/components/MenteeStatusEditor.tsx` (pick a mentee → set active/graduated/quit/fired
  + date + notes) sits below the card in `MetricsView`. Writes a **manual override
  (`mentee_outcomes`) that always wins over synced data and is never touched by a re-sync**
  — the sticky behavior the user wanted is inherent (override `??` auto at `db.ts:888`;
  sync only writes `ca_*`). MetricsView gained `useAuth` + a `reloadJourneys()` so an edit
  refreshes the metric immediately. **No migration.**
- **Journeys timeline — fits + color-coded by stage.** The stage rail **no longer
  scrolls** (removed `overflow-x`, nodes shrink to fit). Each of the 6 stages (Discovery →
  JumpStart → 4x → 2x → 1x → Graduation) is **color-coded** (dot + label + a top accent
  bar) from an org-wide setting.
- **Company option: Journeys → "Pipeline stage colors"** (`journeys_stage_colors`). Two
  modes: **Gradient** (blend two endpoint colors across the 6 stages) or **Custom** (set
  each of the 6). Pure color math in **`lib/stageColors.ts`** (`gradientColors`,
  `resolveStageColors`, `parse/serializeStageColorConfig`, **verify §16**), re-exported via
  `db.ts`. Stored as a **JSON string** in `app_settings` (rides the string-valued
  Company-options plumbing). Editor is a custom `StageColorsControl` in
  `CompanyOptionsView` (live preview, debounced saves). Default = curated **red→green**
  palette. Registry gained a `type?: "select" | "stageColors"` discriminator
  (`src/companyOptions.ts`). **Migration `9987` seeds the key.**

**Shipped this session (007) — earlier (already on main):**

- **NEW "JYF vs Active Mentoring" card** (Metrics tab, below "Meetings to Freedom!"). A
  current-state cohort snapshot: **distinct people with an OPEN JumpStart Your Freedom
  engagement** vs **distinct people with an open 4x/2x/1x mentoring engagement** (open =
  not complete, not canceled). Two color-coded bars + stat tiles (JYF / Active Mentoring /
  per-tier 4x·2x·1x) + a table (adds the de-duplicated pipeline total). Pure math in
  **`lib/cohort.ts`** (`computeJyfVsMentoring`, **verify §15**), re-exported via `db.ts`;
  data via new `fetchJyfVsMentoring()` (reads `ca_engagements`, drops `is_excluded` +
  `mentee_exclusions` clients). **All-time, not range-scoped.** Has a "?" help article
  (`metrics.jyfVsMentoring`). `MetricsView.tsx` + `db.ts` + `lib/cohort.ts` +
  `articles.ts` + verify. **No migration.**
- **Discovery → conversion card: toggle outcome coloring + channel split.** The card
  gained **two independent on/off checkboxes** ("Bar coding:"): **Color by outcome**
  (stack by converted/pending/not-converted/no-show, each its own color) and **Split by
  method (Zoom / Phone)** (texture each segment — Zoom solid, Phone grid). Both default
  **on** (= prior behavior). All four combinations render: color-only → solid stacked
  outcome bars; channel-only → neutral Zoom (solid) + Phone (grid) bars; neither → one
  neutral "Discovery calls" bar. `convData` gained `Total_phone`/`Total_zoom`; a neutral
  `ptn-total` grid pattern was added to the chart `<defs>`; the bars are built by a
  `convBars` memo keyed off the two toggles. The "solid = Zoom, grid = Phone" hint only
  shows when the channel split is on. Works in compare mode. `MetricsView.tsx` only.
  Toggles are **ephemeral local state** (like `meetingsMode`/`compareMode`) — not
  persisted org-wide. **No migration.**

**✅ GIT TOPOLOGY — RESOLVED 2026-06-23.** Earlier in session 007 the working branch
`claude/great-albattani-bysuhx` and `origin/main` had **completely unrelated histories**
(`origin/main` was stale at session 002 and lacked all of sessions 003–007). **The user
then merged the work into `main` via PR #8** (merge commit `cbfdb63`), so **`main` is now
the primary branch and contains the full lineage** (sessions 003–007: conversion card,
theme redesign, Pay/Build/Journeys, Maps, etc.). The old session-002 history on `main`
was replaced. **Going forward, `main` is primary** — develop from it.

**▶ Next-session checklist:**
1. **Branch from `main`** — it is now the primary branch and holds everything (PR #8
   merged 2026-06-23). The `claude/*` working branch is fully captured in `main`.
2. **Apply `9987_journeys_stage_colors.sql`** (Supabase SQL Editor) so the stage-color
   option persists. **Next new migration is `9986_…`.**
3. **Browser-verify** the session-007 UI: Excel-like tables everywhere; the Journeys
   timeline (no scrollbar, 6 stage colors) in light + dark; the **Company options →
   Pipeline stage colors** editor (Gradient vs Custom, live preview, persistence after
   9987); the **Meetings to Freedom! graduation editor** (set graduated → metric updates →
   survives a re-sync); the **JYF vs Active Mentoring** card; the conversion-card toggles.
4. The session-006c checklist below is still open (browser-verify themes, re-sync for
   `ca_invoices.date_of` day, optional pay-color polish).

---

## Resume here (live state — 2026-06-22, session 006c — WRAPPED)

Picking this up cold — start here. Both session-006b migrations (`9989`, `9988`) are
**applied** (per the user). **Session 006c** (after the backlog emptied) shipped:
- **Metrics tab reorder + merge.** Folded the standalone "Discovery calls" card into the
  conversion card (now **"Discovery calls → conversion"** — adds total/Phone/Zoom tiles)
  and moved it + **Meetings to Freedom!** to the **top** of the Metrics page (above the KPI
  strip). Removed the now-dead `DiscoveryTooltip`/`TipEntry`, `cmpDiscovery`,
  `discoveryCompareTable`, `discoveryTable`. `MetricsView.tsx` only; no migration.
- **"Maps" tab** (`src/views/MapsView.tsx`, replaced `DataMapView.tsx`): one top-nav tab
  with a **Data map / Payments** toggle (iframes `public/data-map.html` + the NEW
  `public/pay-map.html`). `pay-map.html` is a self-contained, dependency-free explainer of
  the Clayton split with a **3-mentee** calculator (Alex/Bob/Chase, editable) + a combined
  monthly-paycheck view. **Shareable with mentors** — served at `/pay-map.html` *outside*
  the login gate (real static file beats the SPA rewrite), works offline if saved. **No
  migration.**
- **Pay engine rewritten to Clayton's two-month split** (`lib/pay.ts`). An invoice
  dated day D splits by `elapsed = D/30` (**fixed 30-day**): `(1−elapsed)` pays in the
  invoice's month, `elapsed` rolls to the next. Payout month = this month's invoices ×
  (1−elapsed) + last month's × their elapsed, × the **per-MENTOR** ramp (35/50/60 —
  kept from 2026-06-19). Proration keys off the invoice **`date_of` day** (now loaded).
  `PayMenteeLine`/`PayLedgerRow` gained `invoiceDay`/`recognizedThis`/`rolloverPrev`;
  payout months include the **rollover tail**. Pay staff + Explore + Build payout all
  use it; **verify §8/§9** rewritten to Clayton's Alex example; legacy doc §7 updated.
  **No migration** — but **re-sync if `ca_invoices.date_of` lacks the day** (else every
  invoice prorates as day-1). Decisions: per-mentor ramp, `date_of` date, fixed-30
  (the user's March 38.7% implies actual-days, but they chose 30 — Mar 12 → 40%).
- **"Meetings to Freedom!" metric card** (user request) on the **Metrics** tab — per
  graduated mentee, 1-on-1 mentoring sessions (4x/2x/1x) from JumpStart completion
  (the JumpStart engagement **end date**, fallback first ongoing-tier entry) to
  graduation; group sessions excluded. Avg/median/n/range tiles + per-mentee bars +
  table; all-time (not range-scoped). Pure `lib/freedom.ts` (`computeMeetingsToFreedom`,
  **verify §14**); threaded `ca_engagements.end_date` → `MenteeJourney.jumpstartEndDate`.
  **No migration.** Has a "?" article.
- **Expanded contextual-help "?" coverage** to Mentor capacity, Resource engagement,
  the Discovery / Raw data / Company options tabs (new articles in `src/help/articles.ts`).
- **Conversion bars color-coded by outcome + channel.** The Discovery→conversion bars are
  stacked by outcome (soft palette: sea-green/gold/coral/slate) AND split by channel —
  **Zoom = solid, Phone = grid pattern** (SVG `<defs>`); `convData` carries per-outcome
  phone/zoom counts (`OUTCOME_COLORS`/`OUTCOME_ORDER`).
- **★ Full visual redesign — professional, crisp, light + dark (the last 006c item).**
  New **`src/theme.tsx`** `ThemeProvider` writes `<html data-theme>` (persisted to
  localStorage `hjg.theme`, falls back to OS pref); a **toggle** sits in the topbar and
  `index.html` sets the theme **pre-paint** (no flash). `styles.css` was rebuilt around a
  **light (default) + dark** token set with a crisp business feel: **small radii** (6px
  cards / 4px controls + pills), 1px borders, restrained shadows, a refined **blue accent**;
  pills/badges/notices use shared semantic **tone tokens** so both modes read well. Charts
  are theme-aware via **`useChartTokens()`** (axis/grid/tooltip/accent/cmp per theme) —
  `MetricsView` / `PayStaffView` / `JourneysView` derive them per render (recharts can't
  read CSS vars). The embedded **Maps follow the theme**: `MapsView` passes `?theme=`, and
  both `public/data-map.html` + `public/pay-map.html` gained a light palette + a pre-paint
  bootstrap. **No migration.**

All 006c work is **no migration, no schema change** (except the pay-engine re-sync caveat
below). `typecheck` + `verify` (**14 sections**) + `build` all pass. **UI NOT browser-tested**
(headless) — eyeball both themes + the charts on a Vercel preview. **`FEATURE_BACKLOG.md`
has no planned items.**

**▶ Next-session checklist:**
1. **Browser-verify both themes** (toggle in the topbar) across every tab — especially the
   recharts cards (axis/grid/tooltip), the color-coded conversion bars, and the two Maps.
2. **Re-sync if needed** so `ca_invoices.date_of` carries the day (else Clayton proration
   treats every invoice as day-1). Quick check: Raw data → `ca_invoices` → `date_of` shows
   real days, not `-01`.
3. Optional polish: the Pay-staff "Billed" reference bar is still a fixed `#334155`;
   per-mentee colors in `pay-map.html` are CSS-var driven now but the Period-B/`CMP` and a
   few series colors are fixed mid-tones (read on both, not theme-perfect).

---

## Resume here (live state — 2026-06-22, session 006b — WRAPPED)

Picking this up cold — start here. **Session 006b shipped 6 features straight to
`main`** (per the user) and **emptied `FEATURE_BACKLOG.md`** (everything moved to its
"Shipped" section). Working tree clean, all pushed. Before push each commit passed
`typecheck` + `verify` (now **13 sections**) + `build`. **UI not browser-tested**
(headless container) — eyeball the 6 features on a Vercel preview.

**⚠ TWO new migrations this session — both MUST be applied** (Supabase SQL Editor):
`9989_payout_builds.sql` (Build payout) and `9988_mentee_exclusions.sql` (Journeys
exclude). Until each is applied its writes error (Save/Approve/Discard; Exclude/
Include). Both staff-RLS, one row per key, re-runnable.

**Shipped this session (006b):**
- **Build payout — interactive review/builder (backlog #1).** A full top-nav tab
  ("Build payout") that layers human review over the payroll engine: pick a mentor +
  month → every engine line is listed with an include/exclude checkbox, a per-line
  **override + note**, and a live **running-total** side panel (built vs engine total,
  delta, counts). **Persists** to `payout_builds` (migration 9989): **Save draft →
  Approve → Reopen**, **Discard**, **CSV export**; month dropdown badges saved
  months. Engine numbers are never mutated (overrides live only in the review record;
  read-only toward CA). Pure math in **`lib/payBuild.ts`** (re-exported via `db.ts`),
  locked by **verify §13**. Cross-linked from the Pay-staff tab via a "Build payout →"
  button. New tab in `src/App.tsx`; `payout_builds` added to the Raw-data viewer.
  ⚠ **Not browser-verified** (headless container) — browser/Vercel-preview check the
  tab, the save/approve/reopen/discard round-trip (after 9989), overrides, CSV.
- **Data map → its own in-app tab (backlog #1, the old #2).** The data-relationship
  map is now a **top-nav tab** ("Data map", between Raw data and Admin) instead of a
  button opening `/data-map.html` in a new browser tab. `src/views/DataMapView.tsx`
  embeds the static D3 page in an **iframe** (fast/faithful; native-React + live
  Supabase is the later upgrade) with a "Full screen ↗" link; the old Raw-data button
  is removed. **No migration.** ⚠ Not browser-verified.
- **Contextual help — "?" drawer framework + seed articles (backlog, the old #3).** A
  reusable **`HelpButton`** opens a right-side **slide-in drawer** with a short
  explainer (definition + logic + source tables). Articles are Markdown strings in
  **`src/help/articles.ts`** (keyed by `helpId`); tiny renderer + drawer in
  **`src/components/HelpDrawer.tsx`**. Wired additively via an optional **`helpId` on
  `ChartCard`** (Metrics cards) + standalone buttons on Pay staff, Build payout, and
  Journeys pipeline-timing. **No migration.** Add a `HelpButton` + an article to cover
  more cards. ⚠ Not browser-verified.
- **Metrics — Discovery→conversion drill-down (backlog, old #5).** Clicking a bar in
  the conversion chart opens the Explore modal **pre-filtered to that month's**
  discovery calls. Month key threaded via a `_key` field on the chart row; built from
  the exact rows that made the bar. Single-period only (inert in compare mode). **No
  migration.** ⚠ Not browser-verified.
- **Metrics — sticky range/preset bar (backlog, old #6).** The presets + date inputs +
  Compare toggle freeze to the top while scrolling (`.range` is `position: sticky`).
  Pure CSS, no markup change. **No migration.** ⚠ Not browser-verified.
- **Journeys — exclude a mentee (test/placeholder), dashboard-wide (backlog, old #4).**
  New HJG-owned **`mentee_exclusions`** table (**migration `9988_…`**) — a reversible,
  staff-owned sibling of `ca_clients.is_excluded`. Excluded clients drop from Metrics
  range appointments and the Journeys pipeline aggregates; the mentee stays listed
  (greyed) with an **Exclude/Include** toggle in the detail panel.
  `fetchExcludedClientIds` is honored by `fetchRangeAppointments` + flagged on
  `fetchMenteeJourneys`. Added to the Raw-data viewer. ⚠ **Needs 9988 applied**; not
  browser-verified.

**The session-006/006b FEATURE_BACKLOG is now fully shipped — no planned items left.**
Two new migrations this session that MUST be applied: **`9989_payout_builds.sql`**
(Build payout) and **`9988_mentee_exclusions.sql`** (Journeys exclude).

Everything below is the prior session-006 wrap (still current unless noted above).

---

## Resume here (live state — 2026-06-22, session 006 — WRAPPED)

Picking this up cold — start here.

**Repo state:** session 006 is **wrapped and fully on `main`** (all work this
session went straight to `main`; `main` also carries everything from sessions
003–005b). Working tree clean, everything pushed. Before push: `typecheck`,
`verify` (**12 sections**), `build` all pass. **UI not browser-tested** (headless
container) — see the browser-verify list in "Immediate next steps".

**⚠ Migrations — one NEW this session.** `9999`–`9991` are applied (per the user).
**`9990_company_options.sql` is NEW and MUST be applied** — it seeds the
`journeys_stage_basis` key; the Company-options / Journeys stage-date toggle works
in-session but **won't persist** until it exists (staff can UPDATE `app_settings`
but not INSERT). After applying, a **re-sync** (Admin → Sync now) is still the gate
that (a) populates the **Pay staff** tab, (b) takes the capacity/group reclass +
delivery signal live, and (c) feeds the **capacity weekly-slot fix** (needs
`start_raw`). Then do the eyeball checks under "Immediate next steps".

**Shipped this session (006) — Metrics "Compare" mode (period vs period):**
- **Compare toggle** on the Metrics page. On → pick **Period A vs Period B**.
  Presets **MoM / QoQ / YoY** auto-derive a **span-aligned** Period B from A
  (year-to-date stays comparable to year-to-date); plus free **custom** A/B
  ranges. Off → the view returns to the exact single-period state.
- **Board scorecard** card at the top (`ChartCard`): grouped A/B bars for the four
  headline KPIs + a **delta table** covering every metric (KPIs, conversion rate,
  manual resource metrics) with **Δ** (absolute) and **Δ%** (vs Period B);
  conversion-rate Δ is in percentage points.
- **Per-chart overlays**: every time-series card draws Period B too — a **paired
  bar** on bar charts (Discovery, Meetings[total], Mentors) and a **dashed
  reference line** on the line/composed charts (Active mentees, Discovery →
  conversion). Each card's **table gains B + Δ columns** in compare mode.
- **Pure math** in **`lib/compare.ts`** (`shiftMonths`, `derivePeriodB`, `delta`,
  `COMPARE_PRESETS`), re-exported through `src/db.ts` (same pattern as the pay
  engine). New format helpers `signed`/`signedPct`/`signedPp`. Locked by
  **verify §10**. Period A computation refactored to share `reduceMonthRows` /
  `groupByMonth` with Period B so a comparison is always apples-to-apples.
- ⚠ **Not browser-verified** (headless container) — **browser/Vercel-preview
  check** the compare toggle, scorecard, overlays, and Δ tables. The B-overlay on
  the Meetings card only renders in **"Total"** mode (compare-types mode keeps its
  per-type bars; its Δ table still compares total meetings A vs B).

**Also shipped this session (006) — Pay-staff Explore coach dropdown scoped:**
- The **Coach** filter in the Pay-staff "Explore source data" window
  (`src/components/PayExploreModal.tsx`) now lists only coaches with **≥1 row in
  the active view** under the current month/tier/text filters — computed from
  everything **except** the coach filter itself (so picking a coach doesn't
  collapse the dropdown). Selecting a coach that drops out of range auto-resets to
  "All coaches". This **emptied the `FEATURE_BACKLOG.md` planned list** (both items
  now shipped). ⚠ browser-verify alongside Compare mode.

**Also shipped this session (006) — two bug fixes + a cleanup:**
- **Capacity weekly-slot fix (bug #1).** New pure **`lib/capacity.ts`**
  (`oneOnOneMenteesByCoach`, `groupSlotKeys`) drops unnamed **multi-client time
  slots** (same coach + same exact `start_raw`, 2+ distinct clients) from 1-on-1
  capacity, closing the residual Arthur-Nisly inflation the named-format fix
  missed. `RangeAppt` now carries `startRaw` (fetched from `ca_appointments.start_raw`;
  `start_date` is day-only). Capacity-only — still counts as mentoring everywhere
  else. Verify **§11**.
- **Client/server divergence fix (bug #2).** Deleted the dead `api/reports/funnel.ts`
  endpoint (only consumer of `computeFunnelReport`, never called by the UI, counted
  mentors differently). Pure funnel/metrics logic kept (verify + C# port).
- **Cleanup.** Removed the dead `MENTOR_COACH_ID_WHITELIST` from `lib/config.ts`
  and its (empty/no-op) gate in `computeMonthlyMetrics`.
- Left as requested: pay-staff revenue-basis confirmation, mid-month hand-off
  split, and mentor-start eyeballing (bugs #3–5 — they hinge on a re-sync +
  `ca_invoices` spot-check). ⚠ the capacity fix needs a re-sync + browser verify.

**Also shipped this session (006) — Company options tab + Journeys stage-date basis:**
- **NEW "Company options" tab** (`src/views/CompanyOptionsView.tsx`) — self-serve,
  **org-wide** settings as dropdowns grouped by section. Registry-driven: declare an
  option in **`src/companyOptions.ts`** (key/section/label/help/choices/default) + seed
  its key in a migration → it appears automatically. Persisted in `app_settings` (jsonb)
  via `fetchCompanyOptions`/`setCompanyOption`. **Migration `9990_company_options.sql`
  seeds `journeys_stage_basis` and MUST be applied** for changes to persist.
- **Journeys stage-date basis** — pure **`lib/journey.ts`** (`computeStageDates`,
  `highestTier`) with two bases: `engagement_start` (CA engagement start, the prior
  behavior) and `first_meeting` (first 1-on-1 mentoring meeting under that tier's
  engagement, group sessions excluded, fallback to engagement start). `db.ts`
  `fetchMenteeJourneys(basis)` + `buildClientStages` (replaces `stagesByClient`;
  `RangeAppt`/meetings now carry `isGroup`, engagements carry `id`). A segmented
  toggle on the Journeys tab flips it and persists the same org-wide setting.
  Verify **§12**. **This is the answer to the Seth-Lehman question** — see the data
  review: 7/2 is his 4x engagement's real start date; "first meeting" shows 7/3.
- **Backlog:** added **5 planned items** (Data map → own tab; contextual "?" help;
  Journeys exclude-mentee; conversion column drill-down; sticky range bar).

**Shipped this session (005b) — Pay-staff re-evaluation tooling:**
- **By-month breakdown.** The Pay-staff tab no longer shows one month at a time.
  It now leads with a **payout-by-month graph + an all-months expandable table**
  (click a month → per-mentor breakdown inline). All-time summary tiles up top.
- **"Explore source data" window** (`src/components/PayExploreModal.tsx`) — a
  modal with three views: the **compiled payout ledger** (one row per mentee per
  month: month, coach, mentee, tier, collected, active days, proration, split,
  payout) plus the **raw `Invoices` and `Engagements` engine inputs** that fed it
  (toggle between them). Every view is **sortable** (click any header) and
  **filterable** by month range, coach, tier, and free text; each exports the
  current (filtered+sorted) view to CSV.
- **Reusable `src/components/SortableTable.tsx`** (tri-state header sort + CSV) —
  available to reuse elsewhere (e.g. the Raw data tab) later.
- **Engine:** new pure **`computePayTimeline`** + flat **`PayLedgerRow`** in
  `lib/pay.ts` (a thin map over the untouched `computePayReport`, so per-month
  math is identical). Covered by **verify §9**.
- ⚠ Still gated on data: the tab is empty until **`9993_ca_invoices.sql`** is
  applied + a re-sync runs (see below). The by-month view and explorer light up
  with the same re-sync.

**Shipped this session (005) — staff payment tool + invoice sync:**
- **NEW "Pay staff" tab** (`src/views/PayStaffView.tsx`) — per-mentor monthly
  payout. Each mentor earns a **ramped share** of revenue **collected** from each
  mentee, credited to the invoice's **service month** (`date_of`) and **prorated
  by active engagement days**. Graph + table (north star), per-mentor mentee
  breakdown, CSV export, month picker.
- **Payout engine** `lib/pay.ts` (pure, tested in verify §8): ramp **35% → 50% →
  60%** by mentor tenure month (derived from earliest engagement, overridable
  later); daily proration; pay-on-collected; "unassigned" bucket for collected
  revenue with no overlapping engagement.
- **Invoice sync** (read-only) → new **`ca_invoices`** mirror (migration
  **`9993_ca_invoices.sql`**). `Invoice.getAll` → billed `amount`, collected
  `amount_paid`, `date_of` service month, line items + payments (jsonb).

**⚠ ACTION REQUIRED for Pay staff to show data:** apply **`9993_ca_invoices.sql`**
(and **`9992_appointment_counts_in_engagement.sql`**, new this session) in the
Supabase SQL Editor, then **re-sync** (Admin → Sync now). Until then the tab shows
an empty-state banner. **Then export `ca_invoices` and confirm the invoices
actually carry the monthly subscription charges** ($425 = 4x, etc.) — if CA bills
subscriptions elsewhere, we switch the revenue source to a tier→price config
(engine unchanged). Decisions captured in `Session log/005_2026-06-19/`.

**Delivery signal (session 005b):** the sync now mirrors CA's
**`countsInEngagement`** as `ca_appointments.counts_in_engagement` (1 = delivered/
credited, -1 = not counted, 0 = no judgement, null = pre-sync). After applying
`9992` + a re-sync, **export `ca_appointments` and eyeball the 1 / -1 / 0
distribution** — it's only useful for "did the paid-for sessions happen?" if the
coaches actually maintain that flag in CA. If they do, it unlocks a *pay-on-
delivered* verification layer over the collected-revenue model.

**Branch cleanup (partial):** the three feature branches
(`admiring-lovelace-3tb4iy`, `magical-gauss-ELOiz`, `practical-meitner-toynll`)
are fully captured in `main`. The local branch was deleted, but **remote
deletion was blocked by the git proxy (HTTP 403)** and there's no branch-delete
GitHub tool in this environment — **delete the three remote branches via the
GitHub UI** (Branches page) when convenient. They're redundant, not load-bearing.

**▶ Immediate next steps (prioritized, end of session 006):**
1. **Apply `9990_company_options.sql`** in the Supabase SQL Editor (seeds
   `journeys_stage_basis`) — until then the Company-options / Journeys stage-date
   toggle won't persist.
2. **Re-sync (Admin → Sync now)** — the one gate that's still pending. It (a)
   populates the **Pay staff** tab, (b) takes the **capacity/group reclass** +
   **delivery signal** live, and (c) feeds the **capacity weekly-slot fix** (needs
   `start_raw`). After it: eyeball **Arthur Nisly's** capacity row (inflation gone),
   and **export `ca_invoices`** to confirm invoices carry the subscription charges
   ($425 = 4x, etc.) — else swap the engine to a `tier→price` config (no engine
   change; tab shows an empty-state banner until invoices land).
3. **Browser / Vercel-preview verify** the session-006 UI (container is headless):
   - **Metrics Compare mode** — toggle, scorecard, per-chart overlays, Δ tables,
     MoM/QoQ/YoY/custom.
   - **Company options** tab + **Journeys stage-date toggle** (engagement start vs
     first 1-on-1 meeting) — re-check **Seth Lehman** (4x shows 7/2 on engagement
     basis, 7/3 on first-meeting basis).
   - **Pay-staff Explore** coach-dropdown scoping; the **capacity** card.
4. **Pick the next build from `FEATURE_BACKLOG.md`** (6 planned items). The user has
   flagged **#1 "Build payout" interactive review/builder** as wanted next.
5. **Delete the three stale remote branches** via the GitHub UI (proxy blocked
   `git push --delete`): `admiring-lovelace-3tb4iy`, `magical-gauss-ELOiz`,
   `practical-meitner-toynll` — all fully captured in `main`.
6. Later: widen `SYNC_YEARS` so pre-window JumpStart engagements aren't missing a
   start date.

**Verification status:** `npm run typecheck`, `npm run verify` (**12 sections** —
added [10] compare-mode period math, [11] capacity 1-on-1 vs group slots,
[12] journey stage-date basis), `npm run build` all pass. UI not browser-tested
(headless container) — **browser-verify the by-month table + Explore window once
invoices are synced, the Metrics Compare mode, the capacity card after a re-sync,
and the new Company options tab + Journeys stage-date toggle (after applying 9990).**

## What this is

A dashboard for Henry Jude Group (a faith-based mentoring nonprofit) that
**mirrors CoachAccountable (CA) data into Supabase Postgres** and presents
mentoring / discovery-funnel / **pipeline-journey** metrics for board reporting.
Staff log in, data syncs from CA on demand, the dashboard reads the mirror.

> Read-only toward CA. `SPEC.md` has CA API details + categorization rules but
> its KV/on-demand parts are superseded by the Supabase-mirror model.

## Stack

- **Frontend:** React 18 + Vite + TS + `recharts`; Supabase Auth gates the app.
  `write-excel-file` for the multi-sheet export.
- **Backend:** Vercel serverless functions (TS, **ESM**) under `api/`.
- **Data:** Supabase Postgres; CA pulled via `POST /api/sync`.
- **Hosting:** Vercel, GitHub `radiodinner/hjg-data-plugin`. Feature branches
  deploy as **Preview**; `main` → production.

## App tabs

- **Metrics** — date-range KPIs + charts; every ChartCard has Graph/Table/Both +
  Export CSV + Explore. Includes the **Discovery → conversion** ChartCard
  (converted bars + conversion-rate line), Resource engagement, and Mentor
  capacity utilization (group-session inflation fixed session 003).
- **Discovery** — discovery calls; auto outcome + manual override.
- **Journeys** — per-mentee pipeline timeline `Discovery → JumpStart → 4x
  → 2x → 1x → Graduation` from engagement stage dates, current tier, observed
  meeting-rhythm chart, and a status override (active/graduated/quit/fired).
  Top card = **board-level aggregate** leg durations (avg/median/n) as graph +
  table. Mentee search/list on the left.
- **Pay staff** (session 005; reworked 005b) — per-mentor payout: ramped % (35/
  50/60 by tenure) of **billed** mentee revenue (collected shown for reference),
  by invoice **service month**,
  prorated by active days. **By-month**: payout-by-month graph + all-months
  expandable table (expand → per-mentor breakdown). **Explore source data**
  window: sortable/filterable compiled ledger + raw invoice/engagement inputs
  (filter by month/coach/tier/text, CSV per view). Empty until `ca_invoices` is
  synced.
- **Raw data** — browse `ca_*`/HJG tables (incl. **`ca_invoices`**); per-table
  CSV export; **Export all → `.xlsx`** (one table per sheet); **Data map ↗** link.
- **Admin** — Sync now, run history, settings, Manual metrics, Mentor capacity.
- **Company options** (session 006) — self-serve, **org-wide** dashboard settings as
  dropdowns, grouped by section. Registry-driven (`src/companyOptions.ts`); persisted
  in `app_settings` (jsonb). First option: **Journeys → stage-date basis** (engagement
  start vs first 1-on-1 meeting), also togglable inline on the Journeys tab.

## Key files

| Path | Role |
|---|---|
| `lib/ca.ts` | CA API client (read-only). `getEngagements()`, **`getInvoices()` = Invoice.getAll**. **CA payload under `return`, not `result`.** |
| `lib/config.ts` | Categorization (incl. **`GROUP_SESSION_CONTAINS`** → `"group"`), exclusions, conversion knobs (`CONVERSION_OFFERING_IDS=[42840]`), **`engagementTier()` + `PIPELINE_TIERS`**, CA function names (incl. **`invoiceGetAll`**). |
| `lib/conversion.ts` | Pure discovery→conversion resolver. Verify §5. |
| `lib/pay.ts` | **Pure staff-payment engine** (`computePayReport`): ramp 35/50/60 by tenure, daily proration, **pay-on-billed** (invoice `amount`; collected carried for reference). Verify §8. |
| `lib/sync.ts` | Sync orchestration; offerings/submissions + **engagements** + **invoices** are best-effort (warnings accumulate). |
| `src/db.ts` | Browser data access. `fetchMenteeJourneys`, `aggregateJourneyDurations`, **`fetchPayData`** (+ re-exports `computePayReport`); mentee_outcomes read/write; `fetchAllRows`. |
| `src/views/JourneysView.tsx` | The Journeys tab (timeline + aggregate). |
| `src/views/PayStaffView.tsx` | **The Pay staff tab** (payout graph+table, per-mentor breakdown). |
| `src/views/MetricsView.tsx` | Metrics dashboard (ChartCards, conversion, capacity). |
| `src/xlsx.ts` | Multi-sheet `.xlsx` workbook export. |
| `public/data-map.html` | Static interactive data-relationship graph (snapshot). |
| `lib/pay.ts` | …also **`computePayTimeline` + `PayLedgerRow`** (multi-month + flat ledger; verify §9). |
| `src/components/SortableTable.tsx` | **Reusable** click-to-sort table + CSV export of the sorted view. |
| `src/components/PayExploreModal.tsx` | **Pay-staff "Explore source data"** window (ledger / invoices / engagements; sort + filter). |
| `scripts/verify-metrics.ts` | Pure-logic checks; **§6 tier mapping, §7 group categorization, §8 staff payment, §9 pay timeline/ledger**. |

## Important domain decisions

- **Pipeline tiers live in `ca_engagements.name`** (`MN Subscription | (Nx
  Month) …`; legacy `Every N Appointments` / `ONE|TWO appointment per month` /
  `WEEKLY appointments`). `engagementTier()` maps them; the word "weekly" is
  ignored as a signal (legacy names always say "60 min weekly Zoom call").
  Snapshot funnel: JumpStart→4x→2x→1x→graduated ≈ 102→149→55→18→10.
- **Graduation** = an "After Graduation Care" engagement (auto), or a manual
  `mentee_outcomes` override. Override always wins; quit/fired can be any stage.
- **Mentee activity:** active if a meeting OR open engagement within 45 days.
- Discovery counted by **signup date**; mentee meetings/mentees/mentors by
  **scheduled date**. Conversion is automated read-time (offering 42840).
- Group "In Depth" / "Tracking Together" sessions are categorized **`"group"`**
  (not `"mentoring"`) so they don't inflate per-mentor capacity (Arthur Nisly).
  They still count as mentoring meetings everywhere else via the `isGroup` flag.
  **Fixed session 003 — needs a re-sync to take effect.**

## Database schema (Supabase)

Mirror (sync-written, all-authenticated read): `ca_coaches`, `ca_clients`,
`ca_appointments` (+ **`counts_in_engagement`**, 9992 — apply + re-sync),
`ca_offerings`, `ca_offering_submissions`, `ca_engagements`
(9994), **`ca_invoices` (9993 — apply + re-sync to populate)**. Ops: `sync_runs`,
`app_settings` (budget/sync knobs + **Company options** like `journeys_stage_basis`,
9990 — string jsonb values; staff UPDATE-only, keys seeded by migration). HJG-owned
(staff RLS): `discovery_outcomes`, `mentee_outcomes`
(9995), `coach_settings` (9996), `manual_metrics` (9997), plus dormant
`graduations`/`cadence_status_log`.

## Environment variables

(unchanged — set in Vercel, documented in `.env.example`) `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`CA_API_ID`, `CA_API_KEY`, `CA_PLAN_DAILY_LIMIT`, `HJG_DAILY_CAP_PCT`,
`BUDGET_TZ`, `SYNC_YEARS`, `HJG_CORS_ALLOWED_ORIGINS`, `SYNC_CRON_SECRET`.

## Conventions / gotchas

- **Migrations DESCENDING** (newest = lowest). Present = `9987`…`9999`. **Next
  new one is `9986_…`.** Run by copy-paste into the Supabase SQL Editor; make
  re-runnable (`drop … if exists` / `add column if not exists`). **NEW this session
  (007): `9987_journeys_stage_colors.sql`** — seeds the `journeys_stage_colors`
  Company option (JSON-string value via `to_jsonb(...::text)`); the stage-color editor
  won't persist until it's applied. `on conflict do nothing`, re-runnable.
- **Vercel functions are native ESM** → relative imports in `api/` (+ `lib/` it
  pulls in, e.g. `ca.ts`/`sync.ts`) MUST end in `.js`. **BUT** pure `lib/` modules
  consumed by the frontend (`config.ts`, `conversion.ts`, **`pay.ts`**) use
  **extensionless** imports — under Vite's "Bundler" resolution a `.js` specifier
  leaves the module untyped (everything `any`). Match the file's neighbors.
  Frontend (`src/`) imports lib via `src/db.ts`; note `src/lib/` also exists, so
  from `src/views/` the repo-root lib is `../../lib` — re-export through `db.ts`.
- `public/*` is copied to the build root → served at `/<file>`; the SPA rewrite
  in `vercel.json` only applies when no real file matches.
- Env var changes need a redeploy; after a schema migration, re-sync.
- Verify locally: `npm install && npm run typecheck && npm run verify && npm run build`.

## Open items / TODO

- **`FEATURE_BACKLOG.md` has 6 planned items** (added late in session 006). Newest
  first: **#1 "Build payout"** interactive review/builder (Pay staff — the user
  wants this next), #2 Data map → own tab, #3 contextual "?" help, #4 Journeys
  exclude-mentee, #5 conversion column drill-down, #6 sticky range bar. Two items
  already **shipped** this session (Compare mode, Pay-staff coach-dropdown scoping)
  are in that file's "Shipped" section.

- **Pay staff — revenue basis = BILLED (decided session 005b).** The engine now
  pays on the invoice's billed `amount` (what's owed for the service month "in a
  perfect world"), credited to `date_of`; `amount_paid` is carried only for
  reference (shown alongside, never drives payout). Still to confirm after `9993`
  + re-sync: **export `ca_invoices` and verify invoices carry the monthly
  subscription charges** ($425 = 4x, etc.). If CA doesn't invoice the
  subscriptions, swap the revenue source to a `tier → price` config (engine + UI
  unchanged).
- **Pay staff — mentor-start override — SHIPPED (session 005b).** Tenure for the
  35/50/60 ramp defaults to the coach's earliest engagement, but can be pinned via
  `coach_settings.pay_start_month` ('YYYY-MM', migration 9991), edited in Admin →
  Mentor capacity → "Pay start". Threaded through `fetchPayData.startMonthOverride`
  → `computePayTimeline`. **Eyeball the derived dates and set overrides for any
  veteran who looks "new".** (A per-coach split-table override is still possible
  later if the 35/50/60 values ever vary by mentor.)
- **Pay staff — multi-coach month.** A mentee with a mid-month hand-off is
  attributed 100% to the majority-day coach (not split). Revisit if it matters.
- **Mentor capacity inflation (Arthur Nisly) — FIXED.** Named group formats get a
  separate `"group"` category scoped to capacity via `isGroup` (session 003), AND
  the residual **multi-client weekly-slot** case is now handled too (session 006):
  `lib/capacity.ts` treats any (coach, exact `start_raw`) slot with 2+ distinct
  clients as a group and drops it from 1-on-1 capacity. Both still need a **re-sync
  + browser verify** to confirm on live data. (Slot detection keys on `start_raw`;
  a slot with no time is treated as a 1-on-1.)
- **Data map is a static snapshot** — wire to live Supabase if wanted.
- **Stage rail** has no explicit quit/fired exit marker (status pill covers it).
- **`MENTOR_COACH_ID_WHITELIST` — REMOVED (session 006).** Was dead/empty;
  `computeMonthlyMetrics` no longer references it (behavior identical).
- **Client vs server metric divergence — RESOLVED (session 006)** by deleting the
  dead `api/reports/funnel.ts` endpoint (the only consumer of `computeFunnelReport`,
  never called by the UI; it counted mentors differently than the UI). The pure
  `lib/funnel.ts` / `lib/metrics.ts` stay (verify §1/§3, needed for the C# port).
- Bundle > 500 kB (recharts + write-excel-file) — cosmetic.
- **C# rebuild** — separate track, not started (`CSHARP_PORT.md`).
