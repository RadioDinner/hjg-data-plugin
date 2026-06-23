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
- Each column's **height** is that month's total calls, **colored by outcome** (converted / pending / not converted / no show); the **line** is the conversion rate.
- **Channel:** **solid** segments are **Zoom** calls, **grid-patterned** segments are **Phone** calls.

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

### Attribution
- A mentee is attributed to the coach who covered the **most active days** in the invoice's service month. Billed revenue with no overlapping engagement shows as **"unassigned"** rather than being dropped.

### Source
- \`ca_invoices\` (billed, service **date** \`date_of\`) + \`ca_engagements\`. Pure engine in \`lib/pay.ts\`; see \`docs/legacy-pay-calculator.md\`.`,
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

### Stage-date basis
- Stage dates can be read two ways (toggle on this tab, set org-wide in Company options):
  - **Engagement start** — the CA engagement's start date for that tier.
  - **First meeting** — the first 1-on-1 mentoring meeting under that tier (group sessions excluded), falling back to the engagement start.

Pure logic in \`lib/journey.ts\`.`,
  },

  "metrics.capacity": {
    title: "Mentor capacity utilization",
    body: `How loaded each mentor is: distinct **1-on-1 mentees** they're serving vs. their **configured capacity**.

### Logic
- **Utilization = active 1-on-1 mentees ÷ capacity.** Capacity is set per coach in **Admin → Mentor capacity**.
- **Group sessions don't count.** "In Depth" / "Tracking Together" and any multi-client time slot (same coach, same exact start time, 2+ clients) are treated as group and excluded — so one group session of 10 doesn't look like 10 1-on-1s (the Arthur-Nisly inflation fix).

### Source
- \`ca_appointments\` categorized as 1-on-1 mentoring, per \`lib/capacity.ts\` (\`oneOnOneMenteesByCoach\`). Capacity from \`coach_settings\`.`,
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
};

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES[id];
}
