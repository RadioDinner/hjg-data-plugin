// UNMIGRATED-DATABASE FALLBACKS for browser saves. Migrations are pasted into the
// Supabase SQL Editor by hand, so a deployed build can meet a database missing
// ANY subset of them, in any order. PostgREST rejects a write that names a
// column the table lacks (PGRST204); these helpers read WHICH column from the
// error, so a save can drop an optional column that only holds its default and
// retry, or stop and name the one migration that actually adds that column.
//
// No I/O of its own (the save is passed in) — unit-tested in
// scripts/verify-metrics.ts §30 against a fake PostgREST.

// Columns newer migrations added to payout_builds (Build payout, §204), keyed to
// the file that adds each. Hints are built from this map, never hard-coded per
// feature: a save with piece work once blamed 9964 for a missing split_override.
export const PAYOUT_BUILD_COLUMN_MIGRATIONS: Readonly<Record<string, string>> = {
  split_override: "9971_payout_build_split.sql",
  piece_items: "9964_pay_piece_work.sql",
  pieces_total: "9964_pay_piece_work.sql",
  hour_items: "9962_payout_build_hours.sql",
  hourly_rate: "9962_payout_build_hours.sql",
  hours_pay_total: "9962_payout_build_hours.sql",
};

// The column an error says is missing, or null when it's some other failure.
//   PostgREST PGRST204: "Could not find the 'x' column of 't' in the schema cache"
//     (it names only the alphabetically-first missing column of the payload)
//   Postgres 42703:     'column "x" of relation "t" does not exist' (writes)
//                       "column t.x does not exist"                  (reads)
export function missingColumnFromError(message: string): string | null {
  const m =
    /Could not find the '([^']+)' column of/.exec(message) ??
    /column "([^"]+)" of relation "[^"]*" does not exist/.exec(message) ??
    /column (?:\w+\.)?(\w+) does not exist/.exec(message);
  return m ? m[1] : null;
}

export type SaveFallback = { drop: string } | { error: string };

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// What to do after a failed save of `row`: drop the missing column and retry when
// it's optional and `droppable` (only holds its default — nothing is lost), else
// stop with a message naming the migration that adds it. Any other failure (RLS,
// network, a column this map doesn't own) passes through unchanged. Each `drop`
// removes a key the row still has, so a retry loop always terminates.
export function saveFallback(
  message: string,
  row: Readonly<Record<string, unknown>>,
  migrations: Readonly<Record<string, string>>,
  droppable: ReadonlySet<string>,
): SaveFallback {
  const col = missingColumnFromError(message);
  if (col == null || !own(migrations, col) || !own(row, col)) return { error: message };
  const file = migrations[col];
  if (!droppable.has(col)) {
    return {
      error: `${message} — apply migration ${file} in the Supabase SQL Editor, then save again`,
    };
  }
  return { drop: col };
}

// Run `save(row)`, applying saveFallback between attempts; throws the final
// error. Works on a copy, so the caller's row is untouched. At most one attempt
// per key plus one.
export async function saveWithFallback(
  row: Readonly<Record<string, unknown>>,
  save: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>,
  migrations: Readonly<Record<string, string>>,
  droppable: ReadonlySet<string>,
): Promise<void> {
  const attempt: Record<string, unknown> = { ...row };
  for (;;) {
    const { error } = await save(attempt);
    if (!error) return;
    const next = saveFallback(error.message, attempt, migrations, droppable);
    if ("error" in next) throw new Error(next.error);
    delete attempt[next.drop];
  }
}
