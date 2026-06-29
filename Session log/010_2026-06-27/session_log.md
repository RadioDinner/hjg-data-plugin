# Session 010 — 2026-06-27

Mentee management **complete re-write** to a three-zone model, committed straight to `main`.

## What shipped
- `9af20f4` — merge the real lineage (sessions 003–010) into `main` as the trunk (the
  remote/local `main` were unrelated/stale; non-destructive fast-forward merge).
- `431d08a`, `0f89b60`, `64bdf7f` — session log / prompt history.
- `d8f6af2` — `rewrite_plan.md` (the file-grounded plan, produced via a mapping workflow).
- **`f8de071` — the rewrite** (typecheck + verify (24) + build green):
  - **Migration `9974_mentees_three_zone.sql`** — destructive, re-runnable. One `mentees`
    row, three write zones: `ca_*` (sync), `notion_*` (importer), hand (`*_override`/status/
    notes/is_test). New status CHECK (adds `no_mentoring`, `imn`; drops `paused`) + `pre_waiting`
    stage. Supersedes `9975`. **Next migration is `9973`.**
  - `lib/menteeView.ts` — three-zone resolution (`hand ?? notion ?? ca`), `NOTION_STATUS_MAP`,
    `mapNotionStatus`, conflict detection, `reachedStage` (pre_waiting opt-in, never inferred),
    new taxonomy + funnel stages.
  - `lib/menteeFunnel.ts` — new stages/exits; IMN excluded from the funnel (`imnCount`).
  - `lib/notionCsv.ts` (new) — RFC4180 `parseCsv`, `stripNotionLink`, `normalizeName`,
    `reconcileCoach`, `parseNotionDate`, `planNotionUpsert`.
  - `src/db.ts` — `MenteeRow`/select/`MenteeHandEdit` for 3 zones; `upsertMenteeNotion`
    (writes ONLY notion_*); re-exports.
  - UI — `MenteesView` rewritten (first-class Status filter, Conflicts-only toggle, 3-source
    detail panel with accept-into-hand, Import Notion CSV button); new `MenteeFunnelCard` mounted
    on Metrics; new `NotionImportModal`; funnel removed from Mentees. `PipelineTimingCard` status
    options updated.
  - `scripts/verify-metrics.ts` — §21/§22 updated, new §23 (importer) + §24 (stages/exits/IMN).
  - Plumbing — `uiRegistry` (`metrics.funnel`=12; `mentees.funnel`=504 retired), `help/articles`
    (`mentees.screen` rewritten, new `metrics.funnel`).

## Directional decisions (locked with the user)
- Commit to `main` for the session (explicit permission); destructive rebuild approved.
- **Three write zones** (CA / Notion / hand), non-overlapping writers → re-import & re-sync never
  clobber. Effective = hand ?? notion ?? ca.
- Coach = Mentor 1 + Mentor reconciled (should agree; conflict flagged). IMN kept, out of funnel.
- Carry 7 Notion columns (name, Status, coach, email, phone, DC Date, Offering Signup); drop the
  rest incl. all 4 financial fields.
- Funnel/exit card **moves to Metrics**; the mentee data/roster stays unified on Mentees, with a
  first-class Status filter.
- Notion ingestion = in-app CSV importer (bulk, re-importable), matched by name.

## Open questions / next step
- **Cutover not done** (needs the user): apply `9974`, sync/rebuild, Import the Notion CSV,
  hand-refine coarse exits. See START HERE in `HANDOFF.md`.
- **Not browser-tested** (headless). Verify the importer round-trip, the 3-source panel, the
  Status filter, and the Metrics funnel in a real browser.
- Deferred: a manual "merge/link orphan to existing mentee" action (match-by-name is the only key
  Notion gives us); optional inline-edit grid (current editing is roster + rich detail panel).
- An adversarial code-review workflow (23 agents) found **15 verified defects**, **all fixed**
  in commit `dbe09b5`: funnel attribution made consistent (currentStage = furthest reached;
  exits never land on un-entered stages or on graduated; pre_waiting conversion null);
  importer hardened (non-ASCII / transliterated names, bare-CR CSV, dated-with-time parsing);
  **`planClientIdClaims`** merges a Notion-only row onto its CA identity by name on sync/rebuild
  (kills the prospect-before-CA duplicate-row + re-import-ambiguity bugs); UI guards (coach-filter
  reset, "X of Y" denominator). verify §23/§24 extended; typecheck + verify + build green.

## For future-me
- `main` is the trunk. The Notion export lives at the uploads path (PII — not committed); the
  importer is in-app, so no seed migration embeds Notion data anymore (the old `9986` seed is retired).
- `npm run verify` exercises only `lib/*` (no React) — fast gate for the pure model.
