import { useEffect, useState } from "react";
import { downloadCsv } from "../csv";
import { downloadWorkbook, type WorkbookSheet } from "../xlsx";
import { fetchAllRows, fetchTable, RAW_TABLES, type RawTable } from "../db";

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Flatten a row's value for CSV. Same rules as renderCell but without the "—"
// placeholder (CSV null is empty).
function csvCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number") return v;
  return String(v);
}

export function RawDataView() {
  const [table, setTable] = useState<RawTable>("ca_appointments");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTable(table)
      .then((r) => {
        if (!cancelled) {
          setRows(r.rows);
          setTotal(r.total);
        }
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

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  async function exportAll() {
    setExporting(true);
    setError(null);
    try {
      const all = await fetchAllRows(table);
      const cols = all.length > 0 ? Object.keys(all[0]) : columns;
      downloadCsv(table, cols, all.map((row) => cols.map((c) => csvCell(row[c]))));
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  // Every raw table in one .xlsx workbook, each table on its own sheet.
  async function exportWorkbook() {
    setExportingAll(true);
    setError(null);
    try {
      const sheets: WorkbookSheet[] = [];
      for (const t of RAW_TABLES) {
        const all = await fetchAllRows(t);
        const cols = all.length > 0 ? Object.keys(all[0]) : [];
        sheets.push({ name: t, columns: cols, rows: all.map((row) => cols.map((c) => csvCell(row[c]))) });
      }
      await downloadWorkbook("hjg-raw-data", sheets);
    } catch (e) {
      setError(String(e));
    } finally {
      setExportingAll(false);
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <h2>Raw data</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn--sm" href="/data-map.html" target="_blank" rel="noopener" title="Open the interactive data-relationship map in a new tab">
            Data map ↗
          </a>
          <button
            className="btn btn--sm"
            onClick={exportAll}
            disabled={exporting || total === 0}
            title={`Download all ${total} rows of ${table} as CSV`}
          >
            {exporting ? "Exporting…" : `Export CSV (${total})`}
          </button>
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
      <p className="view__hint">The data synced from CoachAccountable, straight from the database tables.</p>

      <div className="tabs" style={{ marginTop: 0 }}>
        {RAW_TABLES.map((t) => (
          <button key={t} className={`tab ${t === table ? "tab--active" : ""}`} onClick={() => setTable(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <div className="notice notice--warn">{error}</div>}

      <p className="view__hint">
        {loading ? "Loading…" : `Showing ${rows.length} of ${total} rows`}
      </p>

      {!loading && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c} className="muted">
                      {renderCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
