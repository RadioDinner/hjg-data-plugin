import { useEffect, useMemo, useState } from "react";
import { downloadWorkbook, type WorkbookSheet } from "../xlsx";
import { fetchAllRows, RAW_TABLES, type RawTable } from "../db";
import { HelpButton } from "../components/HelpDrawer";
import { SortableTable, type Cell, type Row, type SortColumn } from "../components/SortableTable";

// Coerce any DB value into a sortable/searchable cell: objects/arrays (jsonb) →
// JSON text, null/undefined → null, primitives kept as-is.
function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v);
}
function csvCell(v: Cell): string | number {
  return v == null ? "" : v === true ? "true" : v === false ? "false" : v;
}

// Cap on rendered rows (sorting + CSV still cover the whole filtered set).
const RENDER_CAP = 500;

export function RawDataView() {
  const [table, setTable] = useState<RawTable>("ca_appointments");
  const [allRows, setAllRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingAll, setExportingAll] = useState(false);

  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showColFilters, setShowColFilters] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch("");
    setColFilters({});
    // Load the WHOLE table (paged) so search / sort / filter cover every row, not
    // just a first page. Tables here top out at a few thousand rows.
    fetchAllRows(table)
      .then((r) => {
        if (!cancelled) setAllRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [table]);

  const keys = useMemo(() => (allRows.length > 0 ? Object.keys(allRows[0]) : []), [allRows]);
  const columns: SortColumn[] = useMemo(() => keys.map((k) => ({ key: k, label: k, csv: (r: Row) => csvCell(r[k]) })), [keys]);

  // Coerce once; search/filter/sort all operate on these cell values.
  const cellRows: Row[] = useMemo(
    () => allRows.map((r) => Object.fromEntries(keys.map((k) => [k, toCell(r[k])])) as Row),
    [allRows, keys]
  );

  const activeColFilters = useMemo(
    () => Object.entries(colFilters).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim().toLowerCase()] as const),
    [colFilters]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && activeColFilters.length === 0) return cellRows;
    return cellRows.filter((r) => {
      if (q) {
        const hit = keys.some((k) => String(r[k] ?? "").toLowerCase().includes(q));
        if (!hit) return false;
      }
      for (const [k, fv] of activeColFilters) {
        if (!String(r[k] ?? "").toLowerCase().includes(fv)) return false;
      }
      return true;
    });
  }, [cellRows, keys, search, activeColFilters]);

  // Every raw table in one .xlsx workbook, each table on its own sheet. (Untouched.)
  async function exportWorkbook() {
    setExportingAll(true);
    setError(null);
    try {
      const sheets: WorkbookSheet[] = [];
      for (const t of RAW_TABLES) {
        const all = await fetchAllRows(t);
        const cols = all.length > 0 ? Object.keys(all[0]) : [];
        sheets.push({ name: t, columns: cols, rows: all.map((row) => cols.map((c) => csvCell(toCell(row[c])))) });
      }
      await downloadWorkbook("hjg-raw-data", sheets);
    } catch (e) {
      setError(String(e));
    } finally {
      setExportingAll(false);
    }
  }

  const anyFilter = search.trim() !== "" || activeColFilters.length > 0;

  return (
    <section className="card">
      <div className="card__head">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Raw data <HelpButton id="raw.data" label="Raw data" />
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn--sm"
            onClick={exportWorkbook}
            disabled={exportingAll}
            title="Download every table in one Excel workbook, each table on its own sheet"
          >
            {exportingAll ? "Exporting…" : "Export all (.xlsx)"}
          </button>
        </div>
      </div>
      <p className="view__hint">
        The data synced from CoachAccountable, straight from the database tables. Search across all columns, click a
        header to sort, or add per-column filters. The “Export CSV” button downloads the current filtered + sorted view.
      </p>

      <div className="tabs" style={{ marginTop: 0 }}>
        {RAW_TABLES.map((t) => (
          <button key={t} className={`tab ${t === table ? "tab--active" : ""}`} onClick={() => setTable(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="notice notice--warn">{error}</div>}

      {loading ? (
        <p className="view__hint">Loading {table}…</p>
      ) : allRows.length === 0 ? (
        <p className="view__hint">No rows in {table}.</p>
      ) : (
        <>
          <div className="rawdata__filters">
            <input
              type="search"
              className="journeys__search"
              style={{ flex: "1 1 240px" }}
              placeholder={`Search ${allRows.length} ${table} rows…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn--sm" onClick={() => setShowColFilters((v) => !v)} aria-pressed={showColFilters}>
              {showColFilters ? "Hide column filters" : "Column filters"}
            </button>
            {anyFilter && (
              <button
                className="btn btn--sm"
                onClick={() => {
                  setSearch("");
                  setColFilters({});
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {showColFilters && (
            <div className="rawdata__colfilters">
              {keys.map((k) => (
                <label key={k} className="rawdata__colfilter">
                  <span>{k}</span>
                  <input
                    type="text"
                    value={colFilters[k] ?? ""}
                    placeholder="contains…"
                    onChange={(e) => setColFilters((f) => ({ ...f, [k]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}

          <SortableTable columns={columns} rows={filtered} exportName={table} maxRows={RENDER_CAP} emptyText="No rows match the filters." />
        </>
      )}
    </section>
  );
}
