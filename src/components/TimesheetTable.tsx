import { entryAmount, hoursTotal, laborTotal, normalizeEntries, type HourlyEntry } from "../db";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);

// TIMESHEET LINES editor — date, work, hours and an optional per-line rate (blank =
// the default rate), with labor totals and "+ Add line". Shared by both builders
// that pay by the hour:
//   • Hourly staff (§206)  — the staff member's timesheet
//   • Build payout (§204)  — a mentor's hourly work (HourlyWorkCard)
// Purely controlled: the parent owns the array and persists it.
export function TimesheetTable({
  entries,
  onChange,
  defaultRate,
  locked,
}: {
  entries: HourlyEntry[];
  onChange: (next: HourlyEntry[]) => void;
  defaultRate: number;
  locked?: boolean;
}) {
  const clean = normalizeEntries(entries);
  const hours = hoursTotal(clean);
  const labor = laborTotal(clean, defaultRate);
  const patch = (i: number, p: Partial<HourlyEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...p } : e)));

  return (
    <>
      <div className="table-scroll">
        <table className="table table--center">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Date</th>
              <th style={{ textAlign: "left" }}>Work (from the time sheet)</th>
              <th style={{ width: 90 }}>Hours</th>
              <th style={{ width: 110 }} title="Leave blank to pay this line at the default rate">
                Rate ($/h)
              </th>
              <th style={{ width: 110 }}>Amount</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="cell-edit"
                    type="date"
                    value={e.date ?? ""}
                    disabled={locked}
                    onChange={(ev) => patch(i, { date: ev.target.value || null })}
                    aria-label={`Date for line ${i + 1}`}
                  />
                </td>
                <td style={{ textAlign: "left" }}>
                  <input
                    className="cell-edit"
                    type="text"
                    style={{ width: "100%" }}
                    placeholder="what they worked on…"
                    value={e.label}
                    disabled={locked}
                    onChange={(ev) => patch(i, { label: ev.target.value })}
                    aria-label={`Work description for line ${i + 1}`}
                  />
                </td>
                <td>
                  <input
                    className="cell-edit"
                    type="number"
                    min="0"
                    step="0.25"
                    style={{ width: 70 }}
                    value={e.hours === 0 ? "" : String(e.hours)}
                    placeholder="0"
                    disabled={locked}
                    onChange={(ev) => {
                      const n = Number(ev.target.value);
                      patch(i, { hours: Number.isFinite(n) && n >= 0 ? n : 0 });
                    }}
                    aria-label={`Hours for line ${i + 1}`}
                  />
                </td>
                <td>
                  <input
                    className="cell-edit"
                    type="number"
                    min="0"
                    step="0.5"
                    style={{ width: 90 }}
                    value={e.rate == null ? "" : String(e.rate)}
                    placeholder={defaultRate ? String(defaultRate) : "0"}
                    disabled={locked}
                    onChange={(ev) => {
                      const raw = ev.target.value;
                      if (raw === "") return patch(i, { rate: null });
                      const n = Number(raw);
                      patch(i, { rate: Number.isFinite(n) && n >= 0 ? n : null });
                    }}
                    title="Rate for THIS line only. Blank = the default rate for the period."
                    aria-label={`Hourly rate for line ${i + 1}`}
                  />
                </td>
                <td
                  className="num"
                  style={{
                    fontWeight: e.rate != null && e.rate !== defaultRate ? 700 : undefined,
                    color: e.rate != null && e.rate !== defaultRate ? "var(--accent)" : undefined,
                  }}
                >
                  {fmtUsd(entryAmount(e, defaultRate))}
                </td>
                <td>
                  <button
                    className="linkbtn"
                    disabled={locked}
                    onClick={() => onChange(entries.filter((_, j) => j !== i))}
                    title="Remove this line"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No timesheet lines yet — add the first one below.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>
                Labor totals
              </td>
              <td className="num" style={{ fontWeight: 700 }}>
                {hours} h
              </td>
              <td />
              <td className="num" style={{ fontWeight: 700 }}>
                {fmtUsd(labor)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {!locked && (
        <button
          className="btn btn--sm"
          style={{ marginTop: 8 }}
          onClick={() => onChange([...entries, { date: null, label: "", hours: 0, rate: null }])}
        >
          + Add line
        </button>
      )}
    </>
  );
}
