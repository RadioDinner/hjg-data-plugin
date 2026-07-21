# Project conventions

## Standing orders
**Read `new_session_instructions.md` at the start of every session.** It
contains the user's standing orders for how I work on this repo (session
logs, prompt history, end-of-session log, migration numbering, and the
CoachAccountable docs source of truth). Those rules override anything in
this file if they conflict.

## CoachAccountable API source of truth
`docs/coachaccountable-api.md` is **the only source of truth** for
CoachAccountable API behavior — endpoints, parameters, return shapes,
response envelope. Do not contradict it from training-data memory. If code
in `lib/ca.ts` / `lib/sync.ts` disagrees with the docs, fix the code.

## Session log + prompt history
Every session, create `Session log/NNN_YYYY-MM-DD/` and log every user
prompt to `prompt_history.txt` inside it. Write a `session_log.md` before
the session ends. Details in `new_session_instructions.md`.

## Migrations
Name migration files with **descending** numbers so the newest sorts to the
top of the folder. The first migration is `9999_*`, the next `9998_*`, then
`9997_*`, and so on. The lowest number is always the most recently added.

(Note: these run via the Supabase SQL Editor by copy-paste, not `supabase db
push`. The descending order is for at-a-glance readability, not CLI apply
order. Make new migrations re-runnable — `drop ... if exists` before triggers
and policies.)

## Session workflow
- **At the end of each session, update `HANDOFF.md`** so the next session can
  resume cold: what shipped, current branch/deploy state, the next step, and any
  open questions. Treat a stale handoff as a bug. Also write the per-session
  `session_log.md` per `new_session_instructions.md`.
- Start each session oriented by `HANDOFF.md`, `new_session_instructions.md`,
  and the north star below.
- For anything beyond a small change, plan first and confirm direction before
  building.

## Project goals / north star
- **Be a weapon with the data.** The aim is a *powerful* dashboard for board-grade
  decision-making, not just a few charts.
- **Every metric should be viewable as a graph AND as a table at the same time**
  (not only behind the "Explore" modal). Graphs for the shape, tables for the
  exact numbers — visible together.
- Currently **read-only toward CoachAccountable**. Writing changes back to CA is
  a possible future direction, but it's a deliberate architectural shift (see the
  webhooks-vs-API notes) — don't bolt it on casually.
- A C# re-implementation is a separate learning track — see `CSHARP_PORT.md`.

## Versioning (topbar chip)
The topbar shows `v<package.json version>` (e.g. `v0.3.0`); the git commit is
in the tooltip and drives the "update available" refresh pill. **Bump
`package.json` `version` with every push to `main` that changes the app** —
minor (0.X.0) for features, patch (0.0.X) for fixes — and tell the user the
new version so they can match it against the chip.
