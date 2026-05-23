import { num } from "../format";

interface Props {
  capDaily: number;
  usedToday: number;
  remainingToday: number;
}

export function BudgetGauge({ capDaily, usedToday, remainingToday }: Props) {
  const ratio = capDaily > 0 ? Math.min(1, usedToday / capDaily) : 0;
  const level = ratio < 0.5 ? "ok" : ratio < 0.85 ? "warn" : "danger";
  return (
    <div className="budget-gauge" title="CoachAccountable calls used today vs. the hard daily cap">
      <div className="budget-gauge__head">
        <span className="budget-gauge__label">API budget today</span>
        <span className="budget-gauge__count">
          {num(usedToday)} / {num(capDaily)}
        </span>
      </div>
      <div className="budget-gauge__bar">
        <div className={`budget-gauge__fill budget-gauge__fill--${level}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="budget-gauge__foot">{num(remainingToday)} calls remaining</div>
    </div>
  );
}
