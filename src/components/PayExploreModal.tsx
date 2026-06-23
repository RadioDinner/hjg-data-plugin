import { useEffect, useMemo, useState } from "react";
import { engagementTier, type PayLedgerRow, type PayInvoiceInput, type PayEngagementInput } from "../db";
import { SortableTable, type Row, type SortColumn } from "./SortableTable";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: unknown) => usd.format(Number(n) || 0);
const fmtPct = (n: unknown) => `${Math.round((Number(n) || 0) * 100)}%`;
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m ? `${SHORT[m - 1]} ${y}` : ym;
}
const ymOf = (d: string) => d.slice(0, 7);
const dayOf = (d: string) => Number(d.slice(8, 10)) || 1;

type ViewKey = "ledger" | "invoices" | "engagements";

interface Props {
  ledger: PayLedgerRow[];
  invoices: PayInvoiceInput[];
  engagements: PayEngagementInput[];
  coachName: (id: number) => string;
  clientName: (id: number) => string;
  months: string[]; // distinct service months, newest first
  initialMonth?: string; // pre-filter to a single month when opened from a month row
  onClose: () => void;
}

// Window for auditing the numbers behind the Pay-staff tab. Three views — the
// compiled payout ledger (one row per mentee per month) plus the raw invoice and
// engagement inputs that fed it — each sortable (click a header) and filterable
// by month range, coach, tier, and free text.
export function PayExploreModal({ ledger, invoices, engagements, coachName, clientName, months, initialMonth, onClose }: Props) {
  const [view, setView] = useState<ViewKey>("ledger");
  const oldest = months.length ? months[months.length - 1] : "";
  const newest = months.length ? months[0] : "";
  const [fromYm, setFromYm] = useState<string>(initialMonth ?? oldest);
  const [toYm, setToYm] = useState<string>(initialMonth ?? newest);
  const [coach, setCoach] = useState<string>("all"); // coachId as string, or "all"
  const [tier, setTier] = useState<string>("all");
  const [text, setText] = useState<string>("");

  const lo = fromYm <= toYm ? fromYm : toYm;
  const hi = fromYm <= toYm ? toYm : fromYm;
  const q = text.trim().toLowerCase();

  // Tier options: the full set the data contains (stable; not scoped to filters).
  const tierOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of ledger) s.add(r.tier);
    for (const e of engagements) s.add(engagementTier(e.name));
    return [...s].sort();
  }, [ledger, engagements]);

  const monthInRange = (ym: string) => (!lo || ym >= lo) && (!hi || ym <= hi);
  const coachId = coach === "all" ? null : Number(coach);

  // An engagement overlaps the selected month range if it starts on/before the
  // range end and ends on/after the range start (open-ended dates are ±∞). Shared
  // by the Engagements view and the coach-option derivation below.
  const overlaps = (e: PayEngagementInput) => {
    const s = (e.startDate ?? "0000-01").slice(0, 7);
    const en = (e.endDate ?? "9999-12").slice(0, 7);
    return (!hi || s <= hi) && (!lo || en >= lo);
  };

  // Coach the engine attributed each mentee+month to (from the ledger). Raw
  // invoices carry no coach, so the Invoices view borrows this to show which
  // coach an invoice's revenue is paid to.
  const coachByClientMonth = useMemo(() => {
    const m = new Map<string, { coachId: number | null; coachName: string }>();
    for (const r of ledger) m.set(`${r.ym}|${r.clientId}`, { coachId: r.coachId, coachName: r.coachName });
    return m;
  }, [ledger]);

  // Coach options reflect only coaches with ≥1 row in the ACTIVE view under the
  // current month/tier/text filters — i.e. everything EXCEPT the coach filter
  // itself, so picking a coach never collapses the dropdown to just that coach.
  // (Invoices have no native coach; they borrow the engine's per-month attribution
  // via coachByClientMonth.)
  const coachOptions = useMemo(() => {
    const m = new Map<number, string>();
    if (view === "ledger") {
      for (const r of ledger) {
        if (!monthInRange(r.ym)) continue;
        if (tier !== "all" && r.tier !== tier) continue;
        if (q && !`${r.coachName} ${r.clientName} ${r.tier}`.toLowerCase().includes(q)) continue;
        if (r.coachId != null) m.set(r.coachId, r.coachName);
      }
    } else if (view === "invoices") {
      for (const inv of invoices) {
        const invYm = ymOf(inv.serviceDate);
        if (!monthInRange(invYm)) continue;
        const c = coachByClientMonth.get(`${invYm}|${inv.clientId}`);
        const cName = c?.coachName ?? "—";
        if (q && !`${clientName(inv.clientId)} ${cName}`.toLowerCase().includes(q)) continue;
        if (c?.coachId != null) m.set(c.coachId, cName);
      }
    } else {
      for (const e of engagements) {
        if (!overlaps(e)) continue;
        if (tier !== "all" && engagementTier(e.name) !== tier) continue;
        if (e.coachId == null) continue;
        const cName = coachName(e.coachId);
        if (q && !`${cName} ${clientName(e.clientId)} ${e.name ?? "—"} ${engagementTier(e.name)}`.toLowerCase().includes(q))
          continue;
        m.set(e.coachId, cName);
      }
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ledger, invoices, engagements, lo, hi, tier, q, coachByClientMonth, coachName, clientName]);

  // If the selected coach falls out of the available options (e.g. after
  // narrowing the month range or switching views), fall back to All coaches so
  // the table isn't stuck empty behind a stale selection.
  useEffect(() => {
    if (coach !== "all" && !coachOptions.some(([id]) => String(id) === coach)) {
      setCoach("all");
    }
  }, [coachOptions, coach]);

  // --- Ledger view ---
  const ledgerData = useMemo<{ columns: SortColumn[]; rows: Row[] }>(() => {
    const rows = ledger
      .filter((r) => monthInRange(r.ym))
      .filter((r) => coachId == null || r.coachId === coachId)
      .filter((r) => tier === "all" || r.tier === tier)
      .filter((r) => !q || `${r.coachName} ${r.clientName} ${r.tier}`.toLowerCase().includes(q))
      .map<Row>((r) => ({
        ym: r.ym,
        coachName: r.coachName,
        clientName: r.clientName,
        tier: r.tier,
        billed: r.billed,
        collected: r.collected,
        invoiceDay: r.invoiceDay ?? "",
        recognizedThis: r.recognizedThis,
        rolloverPrev: r.rolloverPrev,
        splitPct: r.splitPct,
        earned: r.earned,
        payout: r.payout,
        assigned: r.assigned,
      }));
    const columns: SortColumn[] = [
      { key: "ym", label: "Month", format: (r) => monthLabel(String(r.ym)) },
      { key: "coachName", label: "Coach" },
      { key: "clientName", label: "Mentee" },
      { key: "tier", label: "Tier" },
      { key: "billed", label: "Billed (this mo)", numeric: true, format: (r) => fmtUsd(r.billed) },
      { key: "collected", label: "Collected", numeric: true, format: (r) => fmtUsd(r.collected) },
      { key: "invoiceDay", label: "Inv. day", numeric: true },
      { key: "recognizedThis", label: "This-mo slice", numeric: true, format: (r) => fmtUsd(r.recognizedThis) },
      { key: "rolloverPrev", label: "Rolled-in", numeric: true, format: (r) => fmtUsd(r.rolloverPrev) },
      { key: "splitPct", label: "Split", numeric: true, format: (r) => fmtPct(r.splitPct) },
      { key: "earned", label: "Earned (this + rolled)", numeric: true, format: (r) => fmtUsd(r.earned) },
      { key: "payout", label: "Payout", numeric: true, format: (r) => fmtUsd(r.payout) },
      { key: "assigned", label: "Status", format: (r) => (r.assigned ? "assigned" : "unassigned") },
    ];
    return { columns, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, lo, hi, coachId, tier, q]);

  // --- Invoices view (raw engine input: billed + collected revenue by service
  // month). Coach is the engine's attribution for that mentee+month, "—" when
  // nothing was attributed (e.g. no engagement overlapped that month). ---
  const invoiceData = useMemo<{ columns: SortColumn[]; rows: Row[] }>(() => {
    const rows = invoices
      .filter((inv) => monthInRange(ymOf(inv.serviceDate)))
      .map<Row>((inv) => {
        const invYm = ymOf(inv.serviceDate);
        const c = coachByClientMonth.get(`${invYm}|${inv.clientId}`);
        return {
          serviceYm: invYm,
          serviceDay: dayOf(inv.serviceDate),
          clientName: clientName(inv.clientId),
          coachName: c?.coachName ?? "—",
          coachId: c?.coachId ?? null,
          clientId: inv.clientId,
          billed: inv.billed,
          collected: inv.collected,
        };
      })
      .filter((r) => coachId == null || r.coachId === coachId)
      .filter((r) => !q || `${r.clientName} ${r.coachName}`.toLowerCase().includes(q));
    const columns: SortColumn[] = [
      { key: "serviceYm", label: "Service month", format: (r) => monthLabel(String(r.serviceYm)) },
      { key: "serviceDay", label: "Inv. day", numeric: true },
      { key: "clientName", label: "Mentee" },
      { key: "coachName", label: "Coach" },
      { key: "clientId", label: "Client ID", numeric: true },
      { key: "billed", label: "Billed", numeric: true, format: (r) => fmtUsd(r.billed) },
      { key: "collected", label: "Collected", numeric: true, format: (r) => fmtUsd(r.collected) },
    ];
    return { columns, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, lo, hi, q, clientName, coachByClientMonth, coachId]);

  // --- Engagements view (raw engine input: mentee↔mentor↔tier spans) ---
  const engagementData = useMemo<{ columns: SortColumn[]; rows: Row[] }>(() => {
    const rows = engagements
      .filter(overlaps)
      .filter((e) => coachId == null || e.coachId === coachId)
      .filter((e) => tier === "all" || engagementTier(e.name) === tier)
      .map<Row>((e) => ({
        clientName: clientName(e.clientId),
        coachName: e.coachId != null ? coachName(e.coachId) : "—",
        tier: engagementTier(e.name),
        name: e.name ?? "—",
        startDate: e.startDate ?? "",
        endDate: e.endDate ?? "",
        isCanceled: e.isCanceled,
      }))
      .filter((r) => !q || `${r.coachName} ${r.clientName} ${r.name} ${r.tier}`.toLowerCase().includes(q));
    const columns: SortColumn[] = [
      { key: "clientName", label: "Mentee" },
      { key: "coachName", label: "Coach" },
      { key: "tier", label: "Tier" },
      { key: "name", label: "Engagement" },
      { key: "startDate", label: "Start" },
      { key: "endDate", label: "End", format: (r) => (r.endDate ? String(r.endDate) : "ongoing") },
      { key: "isCanceled", label: "Canceled", format: (r) => (r.isCanceled ? "yes" : "no") },
    ];
    return { columns, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagements, lo, hi, coachId, tier, q, coachName, clientName]);

  const active = view === "ledger" ? ledgerData : view === "invoices" ? invoiceData : engagementData;
  const showTier = view !== "invoices"; // raw invoices carry no tier
  const exportName = `pay-${view}`;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2>Explore source data</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              The compiled payout ledger and the raw invoice/engagement inputs behind it. Click a column to sort.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="seg" role="tablist" aria-label="Source view">
              {(["ledger", "invoices", "engagements"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={view === k}
                  className={`seg__btn ${view === k ? "seg__btn--active" : ""}`}
                  onClick={() => setView(k)}
                >
                  {k === "ledger" ? "Ledger" : k === "invoices" ? "Invoices" : "Engagements"}
                </button>
              ))}
            </div>
            <button className="btn btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <label className="filter">
            <span>Search</span>
            <input type="text" value={text} placeholder="coach or mentee…" onChange={(e) => setText(e.target.value)} />
          </label>
          {months.length > 0 && (
            <>
              <label className="filter">
                <span>From month</span>
                <select value={fromYm} onChange={(e) => setFromYm(e.target.value)}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter">
                <span>To month</span>
                <select value={toYm} onChange={(e) => setToYm(e.target.value)}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="filter">
            <span>Coach</span>
            <select value={coach} onChange={(e) => setCoach(e.target.value)}>
              <option value="all">All coaches</option>
              {coachOptions.map(([id, name]) => (
                <option key={id} value={String(id)}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {showTier && (
            <label className="filter">
              <span>Tier</span>
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="all">All tiers</option>
                {tierOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(q || coach !== "all" || tier !== "all" || fromYm !== oldest || toYm !== newest) && (
            <button
              className="btn btn--sm"
              onClick={() => {
                setText("");
                setCoach("all");
                setTier("all");
                setFromYm(oldest);
                setToYm(newest);
              }}
            >
              Reset filters
            </button>
          )}
        </div>

        <div className="modal__body">
          <SortableTable columns={active.columns} rows={active.rows} exportName={exportName} />
        </div>
      </div>
    </div>
  );
}
