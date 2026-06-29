# HJG Mentee Management — Complete Rewrite (session 010)

Planning doc for the three-zone mentee rewrite. Trunk is `main`. Migrations
count **down**; lowest shipped is `9975`, so the new one is **`9974`**.

Locked carry list (7 Notion fields): **name, Status, coach, email, phone, DC
Date, Offering Signup**. The four financial fields (Current Invoice Amount, FF
Amount, Freedom Fight Paid?, Date FF Paid) and `Associated Tasks / dd w a / MN
Equivalency / Projected Start Date / JS Lesson? / Wants PP? / MT Prayer Partner`
are **dropped**.

---

## The core idea — three non-overlapping write zones

One `mentees` row per person, with three zones that never write each other's
columns, so re-importing Notion can't wipe hand edits and a CA sync can't wipe
Notion:

| Zone | Columns | Written by | Refreshed |
|---|---|---|---|
| **CA** | `ca_*` | sync materialize step, only | every sync |
| **Notion** | `notion_*` | in-app CSV importer, only | each re-import |
| **Hand** | `*_override`, `status*`, `is_test`, `notes` | in-app edits, only | never overwritten |

Effective value for shared fields = **`hand ?? notion ?? ca`**. Single-owner
fields pass through their zone. The detail panel shows all three side-by-side and
flags conflicts with one-click "accept into hand".

---

## 1. Schema — `supabase/migrations/9974_mentees_three_zone.sql` (destructive, re-runnable)

Guarded drop-and-recreate: drop only if the table lacks `notion_name` (so a
re-paste after cutover is a no-op). Supersedes `9975` regardless of whether
`9975` was ever applied.

- **Identity/meta**: `id uuid pk`, `client_id bigint unique` (NULL ⇒ Notion-only
  prospect), `created_by`, `created_at`, `updated_at`.
- **CA zone `ca_*`**: unchanged from 9975 (lines 55–74) — owner coach, the 6
  stage dates, first/last meeting, meeting count, current tier, jumpstart end,
  jyf purchase, start date, has_open, ca_status, ca_synced_at.
- **Notion zone `notion_*`**: `notion_name`, `notion_status`, `notion_coach`,
  `notion_coach_conflict bool`, `notion_email`, `notion_phone`, `notion_dc_date
  date`, `notion_offering_signup`, `notion_imported_at timestamptz`.
