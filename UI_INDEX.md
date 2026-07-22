# UI section index

Every addressable UI section has a **stable 3-digit id** shown as a small muted badge
beside its heading (screens are badged on their nav tab). Say "fix section 104" and we
both know exactly which element. The numbers are the source of truth in
**`src/uiRegistry.ts`** (`UI_SECTIONS`); the badge component is
**`src/components/SectionId.tsx`** (`<SectionId id="key" />`).

**Rules:** append-only — never renumber an existing key; retire a number rather than
reuse it. Adding a section = one entry in `uiRegistry.ts` + one `<SectionId>` in the JSX.
Ranges are mnemonic: `0xx` Metrics · `1xx` Journeys · `2xx` Pay/Build · `3xx` Raw data ·
`4xx` Admin (`45x` Company options) · `5xx` Mentees · `6xx` Margins · `7xx` Discovery ·
`8xx` Maps · `9xx` modals/drawers.

| # | Key | Section | Where |
|---|-----|---------|-------|
| 001 | `metrics.screen` | Metrics (screen) | nav tab |
| 002 | `metrics.compare` | Compare: Period A vs Period B | `MetricsView` ChartCard |
| 003 | `metrics.conversion` | Discovery calls → conversion | `MetricsView` ChartCard |
| 004 | `metrics.freedom` | Meetings to Freedom! | `MetricsView` ChartCard |
| 005 | `metrics.jyfVsMentoring` | JYF vs Active Mentoring | `MetricsView` ChartCard |
| 006 | `metrics.meetings` | Mentee meetings | `MetricsView` ChartCard |
| 007 | `metrics.mentees` | Active mentees | `MetricsView` ChartCard |
| 008 | `metrics.mentors` | Mentors | `MetricsView` ChartCard |
| 009 | `metrics.capacity` | Mentor capacity utilization | `MetricsView` card |
| 010 | `metrics.resource` | Resource engagement | `MetricsView` ChartCard |
| 101 | `journeys.screen` | Mentee journeys (screen) | nav tab |
| 102 | `journeys.pipelineTiming` | Pipeline timing roll-up | `JourneysView` card |
| 103 | `journeys.timeline` | Selected-mentee timeline | `JourneysView` card |
| 104 | `journeys.stageDays` | Time in each program stage | `JourneysView` card |
| 105 | `journeys.meetings` | Per-mentee meeting list | `JourneysView` table |
| 106 | `journeys.menteeRecord` | Mentee record — source of truth | `JourneysView` editor |
| 107 | `journeys.statusEditor` | Edit graduation status | `MenteeStatusEditor` |
| 011 | `metrics.pipelineTiming` | Pipeline timing (moved from Journeys) | `PipelineTimingCard` |
| 012 | `metrics.funnel` | Mentee funnel + exits | `MenteeFunnelCard` |
| 201 | `pay.screen` | Pay staff (screen) | nav tab |
| 202 | `pay.payoutByMonth` | Payout by month | `PayStaffView` card |
| 203 | `build.screen` | Build payout (hosted in Pay staff) | `BuildPayoutView` |
| 204 | `build.review` | Build payout — mentor·month line review | `BuildPayoutView` editor |
| 205 | `pay.reconcile` | Mentor payout reconciliation | `PayStaffView` card |
| 206 | `pay.hourly` | Hourly staff (timesheet pay) sub-mode | `HourlyPayView` |
| 207 | `pay.history` | Pay stub history sub-mode | `PayHistoryView` |
| 208 | `timeclock.screen` | Time clock (clock in/out → payroll) | nav tab |
| 209 | `timeclock.entries` | Time clock — my entries + submit for payroll | `TimeClockView` card |
| 301 | `raw.screen` | Raw data (screen) | nav tab |
| 400 | `admin.screen` | Admin (screen) | nav tab |
| 401 | `admin.sync` | Sync | `AdminView` card |
| 402 | `admin.manualMetrics` | Manual metrics | `AdminView` card |
| 403 | `admin.capacity` | Mentor capacity (editor) | `AdminView` editor |
| 404 | `admin.settings` | Settings | `AdminView` card |
| 405 | `admin.users` | User permissions (per-user tab access) | `UserPermissionsCard` |
| 451 | `options.screen` | Company options (screen) | nav tab |
| 452 | `options.payGroups` | Payment groups (engagement templates × staff groups) | `PayGroupsCard` |
| 501 | `mentees.screen` | Mentees — source of truth (screen) | nav tab |
| 502 | `mentees.roster` | Mentee roster grid | `MenteesView` table |
| 503 | `mentees.detail` | Per-mentee detail (3-source panel) | `MenteesView` panel |
| 504 | `mentees.funnel` | RETIRED — funnel moved to Metrics (012) | — |
| 551 | `updateMentee.screen` | Update Mentee (screen) | nav tab |
| 552 | `updateMentee.transition` | Transition Mentee form (from → Transition to…) | `UpdateMenteeView` card |
| 601 | `margins.screen` | Margins (screen) | nav tab |
| 651 | `finevent.screen` | Report financial event (screen) | nav tab |
| 652 | `finevent.form` | Report financial event — entry form | `FinancialEventView` card |
| 701 | `discovery.screen` | Discovery calls (screen) | nav tab |
| 801 | `maps.screen` | Maps (screen) | nav tab |
| 901 | `modal.payExplore` | Explore source data (pay) | `PayExploreModal` |
| 902 | `modal.explore` | Explore (generic source-data modal) | `ExploreModal` |
| 903 | `modal.marginsDrill` | Margins month drill-down | `MarginsView` modal |
| 904 | `drawer.help` | Help drawer (contextual explainer) | `HelpDrawer` |
| 905 | `modal.payoutLineDetail` | Build payout — per-mentee invoice/payment drill-down | `PayoutLineDetailModal` |
| 906 | `modal.paymentSent` | Payment sent — Melio reference dialog (§204) | `BuildPayoutView` modal |
| 907 | `drawer.notifications` | Notifications bell + feed (topbar) | `NotificationsBell` |
