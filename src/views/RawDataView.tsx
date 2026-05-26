import { useEffect, useState } from "react";
import { fetchTable, RAW_TABLES, type RawTable } from "../db";

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function RawDataView() {
  const [table, setTable] = useState<RawTable>("ca_appointments");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="card">
      <h2>Raw data</h2>
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
