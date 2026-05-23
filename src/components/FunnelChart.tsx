import type { FunnelStage } from "../types";
import { num, pct } from "../format";

interface Props {
  funnel: FunnelStage[];
  leadsToConverted: number | null;
}

export function FunnelChart({ funnel, leadsToConverted }: Props) {
  const counts = funnel.map((s) => s.count ?? 0);
  const max = Math.max(1, ...counts);

  return (
    <section className="card">
      <h2>Mentoring funnel</h2>
      <div className="funnel">
        {funnel.map((stage) => {
          const undefinedStage = stage.count === null;
          const width = undefinedStage ? 0 : ((stage.count ?? 0) / max) * 100;
          return (
            <div className="funnel__row" key={stage.key}>
              <div className="funnel__meta">
                <span className="funnel__label">{stage.label}</span>
                <span className="funnel__count">{num(stage.count)}</span>
              </div>
              <div className="funnel__track">
                <div
                  className={`funnel__bar funnel__bar--${stage.key}${undefinedStage ? " funnel__bar--undefined" : ""}`}
                  style={{ width: `${Math.max(width, undefinedStage ? 0 : 4)}%` }}
                />
                {undefinedStage && <span className="funnel__undefined">needs a rule</span>}
              </div>
              {stage.note && <p className="funnel__note">{stage.note}</p>}
            </div>
          );
        })}
      </div>
      <div className="funnel__conversion">
        Lead → mentee conversion: <strong>{pct(leadsToConverted)}</strong>
      </div>
    </section>
  );
}
