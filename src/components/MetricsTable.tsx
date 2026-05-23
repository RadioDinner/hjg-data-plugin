import type { MonthlyMetrics } from "../types";
import { num } from "../format";

interface Props {
  metrics: MonthlyMetrics;
}

const ROWS: Array<{ key: keyof Pick<MonthlyMetrics, "discoveryPhone" | "discoveryZoom" | "menteeMeetings" | "activeMentees" | "activeMentors">; label: string }> = [
  { key: "discoveryPhone", label: "Discovery (phone)" },
  { key: "discoveryZoom", label: "Discovery (Zoom)" },
  { key: "menteeMeetings", label: "Mentee meetings" },
  { key: "activeMentees", label: "Active mentees" },
  { key: "activeMentors", label: "Active mentors" },
];

export function MetricsTable({ metrics }: Props) {
  const end = metrics.meta.endMonth;
  const monthCols = metrics.shortMonths.slice(0, end);
  return (
    <section className="card">
      <h2>Monthly metrics</h2>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Metric</th>
              {monthCols.map((m) => (
                <th key={m} className="num">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {metrics[row.key].slice(0, end).map((v, i) => (
                  <td key={i} className="num">{num(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
