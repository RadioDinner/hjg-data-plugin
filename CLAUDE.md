# Project conventions

## Migrations
Name migration files with **descending** numbers so the newest sorts to the
top of the folder. The first migration is `9999_*`, the next `9998_*`, then
`9997_*`, and so on. The lowest number is always the most recently added.

(Note: these run via the Supabase SQL Editor by copy-paste, not `supabase db
push`. The descending order is for at-a-glance readability, not CLI apply
order.)

## Session workflow
- **At the end of each session, update `HANDOFF.md`** so the next session can
  resume cold: what shipped, current branch/deploy state, the next step, and any
  open questions. Treat a stale handoff as a bug.
- Start each session oriented by `HANDOFF.md` and the north star below.
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
