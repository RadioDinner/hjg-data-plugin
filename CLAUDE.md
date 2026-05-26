# Project conventions

## Migrations
Name migration files with **descending** numbers so the newest sorts to the
top of the folder. The first migration is `9999_*`, the next `9998_*`, then
`9997_*`, and so on. The lowest number is always the most recently added.

(Note: these run via the Supabase SQL Editor by copy-paste, not `supabase db
push`. The descending order is for at-a-glance readability, not CLI apply
order.)
