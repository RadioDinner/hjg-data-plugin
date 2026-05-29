import { downloadCsv } from "../csv";

interface Props {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  onClose: () => void;
}

export function ExploreModal({ title, columns, rows, onClose }: Props) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{title}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn--sm"
              onClick={() => downloadCsv(title, columns, rows)}
              disabled={rows.length === 0}
              title="Download the rows shown here as CSV"
            >
              Export CSV
            </button>
            <button className="btn btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="modal__body table-scroll">
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
                  {row.map((cell, j) => (
                    <td key={j} className={typeof cell === "number" ? "num" : ""}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="muted">
                    No rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="modal__foot muted">{rows.length} rows</div>
      </div>
    </div>
  );
}