- **Hand zone**: `status` CHECK `(active, graduated, quit, fired, no_mentoring,
  declined, imn)` — drops `paused`, adds `no_mentoring` + `imn`. `status_stage`
  CHECK `(pre_waiting, discovery, jumpstart, 4x, 2x, 1x)` — adds `pre_waiting`.
  `status_date`. Date overrides for all stages incl. new
  `pre_waiting_date_override`. `name_override`, `owner_coach_id_override`, and
  shared-field overrides `email_override`, `phone_override`, `coach_override`
  (renamed from 9975's bare `email/phone/mentor`). `notes`, `is_test`.
- Indexes on `client_id`, `status`, `notion_status`, `lower(notion_name)`.
  Trigger `set_updated_at()`. RLS identical to 9975. **No SQL seed** — Notion
  data comes via the importer; the old `9986` seed is retired.

## 2. Effective model — `lib/menteeView.ts`

- Extend `MenteeRowLike` with the `notion_*` cols + the renamed
  `*_override`/`coach_override` + `pre_waiting_date_override`.
- New `MenteeMgmtStatus = active|graduated|quit|fired|no_mentoring|declined|imn`;
  `MENTEE_EXIT_STATUSES = [quit, fired, no_mentoring, declined]`;
  `OUT_OF_FUNNEL_STATUSES = [imn]`.
- `FUNNEL_STAGES = [pre_waiting, discovery, jumpstart, 4x, 2x, 1x, graduated]`.
- `toEffectiveMentee` rewrite: shared fields resolve `hand ?? notion ?? ca`
  (name, coach, email, phone, discovery = `override ?? notion_dc_date ??
  ca_discovery_date`); stage dates stay `override ?? ca`; CA facts pass through;
  offering signup passes through Notion.
- Status: `status` (hand) canonical; else derive from `notion_status` via
  `NOTION_STATUS_MAP`; else CA guess. `coarse:true` exits (`Done (Quit OR No
  Mentoring)`→quit, `Done (Other)`→declined) flagged "needs classification".
- New `conflicts: MenteeConflict[]` (per shared field where ≥2 zones disagree;
  also surfaces `notion_coach_conflict` from Mentor 1 vs Mentor).

Notion-Status → lifecycle map: `Pre-Waiting List`→active@pre_waiting ·
`Waiting List (JYF)`→active@jumpstart · `4x/2x/1x Mentoring`→active@tier ·
`Done (Graduated)`→graduated · `Done (Quit OR No Mentoring)`→quit (coarse) ·
`Done (Other)`→declined (coarse) · `IMN`→imn.

## 3. CSV importer

- New pure `lib/notionCsv.ts`: `parseCsv` (RFC4180 — quotes, `""`, embedded
  newlines, CRLF, BOM), `stripNotionLink`, `normalizeName`, `reconcileCoach`
  (Mentor 1 + Mentor → value + conflict flag), `parseDate`/`parseBool`,
  `mapRowToNotion`.
- `src/db.ts` `upsertMenteeNotion(rows)`: match by `client_id` else
  `normalizeName` against `name_override ?? notion_name ?? ca_name`; 1 match →
  update `notion_*` only; 0 → insert Notion-only row (null client_id); >1 →
  return as `ambiguous` (skipped, surfaced in UI). Touches **only** `notion_*` +
  `notion_imported_at` ⇒ idempotent/re-importable.
- New `src/components/NotionImportModal.tsx`: upload/paste → column-mapper
  (auto-guess, remembered in localStorage) → preview (matched/new/ambiguous +
  coach-conflict counts) → confirm.

## 4. Sync — `lib/sync.ts` / `lib/menteeJourney.ts`

No functional change: the materialize upsert and `rebuildMenteesFromCa` already
write only the `ca_*` shape with `onConflict: client_id`, which leaves
`notion_*`/hand untouched on the new schema. Add a doc-comment asserting "ca_* +
client_id ONLY".

## 5. Funnel + exit card → Metrics

- Rewrite `lib/menteeFunnel.ts`: add `pre_waiting`; exits become
  `{quit, fired, no_mentoring, declined}`; exclude `imn`
  (`status !== "imn"`), add `imnCount` to the report.
- New `src/components/MenteeFunnelCard.tsx` (self-contained like
  `PipelineTimingCard`): `fetchMentees` → effective → own **status filter** →
  `computeFunnel`. Graph + table (Entered / Active / Exited-by-reason / →Next) +
  "IMN excluded: N".
- Mount in `MetricsView` next to `PipelineTimingCard`; **remove** the funnel
  block from `MenteesView` (lines 319–378 + its memos).

## 6. Editor UI — `src/views/MenteesView.tsx`

- **Inline-edit grid** (`src/components/MenteeGrid.tsx`): all mentees × Name /
  Status / Coach / Email / Phone / DC date / Offering signup; cells show
  effective value, edits write the hand override via `saveMenteeHand`. Sort +
  CSV.
- **First-class Status filter** driven off the new taxonomy (Any / active@stage /
  graduated / declined / quit / fired / no_mentoring / imn).
- **3-source detail panel**: CA / Notion / Hand columns per shared field, conflict
  highlight, one-click "→ Hand"; below it hand-refinement (`is_test`, `notes`,
  `status_stage`/`status_date` to split coarse exits). Keep the stage rail (now
  incl. pre_waiting) + CA engagements/meetings tables.
- **"Import Notion CSV"** button next to "+ Add mentee" / "Rebuild from CA".

## 7. Plumbing

- `scripts/verify-metrics.ts`: extend §21 (effective model) + §22 (funnel);
  add **§23** (importer: parseCsv/stripNotionLink/reconcileCoach/normalizeName/
  upsert idempotency) + **§24** (new stages/exits/IMN end-to-end).
- `src/help/articles.ts`: move `mentees.funnel` → `metrics.funnel`; add
  `mentees.import`, `mentees.threeSource`, `mentees.statusFilter`.
- `src/uiRegistry.ts` (append-only): add `metrics.funnel`, `mentees.grid`,
  `mentees.import`, `mentees.threeSource`; retire (reserve) the old
  `mentees.funnel` id.
- `src/companyOptions.ts`: optional `mentees_default_status_filter` (seed in
  9974). `src/App.tsx`: no change (Mentees tab stays).

## 8. Sequencing (each phase green: `typecheck` + `verify` + `build`)

1. **Pure core** — `menteeView` + `menteeFunnel` + `notionCsv`; verify
   §21/§22/§23/§24. No DB/UI.
2. **DB layer** — `db.ts` types/select/`upsertMenteeNotion`/re-exports; sync
   comment-only.
3. **Funnel move** — `MenteeFunnelCard` into Metrics; remove from Mentees.
4. **Editor UI** — grid + status filter + 3-source panel + import modal.
5. **Cutover (ops)**: apply `9974` → full sync (fills `ca_*`) → import Notion CSV
   (fills `notion_*`; ~31 prospects created) → spot-check + hand-refine coarse
   exits.

## 9. Open / deferred

- **Match-by-name fragility** (no Notion page-id): renames orphan rows; homonyms
  → ambiguous. Importer surfaces ambiguous/new before commit. *Deferred:* a
  manual "merge/link to existing mentee" action.
- **Coarse Notion exits** rely on hand refinement for quit-vs-no_mentoring and
  fired-vs-declined; counted under their default mapping until refined.
- **pre_waiting** has no CA date source → treated as status-derived (with an
  optional hand date). Decided: status drives "reached pre_waiting", not a date.
- **Notion-only prospects** (null client_id) won't auto-merge if later added to
  CA — needs the manual link action above (deferred).
