import { hoursTotal, laborTotal, normalizeEntries, type HourlyEntry } from "../db";
import { SectionId } from "./SectionId";
import { TimesheetTable } from "./TimesheetTable";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n || 0);

// HOURLY WORK on a mentor's payout (Build payout §204): hand-entered hours × rate,
// paid 100% to the mentor — the Split % never touches it — and printed on the
// same pay stub. The default rate pre-fills from the mentor's most recent build
// that has one; any line can carry its own rate. Purely controlled: the parent
// owns the lines + rate and persists them (payout_builds, migration 9961).
export function HourlyWorkCard({
  entries,
  onChange,
  rate,
  onRateChange,
  locked,
  sectionId,
  hint,
}: {
  entries: HourlyEntry[];
  onChange: (next: HourlyEntry[]) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  locked?: boolean;
  sectionId: string;
  hint?: string;
}) {
  const clean = normalizeEntries(entries);
  const hours = hoursTotal(clean);
  const total = laborTotal(clean, rate);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <h2 style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            Hourly work <SectionId id={sectionId} />
          </h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {hint ??
              "Hours × rate, paid in full on top of the revenue share — the Split % doesn't apply."}
          </div>
          <div
            className="muted"
            style={{
              fontSize: 12,
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span>Rate</span>
            <input
              className="input--inline"
              type="number"
              min="0"
              step="0.5"
              style={{ width: 76 }}
              value={rate === 0 ? "" : String(rate)}
              placeholder="0"
              disabled={locked}
              onChange={(e) => {
                const n = Number(e.target.value);
                onRateChange(Number.isFinite(n) && n >= 0 ? n : 0);
              }}
              title="DEFAULT hourly rate for this month — any line left blank in the Rate column is paid at this. Saves with the build; next month pre-fills from it."
              aria-label="Default hourly rate for this build"
            />
            <span>
              $/hour default · {clean.length} line{clean.length === 1 ? "" : "s"} · {hours} h
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Hourly total
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtUsd(total)}</div>
        </div>
      </div>

      <TimesheetTable entries={entries} onChange={onChange} defaultRate={rate} locked={locked} />
    </section>
  );
}
