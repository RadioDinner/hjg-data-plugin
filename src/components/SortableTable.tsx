import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv } from "../csv";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface SortColumn {
  key: string;
  label: string;
  numeric?: boolean; // sort numerically + right-align
  // How to render the cell (defaults to the raw value). Use for formatting like
  // "$1,234" or "15/30" while keeping the underlying value sortable.
  format?: (row: Row) => ReactNode;
  // Value written to CSV (defaults to the raw value).
  csv?: (row: Row) => string | number;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

// A presentational table whose columns sort on click (tri-state: none → asc →
// desc → none) and whose current (sorted) view exports to CSV. Filtering lives
// in the parent — it just passes already-filtered rows. Reusable across views.
export function SortableTable({
  columns,
  rows,
  exportName,
  emptyText = "No rows.",
  maxRows,
}: {
  columns: SortColumn[];
  rows: Row[];
  exportName: string;
  emptyText?: string;
  // Cap the number of RENDERED rows (after sorting) for performance on huge tables.
  // Sorting and CSV export still cover the full row set; only the DOM is capped.
  maxRows?: number;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      let cmp: number;
      if (col?.numeric) {
        cmp = (Number(av) || 0) - (Number(bv) || 0);
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort, columns]);

  const capped = maxRows != null && sorted.length > maxRows;
  const display = capped ? sorted.slice(0, maxRows) : sorted;

  function toggle(key: string) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears the sort
    });
  }

  function exportCsv() {
    const cols = columns.map((c) => c.label);
    const data = sorted.map((r) => columns.map((c) => (c.csv ? c.csv(r) : (r[c.key] ?? ""))));
    downloadCsv(exportName, cols, data);
  }

  return (
    <>
      <div className="table-toolbar">
        <span className="muted">
          {sorted.length} rows{capped ? ` (showing first ${maxRows} — refine the search to narrow; CSV exports all ${sorted.length})` : ""}
        </span>
        <button className="btn btn--sm" onClick={exportCsv} disabled={sorted.length === 0} title="Download the current (filtered + sorted) view as CSV">
          Export CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="table sortable">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const arrow = active ? (sort!.dir === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={c.key}
                    onClick={() => toggle(c.key)}
                    className={`${c.numeric ? "num" : ""} ${active ? "th--sorted" : ""}`}
                    title="Click to sort"
                  >
                    {c.label}
                    <span className="th__arrow">{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? "num" : ""}>
                    {c.format ? c.format(r) : (r[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="muted">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
