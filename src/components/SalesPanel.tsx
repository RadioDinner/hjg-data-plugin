import type { SalesSummary } from "../types";
import { money, num } from "../format";

interface Props {
  sales: SalesSummary;
  shortMonths: string[];
  endMonth: number;
}

export function SalesPanel({ sales, shortMonths, endMonth }: Props) {
  const maxRev = Math.max(1, ...sales.revenueByMonth);
  return (
    <section className="card">
      <h2>Sold offerings</h2>
      <div className="stat-row">
        <div className="stat">
          <span className="stat__value">{money(sales.totalRevenue)}</span>
          <span className="stat__label">Total revenue</span>
        </div>
        <div className="stat">
          <span className="stat__value">{num(sales.totalUnits)}</span>
          <span className="stat__label">Offerings sold</span>
        </div>
      </div>

      <div className="spark">
        {sales.revenueByMonth.slice(0, endMonth).map((rev, m) => (
          <div className="spark__col" key={m} title={`${shortMonths[m]}: ${money(rev)}`}>
            <div className="spark__bar" style={{ height: `${(rev / maxRev) * 100}%` }} />
            <span className="spark__label">{shortMonths[m]}</span>
          </div>
        ))}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Offering</th>
            <th className="num">Units</th>
            <th className="num">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {sales.byOffering.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">No offerings sold in this period.</td>
            </tr>
          ) : (
            sales.byOffering.map((o) => (
              <tr key={o.offeringId}>
                <td>{o.offeringName}</td>
                <td className="num">{num(o.units)}</td>
                <td className="num">{money(o.revenue)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
