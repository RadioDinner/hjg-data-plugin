// Contextual-help articles (backlog feature: a "?" on cards that side-loads an
// explainer). Each article covers: what the number is, the logic behind it, and
// exactly which tables/columns feed it — so board users and staff can trust the
// dashboard without a guided tour.
//
// Articles are authored here as Markdown strings (a tiny renderer in
// src/components/HelpDrawer.tsx handles ## / ### headings, - lists, **bold**, and
// `code`). Keyed by a stable helpId so a <HelpButton id="…" /> anywhere resolves
// to the right article. Bundled with the code on purpose — versioned alongside the
// logic it describes, no extra write path or fetch. Add a card's help by adding an
// entry here and dropping a HelpButton with the matching id.

export interface HelpArticle {
  title: string;
  body: string; // Markdown
}

export const HELP_ARTICLES: Record<string, HelpArticle> = {
  "metrics.discovery": {
    title: "Discovery calls",
    body: `Intro / discovery calls in the selected date range.

### How it's counted
- Counted by the date the call was **booked** (the prospect's signup), not the date the call happened — so a month reflects demand that came in that month.
- Split **Phone** vs **Zoom** by the appointment type.

### Source
- \`ca_appointments\` rows categorized as *discovery* (the rules live in \`lib/config.ts\`).
- Placeholder / excluded clients are left out (\`ca_clients.is_excluded\` + the exclusion list in \`lib/config.ts\`).`,
  },

  "metrics.meetings": {
    title: "Mentee meetings",
    body: `The number of mentoring meetings that occurred in the range.

### How it's counted
- Counted by the meeting's **scheduled date**.
- Includes **1-on-1 and group** mentoring. Group "In Depth" / "Tracking Together" sessions count as mentoring meetings here — they're only carved out of *per-coach capacity* (so one group session doesn't look like many 1-on-1s).

### Source
- \`ca_appointments\` categorized as *mentoring* or *group* (\`lib/config.ts\`). Discovery calls are excluded.`,
  },

  "metrics.mentees": {
    title: "Active mentees",
    body: `Distinct mentees who had at least one mentoring meeting in the range.

### Logic
- A mentee is counted once no matter how many meetings they had.
- Counted by the meeting's **scheduled date**.
- Placeholder / test accounts are excluded (\`ca_clients.is_excluded\` + the name exclusion list in \`lib/config.ts\`).

> Note: the **Journeys** tab uses a broader "active" definition (a meeting *or* an open engagement within 45 days). This card is strictly "had a mentoring meeting in the range".`,
  },

  "metrics.mentors": {
    title: "Mentors",
    body: `Distinct coaches who ran at least one mentoring meeting in the range.

### Logic
- A coach is counted once regardless of how many mentees or meetings.
- Counted by the meeting's **scheduled date**.

### Source
- The \`coach_id\` on \`ca_appointments\` categorized as mentoring/group.`,
  },

  "metrics.conversion": {
    title: "Discovery calls → conversion",
    body: `Every discovery call in the range and how it resolved — this single card combines the call counts (total, plus the Phone / Zoom split) with the conversion outcomes.

### Reading the bars
- Each column's **height** is that month's total calls, **colored by outcome** (converted / pending / not converted / no show); the **line** is the conversion-rate **trend** (see below).
- **Channel:** **solid** segments are **Zoom** calls, **grid-patterned** segments are **Phone** calls.

### The trend line
- The line is a **trailing-window** conversion rate, not each month in isolation: each point is the rate over the window ending there, so it's smoother than the raw monthly rate. The **table** still lists the exact per-month rates.
- The window length — **N weeks or N months** — is an org-wide setting under **Company options → Metrics → "Conversion-rate trend window"** (default 3 months). A longer window = a smoother, slower-moving trend.
- It's computed from the calls in the selected range, so the **earliest points** reflect a shorter (warming-up) window.

### When a call converts
- A call **converts** when the prospect purchases **JumpStart Your Freedom (Waiting List)** (offering \`42840\`) on or after the call date.
- No purchase yet, still within 30 days of the call → **pending**.
- 30 days elapsed with no purchase → **not converted**.
- A **staff override** on the Discovery tab always wins over the automatic result.

### Rate
- **Conversion rate = converted ÷ resolved calls** (pending calls aren't counted against the rate until they resolve).

### Source
- \`ca_offering_submissions\` for offering \`42840\`, the discovery appointments, and any \`discovery_outcomes\` overrides. Pure resolver in \`lib/conversion.ts\`.`,
  },

  "metrics.compare": {
    title: "Compare mode (Period A vs Period B)",
    body: `Compares two periods side by side.

### Periods
- **Period A** is the period you picked. **Period B** is what it's compared against.
- Presets **MoM / QoQ / YoY** derive Period B from A and **span-align** it — a year-to-date Period A is compared to the same year-to-date slice of the prior year, not a full year.
- Or set **custom** A and B ranges.

### The numbers
- **Δ** is the absolute change (A − B). **Δ%** is the change relative to Period B.
- Conversion-rate Δ is shown in **percentage points**, not percent-of-percent.
- Every time-series card also overlays Period B (a paired bar or a dashed line), and its table gains B + Δ columns.

Pure math lives in \`lib/compare.ts\`.`,
  },

  "pay.payout": {
    title: "How staff pay is computed",
    body: `Each mentor earns a **ramped share of the revenue billed** to their mentees, split across two months by each invoice's date (the method the former admin, Clayton, used).

### The share (ramp)
- The share **ramps with the MENTOR's tenure**: month 1 = **35%**, month 2 = **50%**, month 3 onward = **60%** — applied to **all** their mentees. Tenure is from the mentor's earliest engagement (or a pinned start in Admin → Mentor capacity).

### The two-month split (Clayton)
- Pay is on the amount **billed** (invoice \`amount\`); collected is reference only.
- An invoice dated on **day D** of its month is split by where D falls, using a **fixed 30-day** month: \`elapsed = D / 30\`.
  - The **remaining** part \`(1 − elapsed)\` is paid in the **invoice's own month**.
  - The **elapsed** part rolls forward and is paid the **next month**.
- So a month's payout = **this month's invoice × (1 − elapsed) + last month's invoice × its elapsed**, all × the mentor's rate. Each invoice's two slices add back to its full share, so the mentor is made whole across the two months.

### Attribution (which coach gets paid)
- A mentee's invoice is credited to their **owner = CoachAccountable primary coach** (\`ca_clients.coach_id\`). Re-pair a mentee in CA + re-sync to move their pay to a different coach.
- **Fallback** (owner not synced yet — needs migration \`9984\` + a re-sync): the coach on the covering **engagement** — for the invoice's \`date_of\`, the most-recently-started engagement spanning it, else the most-days-covered coach that month.
- The **tier** always comes from the engagement coverage regardless of who's paid. Revenue with no owner *and* no engagement shows as **"unassigned"**, never dropped.
- See the **"How clients are matched to coaches"** help for the full picture.

### Source
- \`ca_invoices\` (billed, service **date** \`date_of\`) + \`ca_clients.coach_id\` (owner) + \`ca_engagements\` (tier + fallback coach). Engine in \`lib/pay.ts\` (\`primaryCoachOf\` → \`coverOnDate\` → \`coverInMonth\`); see \`docs/legacy-pay-calculator.md\`.`,
  },

  "pay.build": {
    title: "Build payout — the review layer",
    body: `A deliberate **human checkpoint** over the automated pay engine, so every payment can be personally checked before money goes out.

### What you do
- Pick a **mentor + service month**; every engine-computed line for that coach/month is listed.
- **Include / exclude** each line with the checkbox, or **override** a line's payout and add a **note** explaining why.
- The side panel shows the **built (signed-off) total** vs the **engine total**, the **delta**, and how many lines were dropped / overridden.

### Saving
- **Save draft** to come back later; **Approve** to sign the month off; **Reopen** to edit an approved month again. **Discard** removes the saved review.

### Important
- This **never changes the engine's numbers** — overrides and exclusions live only in the review record (\`payout_builds\`). It's read-only toward CoachAccountable; the engine stays the source of truth.`,
  },

  "journeys.aggregate": {
    title: "Pipeline leg durations",
    body: `Board-level view of how long mentees take to move through the pipeline: **Discovery → JumpStart → 4x → 2x → 1x → Graduation**.

### Logic
- For each leg, the **average / median** are computed only over mentees where **both endpoints exist**, so a small **n** stays honest rather than zero-padded. Negative spans (data anomalies) are dropped.

### Who's counted
- Only mentees in the **Mentees source of truth** (the Notion-mirrored \`mentees\` roster) — i.e. real **JYF / 4x / 2x / 1x** pipeline mentees. CoachAccountable's **other pipelines** (independent IMN mentoring, after-graduation care, mentor training, …) appear in CA but **aren't counted here**. Matched by client id or name; manually-excluded mentees are dropped too.

### Stage-date basis
- Stage dates can be read two ways (toggle on this tab, set org-wide in Company options):
  - **Engagement start** — the CA engagement's start date for that tier.
  - **First meeting** — the first 1-on-1 mentoring meeting under that tier (group sessions excluded), falling back to the engagement start.

### Filters (scope the cohort)
- The filter bar narrows which mentees feed the graph, table, and tiles — they **compose**:
  - **Active within** — mentees whose most recent activity (last meeting, else latest stage date) falls inside the window (e.g. last 12 months).
  - **Status** — Active / Graduated / Exited (quit · fired · no mentoring).
  - **Current tier** — JumpStart / 4x / 2x / 1x / Graduated.
  - **Owner** — the mentee's primary coach.
  - **Overridden graduation date** — only mentees whose graduation date was set manually (an override).
  - **Only hand reviewed** — only mentees whose source-of-truth record has been hand/human reviewed (the flag on the Mentee-record card).
- "Showing N of M" shows how many roster mentees pass the filters; **Clear filters** resets them. Filters are not saved — they reset on reload.

### Column colors & labels
- Each leg's bar (and its table swatch) is colored to match the stage it leads **into** on the mentee rail — the same palette set in **Company options → Journeys → Pipeline stage colors**.
- Each bar is labeled with its **average days**. The overall **Discovery → graduation** time isn't a bar of its own — it's the **"Avg time to graduate"** tile above.

### Owner & alternative exits
- Each mentee's **owner** is their CoachAccountable **primary coach** (\`ca_clients.coach_id\`), shown on the mentee's timeline. The per-meeting **Coach** column still shows whoever ran each meeting. See the **"How clients are matched to coaches"** help.
- A mentee can take an **alternative exit at any stage** — **Quit**, **Fired**, or **No mentoring** — set in the "Edit graduation status" editor. The stage rail then ends in a red exit node *in place of* Graduation, at the point they left.

Pure logic in \`lib/journey.ts\`.`,
  },

  "journeys.menteeRecord": {
    title: "Mentee record (source of truth)",
    body: `HJG's **internal source of truth** for this mentee — one consolidated record per person.

### Where it comes from
- **Seeded once** from the Notion *Mentees Database*, linked to the CoachAccountable client by name (\`client_id\`).
- After the import, **this is the master copy**: edits you make here are saved to the dashboard's own \`mentees\` table and are **never overwritten** by a CoachAccountable re-sync or a re-run of the seed.

### What it holds
- Notion **Status**, **Mentor**, **Discovery-call** / **Projected-start** / **Offering-signup** dates, contact info, and free notes.
- This is separate from the **pipeline status** editor above (which drives the auto/active/graduated logic) — that one feeds the metrics; this record is the management roster.

### Hand-reviewed flag
- **Saving an edit** here marks the record **hand reviewed** automatically (with the date).
- You can also **tick "Hand reviewed"** directly — without changing anything — to acknowledge you've checked the record. Ticking saves immediately (along with any unsaved edits); unticking clears the flag.

### Source
- \`mentees\` table (HJG-owned, staff-RLS, migrations \`9986\` + \`9977\` for the \`hand_reviewed\` / \`hand_reviewed_at\` columns). Prospects not yet in CoachAccountable are seeded too, but only those linked to a CA client appear on this tab.`,
  },

  "metrics.capacity": {
    title: "Mentor capacity utilization",
    body: `How loaded each mentor is: distinct **1-on-1 mentees** they're serving vs. their **configured capacity**.

### Logic
- **Utilization = active 1-on-1 mentees ÷ capacity.** Capacity is set per coach in **Admin → Mentor capacity**.
- **Group sessions don't count.** "In Depth" / "Tracking Together" and any multi-client time slot (same coach, same exact start time, 2+ clients) are treated as group and excluded — so one group session of 10 doesn't look like 10 1-on-1s (the Arthur-Nisly inflation fix).

### Which coach a mentee counts under
- A mentee counts once, under their **owner = CoachAccountable primary coach** (\`ca_clients.coach_id\`) — so a handed-off mentee no longer double-counts across coaches.
- Group-session detection still uses who actually **ran** each meeting; only the final 1-on-1 bucket is grouped by owner.
- **Fallback** (owner not synced yet — needs migration \`9984\` + a re-sync): the coach who ran the meeting (\`ca_appointments.coach_id\`). See the **"How clients are matched to coaches"** help.

### Source
- \`ca_appointments\` categorized as 1-on-1 mentoring, per \`lib/capacity.ts\` (\`oneOnOneMenteesByCoach\`), re-bucketed by \`ca_clients.coach_id\`. Capacity from \`coach_settings\`.`,
  },

  "metrics.resource": {
    title: "Resource engagement",
    body: `Manually-tracked engagement metrics that don't come from CoachAccountable (e.g. resource downloads, event attendance), shown by month.

### How it's entered
- Staff type these in **Admin → Manual metrics** for a given month; the chart and table here read them back.

### Source
- The \`manual_metrics\` table (HJG-owned). The metric set is defined in code (\`MANUAL_METRICS\`).`,
  },

  "discovery.tab": {
    title: "Discovery tab",
    body: `Every discovery (intro) call synced from CoachAccountable, with its outcome.

### Outcome
- Computed **automatically**: a call converts when the prospect buys **JumpStart Your Freedom (Waiting List)** (offering \`42840\`) on or after the call; otherwise it's **pending** for 30 days, then **not converted**. A **manual override** here always wins.
- This is the same logic that feeds the **Discovery → conversion** card on Metrics.

### Source
- \`ca_appointments\` (discovery) + \`ca_offering_submissions\` (offering \`42840\`) + your \`discovery_outcomes\` overrides. Resolver in \`lib/conversion.ts\`.`,
  },

  "raw.data": {
    title: "Raw data",
    body: `A direct browser of the underlying database — the mirrored CoachAccountable tables (\`ca_*\`) and the HJG-owned tables (outcomes, settings, manual metrics, payout builds, exclusions).

### Notes
- These are **read-only snapshots** of what's in Supabase right now (the mirror is refreshed by **Admin → Sync now**).
- Export any single table to **CSV**, or every table to one **.xlsx** workbook (one sheet per table).`,
  },

  "company.options": {
    title: "Company options",
    body: `Self-serve, **organization-wide** dashboard settings — change them here instead of editing code. A change applies for everyone.

### How it works
- Each option is a dropdown declared in a registry (\`src/companyOptions.ts\`) and saved to the \`app_settings\` table.
- First option: **Journeys → stage-date basis** (engagement start vs. first 1-on-1 meeting), also togglable inline on the Journeys tab.`,
  },

  "metrics.freedom": {
    title: "Meetings to Freedom!",
    body: `For each **graduated** mentee, how many **1-on-1 mentoring sessions** (4x / 2x / 1x) it took to walk them from finishing JumpStart to graduation ("Freedom").

### The window
- **Starts** when **JumpStart Your Freedom** completed — the mentee's JumpStart engagement **end date** (falls back to when they entered their first ongoing tier if no end date was recorded).
- **Ends** at the **graduation** date (an "After Graduation Care" engagement, or a manual "graduated" override).

### Counting
- Only **1-on-1** mentoring meetings inside that window count — **group** sessions (In Depth / Tracking Together) are excluded.
- Only **graduated** mentees are measured (you need both endpoints). A graduate missing a JumpStart-completion or graduation date is shown as "omitted", not counted. Test/placeholder mentees you've excluded are left out.
- **All-time** — this card is *not* affected by the date range at the top of the page.

### Source
- Per-mentee journeys (\`fetchMenteeJourneys\`): \`ca_appointments\` (1-on-1 mentoring) + \`ca_engagements\` (JumpStart end + graduation). Pure math in \`lib/freedom.ts\`.`,
  },
  "metrics.jyfVsMentoring": {
    title: "JYF vs Active Mentoring",
    body: `A current-state snapshot of **where people are in the pipeline right now**: how many are in the supervised start (**JumpStart Your Freedom**) versus ongoing **1-on-1 mentoring** (4x / 2x / 1x).

### What's counted
- **In JumpStart (JYF)** — distinct people with an **open** JumpStart engagement.
- **In Active Mentoring** — distinct people with an **open** 4x, 2x, or 1x engagement (the union — each person counted once).
- An engagement is **open** when it is **neither complete nor canceled**. Completed JumpStarts and graduated/ended mentees drop out automatically.

### Notes
- Counts **people, not engagements** — someone with two open engagements is counted once per side. The **4x / 2x / 1x** tiles break down the mentoring side; in the rare case a person has open engagements in two tiers they show under both, so the tiles can total slightly more than "In Active Mentoring".
- Test/placeholder mentees you've excluded (and group/placeholder clients) are left out.
- **All-time snapshot** — *not* affected by the date range at the top of the page.

### Source
- \`ca_engagements\` (name → tier via \`engagementTier\`, plus \`is_complete\` / \`is_canceled\`). Pure math in \`lib/cohort.ts\` (\`computeJyfVsMentoring\`).`,
  },

  "margins.tab": {
    title: "Margins — staff hours vs delivered hours",
    body: `The first step toward **program margins**: compare the **staff hours** that went into a program each month against the **meeting hours actually delivered**. Sub-tabs split it by program — **JumpStart Your Freedom** (the supervised JumpStart tier) and **Mentoring** (ongoing 4x / 2x / 1x).

### Delivered hours
- Counted from CoachAccountable meetings whose engagement is in the program's tiers, grouped by month.
- A **session** = a distinct **coach + exact start-time** slot, so a group meeting counts **once** (not once per attendee).
- Each session's hours = its **actual duration** (\`endDate − startDate\`) when recorded. When a meeting has no end time (pre-sync rows, or CA left it blank) it falls back to a **1 h/session** stand-in (\`PROGRAM_MEETING_HOURS\`).
- Real durations need migration \`9980_ca_appointments_end.sql\` applied **and a re-sync** (the sync now mirrors \`endDate\` to \`ca_appointments.end_raw\`); until then everything uses the fallback.

### Staff hours
- **You enter these** per month, in the table (saves on blur). Stored in the \`program_hours\` table (migration \`9981\`).

### Drill into a month
- **Click a bar (or a table row)** to open the **meetings behind that month** — each delivered session with its date, time, coach, meeting name, attendees, and hours (a group session shows its attendee count). Export the list to CSV. An asterisk on hours marks a session using the fallback length (no end time recorded).

### Reading it
- **Delivered ÷ staff** = delivered meeting hours per staff hour, for months where staff hours are entered — a first proxy for leverage/efficiency.
- **Dollars come later.** This is the hours "bones"; cost + revenue layer on top once the hours model is trusted.`,
  },

  "general.coachAttribution": {
    title: "How clients are matched to coaches",
    body: `**The mentee's OWNER is CoachAccountable's primary coach** — the coach set on the client in CA (the "managed by" pairing you change by re-pairing a client). That owner drives **everything**: the Journeys owner, **Mentor-capacity** grouping, and **Pay-staff** payout attribution.

### Where the owner comes from
- CA's \`Client.getAll\` returns a \`CoachID\` per client = their primary coach. The sync mirrors it onto \`ca_clients.coach_id\`.
- **You must apply migration \`9984\` and run a re-sync (Admin → Sync now)** for the owner to be populated. Until then it's blank and the dashboard falls back to the old activity-derived coach (below), so nothing breaks while you wait.
- **To change a mentee's owner: re-pair them to the new coach in CoachAccountable, then re-sync.** No need to re-cut engagements just to move ownership.

### Fallback when the primary coach isn't known yet
When a mentee has no synced primary coach, each surface falls back to how it worked before:
- **Pay staff / Journeys stages** → the coach on the covering **engagement** (\`ca_engagements.coach_id\`): for an invoice's \`date_of\`, the most-recently-started engagement spanning that date, else the coach who covered the most days that month. Revenue with no coach at all = **"unassigned"**.
- **Mentor capacity / per-meeting Coach column** → the coach who **ran each meeting** (\`ca_appointments.coach_id\`).
- The Journeys owner line says "(from latest meeting — primary coach not synced)" when it's using this fallback.

### Why this was the fix for "Caleb's mentees still show Arthur"
A mentee like Jonathan Heinzman kept showing Arthur because his ongoing engagement was still recorded under Arthur in CA — and the old logic read the engagement, not the pairing. Now that **owner = primary coach**, re-pairing him to Caleb in CA (then re-syncing) moves him to Caleb everywhere, without touching the engagement.

### A separate thing: the Notion "Mentor" field
The **Mentee record** card (Journeys) shows a **Mentor** column from the Notion roster. That's a **manual roster value** and is **not** the owner — it doesn't drive Pay, capacity, or the pipeline.`,
  },
};

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES[id];
}
